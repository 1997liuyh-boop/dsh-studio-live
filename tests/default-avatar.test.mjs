/** 验证默认模型的资源和运行库缺失时的行为。 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const archive = await readFile(join(root, 'static/default-avatar.zip'))

async function fixture(withCore) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-live-avatar-'))
  await mkdir(join(directory, 'static'), { recursive: true })
  await writeFile(join(directory, 'package.json'), '{"type":"module"}\n')
  await cp(join(root, 'lib'), join(directory, 'lib'), { recursive: true })
  for (const file of ['app.css', 'overlay.js', 'live2d.js', 'default-avatar.zip']) await cp(join(root, 'static', file), join(directory, 'static', file))
  if (withCore) await writeFile(join(directory, 'static/live2dcubismcore.min.js'), 'fixture')
  const cleanups = []; let page
  const { apply } = await import(pathToFileURL(join(directory, 'lib/index.js')))
  await apply({ on() {}, effect(start) { const stop = start(); if (typeof stop === 'function') cleanups.push(stop) }, studioProjects: { register(value) { page = value; return () => {} } } })
  const server = createServer((request, response) => { void page.handle(request, response, request.url.slice(1)).then(handled => { if (!handled) { response.writeHead(404); response.end() } }).catch(error => { response.writeHead(500); response.end(error.message) }) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { url: 'http://127.0.0.1:' + server.address().port, async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); for (const stop of cleanups.reverse()) await stop(); await rm(directory, { recursive: true, force: true }) } }
}

const options = async url => (await fetch(url + '/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'avatar-options' }) })).json()
const upload = (url, body) => fetch(url + '/avatar', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body })

test('缺少运行库时识别内置模型并明确拒绝导入', async () => {
  const app = await fixture(false)
  try {
    const state = await options(app.url)
    assert.equal(state.defaultModelAvailable, true)
    assert.equal(state.live2dAvailable, false)
    const response = await upload(app.url, archive)
    assert.equal(response.status, 400)
    assert.match((await response.json()).error, /运行库未安装/)
  } finally { await app.close() }
})

test('运行库存在时加载内置模型资源，失败导入保留当前模型', async () => {
  const app = await fixture(true)
  try {
    const state = await options(app.url)
    assert.equal(state.defaultModelAvailable, true)
    assert.equal(state.live2dAvailable, true)
    const response = await upload(app.url, archive)
    assert.equal(response.status, 200)
    const avatar = await response.json()
    assert.equal(avatar.kind, 'live2d')
    assert.equal(avatar.name, 'whale-girl-c13-v4')
    assert.equal(avatar.expressions.length, 7)
    const modelPath = avatar.modelUrl.split('/live/')[1]
    const model = await (await fetch(app.url + '/' + modelPath)).json()
    assert.equal(model.FileReferences.Motions.Idle.length, 1)
    assert.deepEqual(model.Groups.find(group => group.Name === 'LipSync').Ids, ['ParamMouthOpenY'])
    assert.deepEqual(model.Groups.find(group => group.Name === 'EyeBlink').Ids, ['ParamEyeLOpen', 'ParamEyeROpen'])
    const base = modelPath.replace(/[^/]+$/, '')
    for (const file of [model.FileReferences.Moc, ...model.FileReferences.Textures, model.FileReferences.Physics, model.FileReferences.Motions.Idle[0].File]) assert.equal((await fetch(app.url + '/' + base + file)).status, 200)
    assert.equal((await upload(app.url, Buffer.from('invalid'))).status, 400)
    assert.equal((await fetch(app.url + '/' + modelPath)).status, 200)
  } finally { await app.close() }
})
