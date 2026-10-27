import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = await mkdtemp(join(tmpdir(), 'dsh-live-minecraft-'))
after(async () => {
  assert.equal(dirname(root), tmpdir())
  await rm(root, { recursive: true, force: true })
})
await build({ entryPoints: [fileURLToPath(new URL('../studios/live/src/minecraft.ts', import.meta.url))], outfile: join(root, 'adapter.mjs'), bundle: true, platform: 'node', format: 'esm' })
await writeFile(join(root, 'minecraft-worker.cjs'), `
const { parentPort } = require('node:worker_threads')
parentPort.postMessage({ type: 'ready' })
parentPort.on('message', message => parentPort.postMessage({ id: message.id, state: { connected: true, action: message.action } }))
`)
const { MinecraftAdapter } = await import(pathToFileURL(join(root, 'adapter.mjs')).href)

test('连接准备期间停止，不再创建游戏 Worker，也不返回连接成功', async context => {
  const adapter = new MinecraftAdapter()
  context.after(() => adapter.stop())
  const starting = adapter.start(25565, 'DshTestBot')
  const rejected = assert.rejects(starting, /已停止/u)
  await adapter.stop()
  await rejected
  await assert.rejects(adapter.request('state'), /已停止/u)
})

test('正常连接的 Worker 可以返回状态，停止后拒绝新动作', async context => {
  const adapter = new MinecraftAdapter()
  context.after(() => adapter.stop())
  await adapter.start(25565, 'DshTestBot')
  assert.deepEqual(await adapter.request('state'), { connected: true, action: 'state' })
  await adapter.stop()
  await assert.rejects(adapter.request('forward'), /已停止/u)
})
