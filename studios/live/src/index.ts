import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import { obsRequest, record } from './obs'

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
  ctx.on('agent/created', ({ agent }) => {
    if (!reservations.delete(agent.id)) return
    ctx.effect(() => {
      const release = agent.ctx.tools.guard(() => '直播回复只允许文字输出；游戏动作由工作室校验后执行')
      return async () => {
        agent.cancel({ kind: 'disposed' })
        await agent.whenIdle()
        release()
      }
    }, '直播：停止会话后解除工具限制')
  })
  const token = randomBytes(32).toString('hex')
  const styles = await readFile(new URL('../static/app.css', import.meta.url), 'utf8')
  let overlay = { text: '', speaking: false, avatar: '' }
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.method !== 'GET' || req.headers.host !== `127.0.0.1:${port}` || url.searchParams.get('token') !== token) { res.writeHead(403); res.end(); return }
    res.setHeader('cache-control', 'no-store')
    res.setHeader('x-content-type-options', 'nosniff')
    if (url.pathname === '/state') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(overlay)); return }
    if (url.pathname === '/overlay.css') { res.setHeader('content-type', 'text/css'); res.end(styles); return }
    if (url.pathname !== '/overlay') { res.writeHead(404); res.end(); return }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.setHeader('content-security-policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'self'; img-src data:; connect-src 'self'")
    res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><link rel="stylesheet" href="/overlay.css?token=${token}"><body class="m-0 bg-transparent font-sans text-[28px] text-white [text-shadow:0_2px_6px_#000]"><img alt="" class="h-[360px] max-w-[480px] origin-bottom object-contain motion-reduce:animate-none"><p class="max-w-[800px] whitespace-pre-wrap"></p><script>const token=new URLSearchParams(location.search).get('token');const avatar=document.querySelector('img');async function refresh(){try{const r=await fetch('/state?token='+token);if(!r.ok)throw Error();const s=await r.json();document.querySelector('p').textContent=s.text;avatar.classList.toggle('animate-pulse',s.speaking);if(s.avatar)avatar.src=s.avatar;}catch{avatar.classList.remove('animate-pulse')}setTimeout(refresh,350)}refresh()</script></body></html>`)
  })
  await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', () => { server.removeListener('error', fail); done() }) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('直播预览端口不可用')
  const port = address.port
  const overlayUrl = `http://127.0.0.1:${port}/overlay?token=${token}`
  ctx.effect(() => () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) }), '直播：关闭叠加层')
  const send = (res: ServerResponse, code: number, value: object) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)) }
  ctx.effect(() => ctx.studioProjects.register({ id: 'live', ...STUDIO_PROJECT, root: fileURLToPath(new URL('../static/', import.meta.url)), async handle(req, res, path) {
    if (path !== 'api') return false
    if (req.method !== 'POST') { send(res, 405, { error: '仅支持 POST' }); return true }
    if (req.headers['sec-fetch-site'] === 'cross-site' || req.headers['content-type']?.split(';')[0] !== 'application/json') { send(res, 403, { error: '请求来源无效' }); return true }
    try {
      const chunks: Buffer[] = []; let size = 0
      for await (const chunk of req) { size += chunk.length; if (size > 8_000_000) throw new Error('请求过大'); chunks.push(chunk) }
      const input = record(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      if (input.action === 'reserve-session') {
        if (reservations.size >= 32) throw new Error('待建立直播会话过多，请重启插件')
        const sessionId = randomUUID(); reservations.add(sessionId); send(res, 200, { sessionId })
      } else if (input.action === 'overlay') {
        if (typeof input.text !== 'string' || input.text.length > 1000 || typeof input.speaking !== 'boolean'
          || typeof input.avatar !== 'string' || input.avatar.length > 7_000_000 || input.avatar !== '' && !/^data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(input.avatar)) throw new Error('叠加层内容无效')
        overlay = { text: input.text, speaking: input.speaking, avatar: input.avatar }
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
        if (typeof input.port !== 'number' || !Number.isInteger(input.port) || input.port < 1024 || input.port > 65535 || typeof input.token !== 'string' || !/^[a-f0-9]{64}$/.test(input.token)) throw new Error('请填写星露谷模组端口和连接令牌')
        const command = record(input.command)
        if (input.action === 'game-action' && (!['up', 'down', 'left', 'right', 'use', 'interact', 'stop'].includes(String(command.action)) || typeof command.frames !== 'number' || !Number.isInteger(command.frames) || command.frames < 1 || command.frames > 60)) throw new Error('游戏动作无效')
        const response = await fetch(`http://127.0.0.1:${input.port}/${input.action === 'game-state' ? 'state' : 'action'}`, {
          method: input.action === 'game-state' ? 'GET' : 'POST', headers: { Authorization: 'Bearer ' + input.token, 'content-type': 'application/json' },
          ...(input.action === 'game-state' ? {} : { body: JSON.stringify(command) }), signal: AbortSignal.timeout(5000), redirect: 'error',
        })
        const value = await response.text()
        if (!response.ok || value.length > 65536) throw new Error(response.ok ? '游戏状态过大' : '星露谷模组未就绪：' + response.status)
        send(res, 200, record(JSON.parse(value)))
      } else send(res, 400, { error: '未知直播操作' })
    } catch (error) { send(res, 400, { error: error instanceof Error ? error.message : '直播操作失败' }) }
    return true
  } }), '直播：登记页面与本机连接')
}
