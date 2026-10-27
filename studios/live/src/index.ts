import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import { obsRequest, record } from './obs'
import { BiliGateway } from './bilibili'
import { synthesize } from './tts'
import { MinecraftAdapter } from './minecraft'

export const name = 'dsh-studio-live'
export const inject = ['studioProjects', 'tools']
declare const STUDIO_PROJECT: { name: string; icon: string; description: string }
interface Host {
  studioProjects: { register(page: { id: string; root: string; name: string; icon: string; description: string; handle(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> }): () => void }
  effect(callback: () => (() => void | Promise<void>), label: string): void
}

/** 独立的直播插件只注册自己的路由和回环叠加层，卸载后关闭服务器。 */
export async function apply(ctx: Host & Context): Promise<void> {
  const reservations = new Set<string>()
  const agents = new Map<string, () => Promise<void>>()
  ctx.on('agent/created', ({ agent }) => {
    if (!reservations.delete(agent.id)) return
    ctx.effect(() => {
      const release = agent.ctx.tools.guard(() => '直播回复只允许文字输出；游戏动作由工作室校验后执行')
      agents.set(agent.id, async () => { agent.cancel({ kind: 'disposed' }); await agent.whenIdle() })
      return async () => {
        agent.cancel({ kind: 'disposed' })
        await agent.whenIdle()
        release()
        agents.delete(agent.id)
      }
    }, '直播：停止会话后解除工具限制')
  })
  const token = randomBytes(32).toString('hex')
  const styles = await readFile(new URL('../static/app.css', import.meta.url), 'utf8')
  let overlay = { text: '', speaking: false, avatar: '', mouth: 0, emotion: 'neutral', avatarKind: '', avatarVersion: 0 }
  let asset: Buffer | undefined, assetType = ''
  const gateway = new BiliGateway()
  const minecraft = new MinecraftAdapter()
  let runId = '', leaseAt = 0, runController = new AbortController()
  let stardew: { port: number; token: string } | undefined
  let transitions = Promise.resolve()
  const stopRuntime = async () => {
    runId = ''; runController.abort(); overlay = { ...overlay, text: '', speaking: false, mouth: 0 }
    const game = stardew; stardew = undefined
    const stopGame = async () => {
      if (!game) return
      const response = await fetch(`http://127.0.0.1:${game.port}/action`, { method: 'POST', headers: { Authorization: 'Bearer ' + game.token, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'stop', frames: 1 }), signal: AbortSignal.timeout(5000), redirect: 'error' })
      if (!response.ok) throw new Error('星露谷停止请求失败，请使用游戏内 F8 紧急停止')
    }
    await Promise.all([gateway.stop(), minecraft.stop(), stopGame(), ...Array.from(agents.values(), cancel => cancel())])
  }
  const serial = (action: () => Promise<void>) => { const task = transitions.then(action); transitions = task.catch(error => console.warn('直播生命周期操作失败', error)); return task }
  const requireRun = (id: unknown) => { if (!runId || id !== runId || runController.signal.aborted) throw new Error('直播运行已结束，请重新开始预演'); leaseAt = Date.now() }
  const leaseTimer = setInterval(() => { if (runId && Date.now() - leaseAt > 15000) void serial(stopRuntime) }, 3000)
  ctx.effect(() => async () => { clearInterval(leaseTimer); await serial(stopRuntime); asset = undefined }, '直播：停止连接、语音与所属会话')
  const overlayScript = await readFile(new URL('../static/overlay.js', import.meta.url))
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.method !== 'GET' || req.headers.host !== `127.0.0.1:${port}` || url.searchParams.get('token') !== token) { res.writeHead(403); res.end(); return }
    res.setHeader('cache-control', 'no-store')
    res.setHeader('x-content-type-options', 'nosniff')
    if (url.pathname === '/state') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(overlay)); return }
    if (url.pathname === '/avatar' && asset) { res.setHeader('content-type', assetType); res.end(asset); return }
    if (url.pathname === '/overlay.js') { res.setHeader('content-type', 'text/javascript'); res.end(overlayScript); return }
    if (url.pathname === '/overlay.css') { res.setHeader('content-type', 'text/css'); res.end(styles); return }
    if (url.pathname !== '/overlay') { res.writeHead(404); res.end(); return }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.setHeader('content-security-policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self' blob: data:; worker-src blob:")
    res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="/overlay.css?token=${token}"><body class="m-0 bg-transparent font-sans text-[28px] text-white [text-shadow:0_2px_6px_#000]"><img hidden alt="" class="h-[360px] max-w-[480px] origin-bottom object-contain motion-reduce:animate-none"><div hidden id="stage" class="h-[480px] w-[720px]"></div><p class="max-w-[800px] whitespace-pre-wrap"></p><script type="module" src="/overlay.js?token=${token}"></script></body></html>`)
  })
  await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', () => { server.removeListener('error', fail); done() }) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('直播预览端口不可用')
  const port = address.port
  const overlayUrl = `http://127.0.0.1:${port}/overlay?token=${token}`
  ctx.effect(() => () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }), '直播：关闭叠加层')
  const send = (res: ServerResponse, code: number, value: object) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)) }
  ctx.effect(() => ctx.studioProjects.register({ id: 'live', ...STUDIO_PROJECT, root: fileURLToPath(new URL('../static/', import.meta.url)), async handle(req, res, path) {
    if (path === 'avatar') {
      if (req.method !== 'POST' || req.headers['sec-fetch-site'] === 'cross-site' || req.headers['content-type'] !== 'application/octet-stream') { send(res, 403, { error: '形象请求来源无效' }); return true }
      try {
        const chunks: Buffer[] = []; let size = 0
        for await (const chunk of req) { size += chunk.length; if (size > 32_000_000) throw new Error('形象文件最多 32 MB'); chunks.push(chunk) }
        const bytes = Buffer.concat(chunks)
        const vrm = bytes.length >= 20 && bytes.toString('ascii', 0, 4) === 'glTF' && bytes.readUInt32LE(4) === 2 && bytes.readUInt32LE(8) === bytes.length
        const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
        if (!vrm && !png && !jpeg && !webp) throw new Error('请导入有效的 VRM、PNG、WebP 或 JPG 文件')
        asset = bytes; assetType = vrm ? 'application/octet-stream' : png ? 'image/png' : jpeg ? 'image/jpeg' : 'image/webp'
        overlay = { ...overlay, avatarKind: vrm ? 'vrm' : 'image', avatarVersion: overlay.avatarVersion + 1 }
        send(res, 200, { kind: overlay.avatarKind, version: overlay.avatarVersion })
      } catch (error) { send(res, 400, { error: error instanceof Error ? error.message : '形象导入失败' }) }
      return true
    }
    if (path !== 'api') return false
    if (req.method !== 'POST') { send(res, 405, { error: '仅支持 POST' }); return true }
    if (req.headers['sec-fetch-site'] === 'cross-site' || req.headers['content-type']?.split(';')[0] !== 'application/json') { send(res, 403, { error: '请求来源无效' }); return true }
    try {
      const chunks: Buffer[] = []; let size = 0
      for await (const chunk of req) { size += chunk.length; if (size > 8_000_000) throw new Error('请求过大'); chunks.push(chunk) }
      const input = record(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      if (input.action === 'run-start') {
        await serial(async () => { await stopRuntime(); runController = new AbortController(); runId = randomUUID(); leaseAt = Date.now() })
        send(res, 200, { runId, overlayUrl })
      } else if (input.action === 'run-stop') {
        await serial(async () => { if (runId && input.runId === runId) await stopRuntime() })
        send(res, 200, { stopped: true })
      } else if (input.action === 'touch') {
        requireRun(input.runId); send(res, 200, { active: true })
      } else if (input.action === 'voice') {
        requireRun(input.runId)
        if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 400 || !['zh-CN-XiaoyiNeural','zh-CN-XiaoxiaoNeural','zh-CN-YunxiNeural'].includes(String(input.voice))) throw new Error('语音文字或音色无效')
        const cancelled = new AbortController()
        const closed = () => { if (!res.writableEnded) cancelled.abort() }
        res.once('close', closed)
        try {
          const signal = AbortSignal.any([runController.signal, cancelled.signal, AbortSignal.timeout(20000)])
          const audio = await synthesize(input.text, String(input.voice), signal)
          signal.throwIfAborted(); requireRun(input.runId)
          send(res, 200, { audio: audio.toString('base64') })
        } finally { res.removeListener('close', closed) }
      } else if (input.action === 'bili-start') {
        requireRun(input.runId)
        if (typeof input.roomId !== 'string' || !/^\d{1,16}$/u.test(input.roomId) || typeof input.cookie !== 'string' || input.cookie.length < 10 || input.cookie.length > 16000 || /[\r\n]/u.test(input.cookie)) throw new Error('请填写直播间数字房间号和有效 Cookie')
        const config = { roomId: input.roomId, cookie: input.cookie }
        await serial(async () => { requireRun(input.runId); await gateway.start(config); requireRun(input.runId) })
        send(res, 200, { state: gateway.snapshot(0).state })
      } else if (input.action === 'bili-stop') {
        await serial(async () => { requireRun(input.runId); await gateway.stop() }); send(res, 200, { state: gateway.snapshot(0).state })
      } else if (input.action === 'bili-poll') {
        requireRun(input.runId); send(res, 200, gateway.snapshot(typeof input.after === 'number' ? input.after : 0))
      } else if (input.action === 'frame') {
        requireRun(input.runId)
        if (typeof input.text !== 'string' || input.text.length > 1000 || typeof input.speaking !== 'boolean' || typeof input.mouth !== 'number' || !Number.isFinite(input.mouth) || input.mouth < 0 || input.mouth > 1 || !['neutral','happy','relaxed','surprised','sad'].includes(String(input.emotion))) throw new Error('形象状态无效')
        overlay = { ...overlay, text: input.text, speaking: input.speaking, mouth: input.mouth, emotion: String(input.emotion) }; send(res, 200, { overlayUrl })
      } else if (input.action === 'minecraft-start') {
        requireRun(input.runId)
        if (typeof input.port !== 'number' || !Number.isInteger(input.port) || input.port < 1024 || input.port > 65535 || typeof input.username !== 'string' || !/^[a-zA-Z0-9_]{3,16}$/u.test(input.username)) throw new Error('请填写本机 Minecraft 测试服端口和 3 至 16 位英文玩家名')
        await minecraft.start(input.port, input.username); requireRun(input.runId); send(res, 200, { connected: true })
      } else if (input.action === 'minecraft-state' || input.action === 'minecraft-action') {
        requireRun(input.runId)
        if (input.action === 'minecraft-action' && typeof input.command !== 'string') throw new Error('Minecraft 动作无效')
        send(res, 200, await minecraft.request(input.action === 'minecraft-state' ? 'state' : String(input.command)))
      } else if (input.action === 'reserve-session') {
        if (reservations.size >= 32) throw new Error('待建立直播会话过多，请重启插件')
        const sessionId = randomUUID(); reservations.add(sessionId); send(res, 200, { sessionId })
      } else if (input.action === 'overlay') {
        if (typeof input.text !== 'string' || input.text.length > 1000 || typeof input.speaking !== 'boolean'
          || typeof input.avatar !== 'string' || input.avatar.length > 7_000_000 || input.avatar !== '' && !/^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(input.avatar)) throw new Error('叠加层内容无效')
        overlay = { ...overlay, text: input.text, speaking: input.speaking, avatar: input.avatar }
        send(res, 200, { overlayUrl })
      } else if (input.action === 'obs-status' || input.action === 'obs-overlay') {
        if (typeof input.port !== 'number' || typeof input.password !== 'string') throw new Error('OBS 参数无效')
        if (input.action === 'obs-status') {
          const version = await obsRequest(input.port, input.password, 'GetVersion')
          const stream = await obsRequest(input.port, input.password, 'GetStreamStatus')
          const scenes = await obsRequest(input.port, input.password, 'GetSceneList')
          send(res, 200, { version, stream, scenes, overlayUrl })
        } else {
          if (typeof input.scene !== 'string' || !input.scene || input.scene.length > 256) throw new Error('请选择 OBS 场景')
          const result = await obsRequest(input.port, input.password, 'CreateInput', { sceneName: input.scene, inputName: 'DSH 直播形象 ' + Date.now(), inputKind: 'browser_source', inputSettings: { url: overlayUrl, width: 960, height: 540 }, sceneItemEnabled: true })
          send(res, 200, result)
        }
      } else if (input.action === 'game-state' || input.action === 'game-action') {
        if (input.action === 'game-action') requireRun(input.runId)
        if (typeof input.port !== 'number' || !Number.isInteger(input.port) || input.port < 1024 || input.port > 65535 || typeof input.token !== 'string' || !/^[a-f0-9]{64}$/.test(input.token)) throw new Error('请填写星露谷模组端口和连接令牌')
        const command = record(input.command)
        if (input.action === 'game-action' && (!['up', 'down', 'left', 'right', 'use', 'interact', 'stop'].includes(String(command.action)) || typeof command.frames !== 'number' || !Number.isInteger(command.frames) || command.frames < 1 || command.frames > 60)) throw new Error('游戏动作无效')
        if (input.action === 'game-action') stardew = { port: input.port, token: input.token }
        const response = await fetch(`http://127.0.0.1:${input.port}/${input.action === 'game-state' ? 'state' : 'action'}`, {
          method: input.action === 'game-state' ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + input.token, 'content-type': 'application/json' },
          ...(input.action === 'game-state' ? {} : { body: JSON.stringify(command) }), signal: input.action === 'game-action' ? AbortSignal.any([runController.signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000), redirect: 'error',
        })
        const value = await response.text()
        if (!response.ok || value.length > 65536) throw new Error(response.ok ? '游戏状态过大' : '星露谷模组未就绪：' + response.status)
        send(res, 200, record(JSON.parse(value)))
      } else send(res, 400, { error: '未知直播操作' })
    } catch (error) { send(res, 400, { error: error instanceof Error ? error.message : '直播操作失败' }) }
    return true
  } }), '直播：登记页面与本机连接')
}
