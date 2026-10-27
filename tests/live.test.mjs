import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { apply } from '../studios/live/lib/index.js'

async function moduleFrom(path) {
  const result = await build({ entryPoints: [new URL(path, import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, '')], write: false, bundle: true, platform: 'node', format: 'esm' })
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))
}

test('练习场种植到收获，拒绝越界与非声明模型动作', async () => {
  const game = await moduleFrom('../studios/live/src/game.ts')
  let farm = game.newFarm()
  farm = game.stepFarm(farm, 'up')
  assert.equal(farm.y, 0)
  for (const action of ['plant', 'water', 'wait', 'harvest']) farm = game.stepFarm(farm, action)
  assert.equal(farm.harvest, 1)
  assert.equal(farm.plots[0], 0)
  assert.throws(() => game.parseDecision('{"action":"shell","speech":"x"}', game.gameActions))
  assert.deepEqual(game.parseDecision('```json\n{"action":"water","speech":"浇水"}\n```', game.gameActions), { action: 'water', speech: '浇水' })
})

test('真实插件注册、令牌叠加层、输入校验和卸载关闭服务器', async () => {
  const effects = [], events = new Map()
  let page
  await apply({ effect(callback) { effects.push(callback()) }, on(name, callback) { events.set(name, callback) }, studioProjects: { register(value) { page = value; return () => { page = undefined } } } })
  assert.equal(page.id, 'live')
  const server = createServer((req, res) => { void page.handle(req, res, 'api') })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const url = `http://127.0.0.1:${server.address().port}/api`
  const post = async (value, headers = {}) => {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(value) })
    return { status: response.status, value: await response.json() }
  }
  let overlayUrl
  try {
    assert.equal((await post({ action: 'overlay', text: 'x', speaking: false, avatar: '' }, { 'sec-fetch-site': 'cross-site' })).status, 403)
    const state = await post({ action: 'overlay', text: '真实字幕', speaking: false, avatar: '' })
    assert.equal(state.status, 200); overlayUrl = state.value.overlayUrl
    const parsed = new URL(overlayUrl)
    assert.equal((await fetch(parsed.origin + '/state')).status, 403)
    assert.deepEqual(await (await fetch(parsed.origin + '/state' + parsed.search)).json(), { text: '真实字幕', speaking: false, avatar: '', mouth: 0, emotion: 'neutral', avatarKind: '', avatarVersion: 0 })
    assert.equal((await post({ action: 'overlay', text: '<script>x</script>', speaking: false, avatar: 'file:///secret.png' })).status, 400)
    assert.equal((await post({ action: 'game-action', port: 33107, token: 'a'.repeat(64), command: { action: 'arbitrary', frames: 1 } })).status, 400)
    const first = await post({ action: 'run-start' })
    assert.equal((await post({ action: 'frame', runId: first.value.runId, text: '播放中', speaking: true, mouth: 0.7, emotion: 'happy' })).status, 200)
    assert.equal((await post({ action: 'minecraft-action', runId: first.value.runId, command: 'shell' })).status, 400)
    const second = await post({ action: 'run-start' })
    assert.equal((await post({ action: 'frame', runId: first.value.runId, text: '过期', speaking: true, mouth: 1, emotion: 'happy' })).status, 400)
    await post({ action: 'run-stop', runId: first.value.runId })
    assert.equal((await post({ action: 'touch', runId: second.value.runId })).status, 200)
    await post({ action: 'run-stop', runId: second.value.runId })
    assert.equal((await post({ action: 'touch', runId: second.value.runId })).status, 400)
    const stopped = await (await fetch(parsed.origin + '/state' + parsed.search)).json()
    assert.equal(stopped.speaking, false); assert.equal(stopped.mouth, 0)
    const reserved = await post({ action: 'reserve-session' })
    assert.match(reserved.value.sessionId, /^[a-f0-9-]{36}$/)
    let guarded = false, cancelled = false, settled = false
    events.get('agent/created')({ agent: { id: reserved.value.sessionId,
      cancel(cause) { assert.deepEqual(cause, { kind: 'disposed' }); cancelled = true },
      async whenIdle() { assert.equal(cancelled, true); settled = true },
      ctx: { tools: { guard(fn) { guarded = !!fn(); return () => { assert.equal(settled, true) } } } } } })
    assert.equal(guarded, true)
  } finally {
    await new Promise(done => { server.closeAllConnections(); server.close(done) })
    for (const dispose of effects.reverse()) await dispose()
  }
  await assert.rejects(fetch(overlayUrl))
})

test('OBS v5 使用挑战认证，拒绝的请求不能显示成功', async () => {
  const { obsRequest } = await moduleFrom('../studios/live/src/obs.ts')
  const Original = globalThis.WebSocket
  let authenticated = false
  class FakeSocket {
    constructor() { queueMicrotask(() => this.onmessage({ data: JSON.stringify({ op: 0, d: { authentication: { salt: 'salt', challenge: 'challenge' } } }) })) }
    close() {}
    send(text) {
      const message = JSON.parse(text)
      if (message.op === 1) {
        const hash = value => createHash('sha256').update(value).digest('base64')
        assert.equal(message.d.authentication, hash(hash('passwordsalt') + 'challenge'))
        authenticated = true
        queueMicrotask(() => this.onmessage({ data: '{"op":2,"d":{}}' }))
      } else queueMicrotask(() => this.onmessage({ data: JSON.stringify({ op: 7, d: { requestId: message.d.requestId, requestStatus: { result: false, comment: '测试拒绝' } } }) }))
    }
  }
  globalThis.WebSocket = FakeSocket
  try { await assert.rejects(obsRequest(4455, 'password', 'GetVersion'), /测试拒绝/); assert.equal(authenticated, true) }
  finally { globalThis.WebSocket = Original }
  await assert.rejects(obsRequest(4455, '', 'StartStream'), /不支持/)
})
