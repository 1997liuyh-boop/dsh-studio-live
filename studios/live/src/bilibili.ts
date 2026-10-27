import { createHash, randomUUID } from 'node:crypto'
import { brotliDecompressSync, inflateSync } from 'node:zlib'
import WebSocket from 'ws'
import { pause } from './pipeline'
import { record } from './obs'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'
const MIXIN = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52]

/** WBI 签名前排序并清除协议禁止的字符，发送时复用同一段查询字符串。 */
export function signedQuery(params: Record<string, string | number>, img: string, sub: string, seconds: number): string {
  const key = MIXIN.map(index => (img + sub)[index] ?? '').join('').slice(0, 32)
  if (key.length !== 32) throw new Error('B站签名密钥无效，请重新连接')
  const all = { ...params, wts: seconds }
  const query = Object.keys(all).sort().map(name => encodeURIComponent(name) + '=' + encodeURIComponent(String(all[name as keyof typeof all]).replace(/[!'()*]/gu, ''))).join('&')
  return query + '&w_rid=' + createHash('md5').update(query + key).digest('hex')
}

/** 二进制帧在长度、解压大小和递归深度校验后交给调用者。 */
export function decodePackets(bytes: Buffer, emit: (op: number, value: Record<string, unknown>) => void, depth = 0): void {
  if (depth > 4 || bytes.length > 2_000_000) throw new Error('B站弹幕帧过大')
  let offset = 0, count = 0
  while (offset < bytes.length) {
    if (++count > 4096 || bytes.length - offset < 16) throw new Error('B站弹幕帧不完整')
    const length = bytes.readUInt32BE(offset), header = bytes.readUInt16BE(offset + 4)
    if (length < 16 || header < 16 || header > length || offset + length > bytes.length) throw new Error('B站弹幕帧长度无效')
    const version = bytes.readUInt16BE(offset + 6), op = bytes.readUInt32BE(offset + 8)
    const body = bytes.subarray(offset + header, offset + length); offset += length
    if (version === 2 || version === 3) {
      const decoded = version === 3 ? brotliDecompressSync(body, { maxOutputLength: 2_000_000 }) : inflateSync(body, { maxOutputLength: 2_000_000 })
      decodePackets(decoded, emit, depth + 1)
    } else if (op === 5 || op === 8) {
      for (const line of body.toString('utf8').split('\0')) if (line.trim()) emit(op, record(JSON.parse(line)))
    } else if (op === 3) emit(op, {})
  }
}

/** 按直播协议封装认证、心跳消息。 */
export function packet(op: number, text: string): Buffer {
  const body = Buffer.from(text), output = Buffer.alloc(16 + body.length)
  output.writeUInt32BE(output.length, 0); output.writeUInt16BE(16, 4); output.writeUInt16BE(1, 6)
  output.writeUInt32BE(op, 8); output.writeUInt32BE(1, 12); body.copy(output, 16)
  return output
}

interface Credentials { roomId: string; cookie: string }
interface ConnectionInfo { uid: number; roomId: number; token: string; url: string; buvid: string }
export interface LiveComment { sequence: number; id: string; name: string; text: string; receivedAt: number }

async function json(url: string, cookie: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch(url, { headers: { cookie, 'user-agent': UA, referer: 'https://live.bilibili.com/' }, signal, redirect: 'error' })
  if (!response.ok) throw new Error('B站请求失败，请检查网络后重新连接')
  const bytes = await response.text()
  if (bytes.length > 2_000_000) throw new Error('B站返回内容过大')
  return record(JSON.parse(bytes))
}

async function connectionInfo(config: Credentials, signal: AbortSignal): Promise<ConnectionInfo> {
  const nav = await json('https://api.bilibili.com/x/web-interface/nav', config.cookie, signal)
  const data = record(nav.data), images = record(data.wbi_img)
  if (nav.code !== 0 || data.isLogin !== true || typeof data.mid !== 'number') throw new Error('B站登录已失效，请重新填写 Cookie')
  const key = (value: unknown) => { if (typeof value !== 'string') throw new Error('B站签名信息缺失'); return new URL(value).pathname.split('/').pop()!.split('.')[0]! }
  const room = await json('https://api.live.bilibili.com/room/v1/Room/room_init?id=' + config.roomId, config.cookie, signal)
  const roomId = record(room.data).room_id
  if (room.code !== 0 || typeof roomId !== 'number') throw new Error('直播间不存在，请检查房间号')
  const query = signedQuery({ id: roomId, type: 0 }, key(images.img_url), key(images.sub_url), Math.floor(Date.now() / 1000))
  const info = await json('https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?' + query, config.cookie, signal)
  const value = record(info.data), hosts = value.host_list
  if (info.code !== 0 || typeof value.token !== 'string' || !Array.isArray(hosts) || !hosts.length) throw new Error('B站拒绝弹幕鉴权，请检查登录状态后重试')
  const host = record(hosts[0])
  if (typeof host.host !== 'string' || !/(?:^|\.)bilibili\.com$/u.test(host.host) || typeof host.wss_port !== 'number' || !Number.isInteger(host.wss_port) || host.wss_port < 1 || host.wss_port > 65535) throw new Error('B站返回的弹幕服务器无效')
  return { uid: data.mid, roomId, token: value.token, url: `wss://${host.host}:${host.wss_port}/sub`, buvid: /(?:^|;\s*)buvid3=([^;]+)/u.exec(config.cookie)?.[1] ?? '' }
}

/** 只接收弹幕，不以账号发送；连接任务、心跳与退避均归本实例所有。 */
export class BiliGateway {
  private controller?: AbortController
  private task: Promise<void> = Promise.resolve()
  private comments: LiveComment[] = []
  private sequence = 0
  private state = '未连接 B站'
  private dropped = 0
  constructor(private getInfo = connectionInfo, private socket = (url: string) => new WebSocket(url, { headers: { 'user-agent': UA, origin: 'https://live.bilibili.com' }, maxPayload: 2_000_000 })) {}
  snapshot(after: number): { state: string; comments: LiveComment[]; dropped: number; cursor: number } {
    if (!Number.isSafeInteger(after) || after < 0 || after > this.sequence) throw new Error('弹幕游标无效，请重新连接')
    this.comments = this.comments.filter(item => item.sequence > after)
    return { state: this.state, comments: [...this.comments], dropped: this.dropped, cursor: this.sequence }
  }
  async start(config: Credentials): Promise<void> {
    await this.stop()
    const controller = new AbortController(); this.controller = controller
    this.comments = []; this.sequence = 0; this.dropped = 0; this.state = '正在连接 B站，等待鉴权'
    this.task = this.run(config, controller.signal)
  }
  async stop(): Promise<void> {
    this.controller?.abort(); await this.task; this.controller = undefined; this.state = 'B站连接已停止'
  }
  private async run(config: Credentials, signal: AbortSignal): Promise<void> {
    let failures = 0
    while (!signal.aborted) {
      try {
        const info = await this.getInfo(config, AbortSignal.any([signal, AbortSignal.timeout(15000)]))
        signal.throwIfAborted()
        await this.listen(info, signal, () => { failures = 0 })
      } catch (error) {
        if (signal.aborted) return
        if (++failures >= 8) { this.state = 'B站连接失败，已停止重试；请检查 Cookie、房间号和网络后重新连接'; return }
        const delay = Math.min(30_000, 1000 * 2 ** (failures - 1))
        this.state = `B站连接中断，${delay / 1000} 秒后重试（${failures}/8）`
        try { await pause(delay, signal) } catch (cancelled) { if (signal.aborted) return; throw cancelled }
      }
    }
  }
  private listen(info: ConnectionInfo, signal: AbortSignal, authenticated: () => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = this.socket(info.url)
      let ready = false, finished = false, lastHeartbeat = Date.now()
      const timer = setTimeout(() => finish(new Error('B站鉴权超时')), 10000)
      const heartbeat = setInterval(() => {
        if (!ready) return
        if (Date.now() - lastHeartbeat > 75000) { finish(new Error('B站心跳超时')); return }
        ws.send(packet(2, '[object Object]'))
      }, 30000)
      const cancel = () => finish()
      const finish = (error?: Error) => {
        if (finished) return
        finished = true; clearTimeout(timer); clearInterval(heartbeat); signal.removeEventListener('abort', cancel)
        ws.removeAllListeners(); ws.on('error', () => { /* 终止握手后的错误由已结束的连接任务吸收。 */ }); ws.terminate()
        if (error && !signal.aborted) reject(error); else resolve()
      }
      signal.addEventListener('abort', cancel, { once: true })
      if (signal.aborted) { finish(); return }
      ws.on('open', () => ws.send(packet(7, JSON.stringify({ uid: info.uid, roomid: info.roomId, protover: 3, platform: 'web', type: 2, key: info.token, buvid: info.buvid }))))
      ws.on('message', data => {
        try {
          const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Buffer)
          decodePackets(bytes, (op, value) => {
            if (op === 8) {
              if (value.code !== 0) throw new Error('B站拒绝弹幕鉴权')
              ready = true; clearTimeout(timer); this.state = `B站已鉴权 · 房间 ${info.roomId}`; authenticated(); ws.send(packet(2, '[object Object]'))
            } else if (op === 3) lastHeartbeat = Date.now()
            else if (ready && typeof value.cmd === 'string' && value.cmd.split(':')[0] === 'DANMU_MSG' && Array.isArray(value.info)) {
              const text = value.info[1], user = value.info[2]
              if (typeof text !== 'string' || !text.trim() || text.length > 500 || !Array.isArray(user) || String(user[0]) === String(info.uid)) return
              if (this.comments.length >= 100) { this.comments.shift(); this.dropped++ }
              this.comments.push({ sequence: ++this.sequence, id: randomUUID(), name: String(user[1] ?? '观众').slice(0, 80), text, receivedAt: Date.now() })
            }
          })
        } catch (error) { finish(error instanceof Error ? error : new Error('B站弹幕解析失败')) }
      })
      ws.on('close', () => finish(new Error('B站连接已断开')))
      ws.on('error', () => finish(new Error('B站网络连接失败')))
    })
  }
}
