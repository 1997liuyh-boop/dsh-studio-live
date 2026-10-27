import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import { deflateSync, brotliCompressSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { PassThrough } from 'node:stream'

await mkdir(new URL('../.test-build/', import.meta.url), { recursive: true })
async function moduleFrom(name) {
  const output = new URL(`../.test-build/${name}.cjs`, import.meta.url)
  await build({ entryPoints: [new URL(`../studios/live/src/${name}.ts`, import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/u, '')], outfile: output.pathname.replace(/^\/(?=[A-Za-z]:)/u, ''), bundle: true, platform: 'node', format: 'cjs' })
  return (await import(output.href)).default
}
const { SpeechQueue, SentenceBuffer, pause } = await moduleFrom('pipeline')
const { packet, decodePackets, signedQuery, BiliGateway } = await moduleFrom('bilibili')
const { synthesize } = await moduleFrom('tts')
const { LiveModel } = await moduleFrom('model')

test('模型逐字到达时首句立即提交，重复累计文本和结尾不会重复播报', () => {
  const output = [], buffer = new SentenceBuffer(text => output.push(text))
  buffer.push('\n你好'); assert.deepEqual(output, [])
  buffer.push('\n你好。还有一句'); assert.deepEqual(output, ['你好。'])
  buffer.push('\n你好。还有一句'); assert.deepEqual(output, ['你好。'])
  buffer.push('\n你好。还有一句！末尾', true)
  buffer.push('\n你好。还有一句！末尾', true)
  assert.deepEqual(output, ['你好。', '还有一句！', '末尾'])
  assert.throws(() => buffer.push('被改写的句子。', true), /改写/u)
})

test('三条语音依次播完，不覆盖正在播放的内容', async () => {
  const started = [], finished = []
  let release
  const queue = new SpeechQueue(async text => { started.push(text); await new Promise(resolve => { release = resolve }); finished.push(text) })
  const first = queue.add('一', 1), second = queue.add('二', 2), third = queue.add('三', 3)
  assert.deepEqual(started, ['一']); release(); await first; await Promise.resolve()
  assert.deepEqual(started, ['一', '二']); release(); await second; await Promise.resolve()
  assert.deepEqual(started, ['一', '二', '三']); release(); await third; await queue.whenIdle()
  assert.deepEqual(finished, started); assert.equal(queue.size, 0)
})

test('队列有界；停止取消当前声音和等待项，旧队列不能重新入队', async () => {
  let cancelled = false
  const queue = new SpeechQueue(async (text, signal) => { try { await pause(60000, signal) } catch (error) { cancelled = true; throw error } }, 2)
  const first = queue.add('一', 1), second = queue.add('二', 2)
  const results = Promise.allSettled([first, second])
  await assert.rejects(queue.add('超出', 3), /队列已满/u)
  queue.stop(); const settled = await results; await queue.whenIdle()
  assert.equal(cancelled, true); assert.ok(settled.every(item => item.status === 'rejected'))
  await assert.rejects(queue.add('旧轮次', 4)); assert.equal(queue.size, 0)
})

test('WBI 使用排序后的同一份已清洗参数计算摘要', () => {
  const img = 'abcdefghijklmnopqrstuvwxyz012345', sub = '6789ABCDEFGHIJKLMNOPQRSTUVWXYZ01'
  const result = signedQuery({ id: 123, text: "a!'()*b" }, img, sub, 100)
  const query = result.slice(0, result.lastIndexOf('&w_rid='))
  assert.equal(query, 'id=123&text=ab&wts=100')
  const indices = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13]
  const key = indices.map(index => (img + sub)[index]).join('')
  assert.equal(result, query + '&w_rid=' + createHash('md5').update(query + key).digest('hex'))
})

test('弹幕多帧、zlib 和 brotli 递归展开；畸形与过大压缩帧明确拒绝', () => {
  const content = Buffer.concat([packet(8, '{"code":0}'), packet(5, '{"cmd":"DANMU_MSG","info":[]}')])
  for (const version of [2, 3]) {
    const compressed = version === 2 ? deflateSync(content) : brotliCompressSync(content)
    const bytes = Buffer.concat([packet(5, '').subarray(0, 16), compressed]); bytes.writeUInt32BE(bytes.length, 0); bytes.writeUInt16BE(version, 6)
    const messages = []; decodePackets(bytes, (op, value) => messages.push([op, value]))
    assert.deepEqual(messages.map(value => value[0]), [8, 5])
  }
  const invalid = packet(5, '{}'); invalid.writeUInt16BE(1000, 4)
  assert.throws(() => decodePackets(invalid, () => {}), /长度无效/u)
  assert.throws(() => decodePackets(Buffer.from([1]), () => {}), /不完整/u)
})

test('只有鉴权成功才显示已连接；收到弹幕后按游标读取，停止清除连接任务', async context => {
  let created = 0, terminated = 0, connection
  class FakeSocket extends EventEmitter {
    send() {}
    terminate() { terminated++ }
  }
  const gateway = new BiliGateway(async () => { created++; return { uid: 1, roomId: 123, token: 'test', url: 'wss://test', buvid: '' } }, () => { connection = new FakeSocket(); return connection })
  await gateway.start({ roomId: '123', cookie: 'test' }); await Promise.resolve(); await Promise.resolve()
  assert.doesNotMatch(gateway.snapshot(0).state, /已鉴权/u)
  connection.emit('open'); connection.emit('message', packet(8, '{"code":0}'))
  assert.match(gateway.snapshot(0).state, /已鉴权/u)
  connection.emit('message', packet(5, JSON.stringify({ cmd: 'DANMU_MSG:4:0:2:2:2:0', info: [[], '你好？', [2, '观众']] })))
  const first = gateway.snapshot(0); assert.equal(first.comments.length, 1); assert.equal(first.comments[0].text, '你好？')
  assert.equal(gateway.snapshot(first.comments[0].sequence).comments.length, 0)
  for (let index = 0; index < 120; index++) {
    connection.emit('message', packet(5, JSON.stringify({ cmd: 'DANMU_MSG', info: [[], '测试', [2, '观众']] })))
    const state = gateway.snapshot(index + 1); assert.equal(state.dropped, 0)
  }
  context.mock.timers.enable({ apis: ['setTimeout'] })
  connection.emit('close'); await Promise.resolve(); await gateway.stop()
  context.mock.timers.tick(60000); await Promise.resolve(); await Promise.resolve()
  assert.equal(created, 1); assert.ok(terminated > 0); assert.match(gateway.snapshot(0).state, /已停止/u)
  context.mock.timers.reset()
})

test('云端语音将模型文字转义为纯文本，合成结束关闭连接', async () => {
  const stream = new PassThrough(); let input = '', closed = 0
  const result = synthesize('<voice>你好&再见</voice>', 'zh-CN-XiaoyiNeural', new AbortController().signal, () => ({
    async setMetadata() {}, toStream(text) { input = text; queueMicrotask(() => stream.end(Buffer.from('audio'))); return { audioStream: stream, metadataStream: null } }, close() { closed++ },
  }))
  assert.equal((await result).toString(), 'audio')
  assert.equal(input, '&lt;voice&gt;你好&amp;再见&lt;/voice&gt;'); assert.equal(closed, 1)
})

test('停止云端语音会中断流并释放连接，不返回部分音频作为成功', async () => {
  const stream = new PassThrough(), controller = new AbortController(); let began
  const started = new Promise(resolve => { began = resolve }); let closed = 0
  const result = synthesize('测试', 'zh-CN-XiaoyiNeural', controller.signal, () => ({
    async setMetadata() {}, toStream() { began(); return { audioStream: stream, metadataStream: null } }, close() { closed++ },
  }))
  const rejected = assert.rejects(result, /取消/u)
  await started; controller.abort(); await rejected
  assert.ok(closed >= 1); assert.equal(stream.destroyed, true)
})

function modelFixture({ abandoned = false, held = false } = {}) {
  const original = globalThis.fetch, calls = [], encoder = new TextEncoder()
  let stream
  globalThis.fetch = async (url, options) => {
    const request = JSON.parse(options.body); calls.push({ url, request })
    if (request.action === 'reserve-session') return Response.json({ sessionId: 'studio-session' })
    if (url === '/.dsh/remote-stream') return new Response(new ReadableStream({ start(controller) {
      stream = controller; options.signal.addEventListener('abort', () => controller.error(options.signal.reason), { once: true })
    } }))
    const data = request.payload.args.request
    let value = {}
    if (request.method === 'session/create') value = { sessionId: 'studio-session' }
    if (request.method === 'session/prompt' && !held) queueMicrotask(() => {
      const event = (type, data) => ({ type: 'event', event: { type, data } })
      const frames = [
        event('turn/start', { turn: 1 }), event('user/message', { source: { rpcId: 'another-request' } }),
        event('assistant/message', { turn: 1, message: { content: [{ type: 'text', text: '其他请求的回复' }] } }), event('turn/end', { turn: 1, reason: { kind: 'completed' } }),
        event('turn/start', { turn: 2 }), event('user/message', { source: { rpcId: data.requestId } }),
        { type: 'assistant-stream', frame: { type: 'start', turn: 2, attemptId: 'own-attempt' } },
        { type: 'assistant-stream', frame: { type: 'chunk', attemptId: 'own-attempt', chunk: { type: 'text-delta', text: '欢迎。' } } },
        { type: 'assistant-stream', frame: { type: 'end', attemptId: 'own-attempt', outcome: { kind: abandoned ? 'abandoned' : 'committed' } } },
        event('assistant/message', { turn: 2, message: { content: [{ type: 'text', text: '欢迎。' }] } }), event('turn/end', { turn: 2, reason: { kind: 'completed' } }),
      ]
      const bytes = encoder.encode(frames.map(frame => JSON.stringify(frame)).join('\n') + '\n')
      for (let offset = 0; offset < bytes.length; offset += 7) stream.enqueue(bytes.slice(offset, offset + 7))
    })
    return Response.json({ rpcId: request.rpcId, result: { ok: true, value } })
  }
  return { calls, restore() { globalThis.fetch = original } }
}

test('直播只播报本次请求，跨网络分片的中文完整保留', async () => {
  const fixture = modelFixture(), output = [], sentences = []
  const model = new LiveModel(text => output.push(text), '直播工作室 · 弹幕'), buffer = new SentenceBuffer(text => sentences.push(text))
  try {
    const reply = await model.ask('欢迎观众', text => buffer.push(text)); buffer.push(reply, true)
    assert.equal(reply, '欢迎。'); assert.deepEqual(sentences, ['欢迎。']); assert.ok(output.every(text => text === '欢迎。'))
    assert.equal(fixture.calls.find(call => call.request.method === 'session/rename').request.payload.args.request.title, '直播工作室 · 弹幕')
  } finally { fixture.restore() }
})

test('模型放弃已开始的回复时停止，而不是将片段标记为完成', async () => {
  const fixture = modelFixture({ abandoned: true }), model = new LiveModel(() => {})
  try { await assert.rejects(model.ask('测试'), /放弃/u); assert.ok(fixture.calls.some(call => call.request.method === 'session/cancel')) }
  finally { fixture.restore() }
})

test('停止等待中的模型会中止流，只取消自己的会话', async () => {
  const fixture = modelFixture({ held: true }), model = new LiveModel(() => {})
  try {
    const task = model.ask('测试'), rejected = assert.rejects(task)
    for (let attempt = 0; attempt < 100 && !fixture.calls.some(call => call.request.method === 'session/prompt'); attempt++) await new Promise(resolve => setImmediate(resolve))
    assert.ok(fixture.calls.some(call => call.request.method === 'session/prompt'))
    await model.stop(); await rejected
    const cancels = fixture.calls.filter(call => call.request.method === 'session/cancel')
    assert.ok(cancels.length > 0); assert.ok(cancels.every(call => call.request.payload.args.request.sessionId === 'studio-session'))
  } finally { fixture.restore() }
})
