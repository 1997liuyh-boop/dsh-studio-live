import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { zipSync, strToU8 } from 'fflate'
import { apply } from '../studios/live/lib/index.js'

const bundled = await build({ entryPoints: [fileURLToPath(new URL('../studios/live/src/live2d-package.ts', import.meta.url))], write: false, bundle: true, platform: 'node', format: 'esm' })
const { readLive2dPackage, live2dContentType } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'))
const json = value => strToU8(JSON.stringify(value))
function fixture(change = () => {}, additional = {}) {
  const model = { Version: 3, FileReferences: { Moc: 'a.moc3', Textures: ['a.png'], Expressions: [{ Name: 'smile', File: 'smile.exp3.json' }], Motions: { Idle: [{ File: 'idle.motion3.json', Sound: 'untrusted.wav' }] } }, Groups: [{ Target: 'Parameter', Name: 'LipSync', Ids: ['ParamMouthOpenY'] }] }
  change(model)
  const png = new Uint8Array(24)
  png.set([137, 80, 78, 71, 13, 10, 26, 10])
  const dimensions = new DataView(png.buffer); dimensions.setUint32(16, 1); dimensions.setUint32(20, 1)
  return zipSync({ 'Avatar/a.model3.json': json(model), 'Avatar/a.moc3': strToU8('MOC3test'), 'Avatar/a.png': png, 'Avatar/smile.exp3.json': json({ Type: 'Live2D Expression', Parameters: [] }), 'Avatar/idle.motion3.json': json({ Version: 3 }), ...additional }, { level: 0 })
}

test('模型包保留引用资源和表情，删除模型声音与未引用脚本', () => {
  const asset = readLive2dPackage(fixture(() => {}, { 'Avatar/script.js': strToU8('throw 1'), 'Avatar/unused.json': json({ unused: true }) }))
  assert.equal(asset.entry, 'Avatar/a.model3.json')
  assert.deepEqual(asset.expressions, ['smile'])
  assert.equal(asset.files.has('Avatar/script.js'), false)
  assert.equal(asset.files.has('Avatar/unused.json'), false)
  const settings = JSON.parse(new TextDecoder().decode(asset.files.get(asset.entry)))
  assert.deepEqual(settings.FileReferences.Motions.Idle, [{ File: 'idle.motion3.json' }])
  assert.equal(live2dContentType('a.png'), 'image/png')
  assert.equal(live2dContentType('a.model3.json'), 'application/json')
})

test('缺少资源、外部地址、路径逃逸和多个模型会被拒绝', () => {
  for (const path of ['missing.moc3', '../a.moc3', '/a.moc3', 'https://example.com/a.moc3', '%2e%2e/a.moc3']) assert.throws(() => readLive2dPackage(fixture(model => { model.FileReferences.Moc = path })))
  assert.throws(() => readLive2dPackage(fixture(() => {}, { '../a.json': json({}) })), /路径/)
  assert.throws(() => readLive2dPackage(fixture(() => {}, { 'b.model3.json': json({}) })), /一个 model3/)
  assert.throws(() => readLive2dPackage(fixture(model => { model.FileReferences.Expressions.push({ Name: 'smile', File: 'smile.exp3.json' }) })), /重复/)
  assert.throws(() => readLive2dPackage(fixture(() => {}, { 'Avatar/smile.exp3.json': strToU8('broken json') })))
  assert.throws(() => readLive2dPackage(fixture(() => {}, { 'Avatar/a.png': new Uint8Array(20) })), /贴图/)
  assert.throws(() => readLive2dPackage(fixture(model => { model.Groups[0].Ids = [123] })), /参数组/)
  assert.throws(() => readLive2dPackage(fixture(model => { model.HitAreas = [{ Id: 123, Name: 'Head' }] })), /点击区域/)
  const largePng = new Uint8Array(24)
  largePng.set([137, 80, 78, 71, 13, 10, 26, 10])
  const dimensions = new DataView(largePng.buffer); dimensions.setUint32(16, 4096); dimensions.setUint32(20, 4096)
  assert.throws(() => readLive2dPackage(fixture(model => { model.FileReferences.Textures = ['a.png', 'b.png', 'c.png'] }, { 'Avatar/a.png': largePng, 'Avatar/b.png': largePng, 'Avatar/c.png': largePng })), /贴图总量/)
})

test('在解压前拒绝过多文件、虚报解压体积和重复 ZIP 路径', () => {
  assert.throws(() => readLive2dPackage(fixture(() => {}, Object.fromEntries(Array.from({ length: 257 }, (_, i) => [`extra/${i}.json`, json({})])))), /过大/)
  const bytes = Buffer.from(fixture())
  const directory = bytes.indexOf(Buffer.from([80, 75, 1, 2]))
  assert.ok(directory > 0)
  bytes.writeUInt32LE(200_000_000, directory + 24)
  assert.throws(() => readLive2dPackage(bytes), /过大/)
  const duplicate = Buffer.from(zipSync({ 'same.json': json({}), 'diff.json': json({}) }))
  for (let at = duplicate.indexOf('diff.json'); at !== -1; at = duplicate.indexOf('diff.json')) duplicate.write('same.json', at)
  assert.throws(() => readLive2dPackage(duplicate), /重复路径/)
})

test('官方 Haru 模型可解析，素材不作为测试分发', async context => {
  let bytes
  try { bytes = await readFile(new URL('../.local-live2d/Haru.zip', import.meta.url)) }
  catch (error) { if (error.code === 'ENOENT') { context.skip('本机未准备官方素材'); return } throw error }
  const asset = readLive2dPackage(bytes)
  assert.match(asset.entry, /Haru.*model3.json/iu)
  assert.ok(asset.expressions.length > 0)
  assert.ok(asset.files.size > 10)
})

test('模型资源按版本提供，OBS 资源需要令牌，失败导入保留原模型', async context => {
  const effects = []
  let page
  await apply({ effect(callback) { effects.push(callback()) }, on() {}, studioProjects: { register(value) { page = value; return () => { page = undefined } } } })
  const server = createServer((req, res) => { void page.handle(req, res, new URL(req.url, 'http://localhost').pathname.replace(/^\/studio-projects\/live\//u, '')) })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const origin = `http://127.0.0.1:${server.address().port}`
  const post = async value => (await fetch(origin + '/studio-projects/live/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })).json()
  const upload = body => fetch(origin + '/studio-projects/live/avatar', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body })
  try {
    const options = await post({ action: 'avatar-options' })
    if (!options.live2dAvailable) { assert.equal((await upload(fixture())).status, 400); context.diagnostic('未装 Core 的普通构建明确拒绝 Live2D'); return }
    const result = await upload(fixture()); assert.equal(result.status, 200)
    const model = await result.json()
    assert.equal(model.kind, 'live2d')
    assert.deepEqual(model.expressions, ['smile'])
    assert.equal((await fetch(origin + model.modelUrl)).status, 200)
    assert.equal((await fetch(origin + model.modelUrl.replace('a.model3.json', 'script.js'))).status, 404)
    assert.equal((await upload(fixture(m => { m.FileReferences.Moc = 'missing.moc3' }))).status, 400)
    assert.equal((await fetch(origin + model.modelUrl)).status, 200)
    const { overlayUrl } = await post({ action: 'overlay', text: '', speaking: false, avatar: '' })
    const overlay = new URL(overlayUrl)
    const state = await (await fetch(overlay.origin + '/state' + overlay.search)).json()
    assert.equal((await fetch(overlay.origin + state.modelUrl)).status, 200)
    assert.equal((await fetch(overlay.origin + state.modelUrl.replace(/\/models\/[^/]+\//u, '/models/invalid/'))).status, 403)
    const { runId } = await post({ action: 'run-start' })
    const frame = { action: 'frame', runId, text: '你好', speaking: true, mouth: 0.8, emotion: 'neutral', expression: 'smile' }
    assert.equal((await post(frame)).overlayUrl, overlayUrl)
    assert.match((await post({ ...frame, expression: 'unknown' })).error, /已有的表情/)
    const next = await (await upload(fixture())).json()
    assert.notEqual(next.version, model.version)
    assert.equal((await fetch(origin + model.modelUrl)).status, 404)
    await post({ action: 'run-stop', runId })
  } finally {
    await new Promise(done => { server.closeAllConnections(); server.close(done) })
    for (const dispose of effects.reverse()) await dispose()
  }
})
