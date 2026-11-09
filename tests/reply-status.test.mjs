import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'
import { build, transform } from 'esbuild'

// 直接执行页面的实际回复循环，语音队列与分句器也使用生产实现。
const source = await readFile(new URL('../studios/live/src/main.tsx', import.meta.url), 'utf8')
const parsed = ts.createSourceFile('main.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const app = parsed.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'App')
const declaration = app.body.statements.flatMap(statement => ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : []).find(value => value.name.getText(parsed) === 'replyLoop')
assert.ok(declaration?.initializer, '找不到页面实际的弹幕回复循环')
const loopCode = (await transform('globalThis.replyLoop = ' + declaration.initializer.getText(parsed), { loader: 'ts', target: 'es2022' })).code
const pipeline = await build({ entryPoints: [fileURLToPath(new URL('../studios/live/src/pipeline.ts', import.meta.url))], write: false, bundle: true, platform: 'node', format: 'iife', globalName: 'testedPipeline' })
const queueContext = vm.createContext({ AbortController, DOMException, setTimeout, clearTimeout })
vm.runInContext(pipeline.outputFiles[0].text, queueContext)
const { SentenceBuffer, SpeechQueue } = queueContext.testedPipeline

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function fixture(queued = 0) {
  const playback = deferred(), state = { status: '', error: '', logs: [], queueSize: queued + 1 }
  const controller = new AbortController()
  const run = { controller, voice: new SpeechQueue(() => playback.promise) }
  const runtime = { current: run }, alive = { current: true }
  const inbox = { current: Array.from({ length: queued + 1 }, (_, index) => ({ name: '观众' + index, text: '你好', receivedAt: Date.now() })) }
  const context = vm.createContext({
    SentenceBuffer, runtime, alive, inbox,
    settings: { current: { game: 'practice' } }, farmState: { current: {} }, actualState: { current: {} },
    models: { current: { reply: { async ask(prompt, onText) { state.status = '正在回复弹幕 · 欢迎。'; onText('欢迎。'); return '欢迎。' } } } },
    say: (value, text, at) => value.voice.add(text, at),
    setStatus: value => { state.status = value }, setQueueSize: value => { state.queueSize = value },
    report: cause => { state.error = cause.message }, log: text => state.logs.push(text),
    // 在正常一轮的间隔结束测试，不启动下一条模型请求。
    pause: async ms => { assert.equal(ms, 4000); controller.abort() },
  })
  vm.runInContext(loopCode, context)
  const done = context.replyLoop(run)
  return { playback, state, controller, runtime, alive, done }
}

for (const queued of [0, 1]) {
  test(queued ? '本轮播完后显示等待下一条弹幕，并保留剩余队列' : '全部语音播完后回复状态恢复等待新弹幕', async () => {
    const value = fixture(queued)
    await new Promise(resolve => setImmediate(resolve))
    assert.match(value.state.status, /正在回复弹幕/u)
    assert.equal(value.state.logs.length, 0)
    value.playback.resolve()
    await value.done
    assert.equal(value.state.status, queued ? '预演运行中 · 等待回复下一条弹幕' : '预演运行中 · 等待新弹幕')
    assert.equal(value.state.queueSize, queued)
    assert.deepEqual(value.state.logs, ['观众0：你好', '主播：欢迎。'])
  })
}

test('停止后迟到的语音完成不能将停止状态改回待机', async () => {
  const value = fixture()
  await new Promise(resolve => setImmediate(resolve))
  const rejected = assert.rejects(value.done, /已停止/u)
  value.controller.abort(new DOMException('已停止', 'AbortError'))
  value.state.status = '已停止预演'
  value.playback.resolve()
  await rejected
  assert.equal(value.state.status, '已停止预演')
  assert.equal(value.state.queueSize, 1)
  assert.equal(value.state.logs.length, 0)
})

test('语音失败保留错误与未完成弹幕，不显示成功待机', async () => {
  const value = fixture()
  await new Promise(resolve => setImmediate(resolve))
  const rejected = assert.rejects(value.done, /播放失败/u)
  value.playback.reject(new Error('播放失败'))
  await rejected
  assert.equal(value.state.error, '播放失败')
  assert.match(value.state.status, /正在回复弹幕/u)
  assert.equal(value.state.queueSize, 1)
  assert.equal(value.state.logs.length, 0)
})

test('旧预演或已卸载页面的语音完成不能覆盖当前状态', async () => {
  for (const reason of ['replaced', 'unmounted']) {
    const value = fixture()
    await new Promise(resolve => setImmediate(resolve))
    if (reason === 'replaced') value.runtime.current = {}
    else value.alive.current = false
    value.state.status = '当前页面的新状态'
    value.playback.resolve()
    await value.done
    assert.equal(value.state.status, '当前页面的新状态')
  }
})
