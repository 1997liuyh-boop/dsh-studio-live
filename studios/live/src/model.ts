type JsonObject = Record<string, unknown>
const record = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}

/** 宿主 Typert Remote 流的多路复用 WebSocket 路由（取代旧的 /.dsh/remote-stream HTTP 流）。 */
const REMOTE_STREAM_MUX_PATH = '/api/remote.mux'

/**
 * 定位宿主 HTTP 源：桌面端页面运行在 dsh-app:// 协议下，WebSocket 不能经协议转发，
 * 只能直连顶层窗口注入的 `__DSH_TRANSPORT__.streamBaseUrl`；浏览器模式下直接用当前源。
 */
function hostStreamBase(): string {
  let view: Window = window
  for (let depth = 0; depth < 8; depth++) {
    try {
      const transport = record((view as unknown as JsonObject).__DSH_TRANSPORT__)
      if (typeof transport.streamBaseUrl === 'string' && transport.streamBaseUrl) return transport.streamBaseUrl
    } catch {
      // 跨源父窗口不可读，停止向上查找
      break
    }
    if (view.parent === view) break
    view = view.parent
  }
  return location.origin
}

function remoteStreamUrl(): string {
  const url = new URL(REMOTE_STREAM_MUX_PATH, hostStreamBase())
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.href
}

/** 单个逻辑流：独占一条 mux WebSocket，按顺序交付宿主下发的条目。 */
class RemoteFollowStream {
  private readonly streamId = crypto.randomUUID()
  private readonly items: unknown[] = []
  private wake?: () => void
  private failure?: Error
  private finished = false

  private constructor(private readonly socket: WebSocket, private readonly signal: AbortSignal) {
    socket.addEventListener('message', event => this.receive(event.data))
    socket.addEventListener('close', () => this.fail(new Error('直播会话流已断开，请查看 dsh 会话后重试')))
    signal.addEventListener('abort', this.aborted, { once: true })
  }

  /** 建立连接并发送 open 帧；连接失败给出明确原因。 */
  static async open(endpoint: string, payload: unknown, signal: AbortSignal): Promise<RemoteFollowStream> {
    signal.throwIfAborted()
    const socket = new WebSocket(remoteStreamUrl())
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { socket.removeEventListener('open', opened); socket.removeEventListener('error', failed); socket.removeEventListener('close', failed); signal.removeEventListener('abort', aborted) }
      const opened = () => { cleanup(); resolve() }
      const failed = () => { cleanup(); reject(new Error('无法连接 dsh 会话流（' + REMOTE_STREAM_MUX_PATH + '），请确认 dsh 正在运行并重新打开直播页')) }
      const aborted = () => { cleanup(); socket.close(); reject(signal.reason) }
      socket.addEventListener('open', opened)
      socket.addEventListener('error', failed)
      socket.addEventListener('close', failed)
      signal.addEventListener('abort', aborted, { once: true })
    })
    const stream = new RemoteFollowStream(socket, signal)
    socket.send(JSON.stringify({ type: 'open', streamId: stream.streamId, endpoint, payload }))
    return stream
  }

  /** 读取下一条宿主条目；流正常结束时抛出“提前结束”，因为会话订阅不会主动结束。 */
  async next(): Promise<unknown> {
    for (;;) {
      if (this.items.length) return this.items.shift()
      if (this.failure) throw this.failure
      if (this.finished) throw new Error('会话流提前结束，请查看 dsh 会话后重试')
      await new Promise<void>(resolve => { this.wake = resolve })
    }
  }

  /** 关闭逻辑流与连接；未结束时先发送 cancel 帧让宿主释放订阅。 */
  close(): void {
    this.signal.removeEventListener('abort', this.aborted)
    if (!this.finished && !this.failure && this.socket.readyState === WebSocket.OPEN) {
      try { this.socket.send(JSON.stringify({ type: 'cancel', streamId: this.streamId })) } catch (error) { console.debug('直播流取消帧发送失败', error) }
    }
    this.finished = true
    if (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN) this.socket.close(1000, 'closed')
    this.notify()
  }

  private readonly aborted = () => this.fail(this.signal.reason instanceof Error ? this.signal.reason : new Error('直播请求已取消'))

  private receive(data: unknown): void {
    if (typeof data !== 'string') return this.fail(new Error('dsh 会话流返回了非文本帧'))
    let frame: JsonObject
    try { frame = record(JSON.parse(data)) } catch { return this.fail(new Error('dsh 会话流返回了无效帧')) }
    if (frame.streamId !== this.streamId) return
    if (frame.type === 'item') {
      this.items.push(frame.value)
      if (this.items.length > 20_000) return this.fail(new Error('会话流积压过多'))
    } else if (frame.type === 'end') {
      this.finished = true
    } else if (frame.type === 'error') {
      const error = record(frame.error)
      return this.fail(new Error(String(error.message ?? error.code ?? 'dsh 会话流失败')))
    }
    this.notify()
  }

  private fail(error: Error): void {
    if (this.failure || this.finished) return
    this.failure = error
    this.items.length = 0
    this.notify()
  }

  private notify(): void {
    const wake = this.wake
    this.wake = undefined
    wake?.()
  }
}

/** 标准 dsh 会话承载直播推理，模型密钥始终留在宿主。 */
export class LiveModel {
  private sessionId = ''
  private controller?: AbortController
  constructor(private publish: (text: string) => void, private title = '直播工作室') {}

  private async rpc(method: string, request: object, signal?: AbortSignal): Promise<JsonObject> {
    const rpcId = crypto.randomUUID()
    const response = await fetch('/api/' + method, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args: { request } } }), signal })
    if (!response.ok) throw new Error('dsh 请求失败：' + response.status)
    const envelope = record(await response.json())
    const result = record(envelope.result)
    if (envelope.rpcId !== rpcId || result.ok !== true) throw new Error(String(record(result.error).message ?? 'dsh 会话不可用'))
    return record(result.value)
  }

  /** 只允许一个在途请求；完成以真实 turn/end 为准，流断开会明确失败。 */
  async ask(prompt: string, onText?: (text: string) => void): Promise<string> {
    if (this.controller) throw new Error('AI 正在处理上一条消息')
    const controller = new AbortController()
    this.controller = controller
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)])
    let stream: RemoteFollowStream | undefined
    try {
      if (!this.sessionId) {
        const reservation = await fetch('/studio-projects/live/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'reserve-session' }), signal })
        if (!reservation.ok) throw new Error('无法准备直播会话')
        const reserved = record(await reservation.json())
        const created = await this.rpc('session/create', { sessionId: reserved.sessionId }, signal)
        if (typeof created.sessionId !== 'string') throw new Error('dsh 未返回会话标识')
        this.sessionId = created.sessionId
        await this.rpc('session/rename', { sessionId: this.sessionId, title: this.title }, signal)
      }
      stream = await RemoteFollowStream.open('session/follow', { args: { request: { address: { kind: 'session', sessionId: this.sessionId }, assistantStream: true } } }, signal)
      // 先收到开场快照，确认订阅已在宿主侧建立，再提交提示词，避免漏掉本轮事件
      const opening = record(await stream.next())
      if (opening.type !== 'snapshot') throw new Error('dsh 会话流未返回开场快照')
      const requestId = crypto.randomUUID()
      await this.rpc('session/prompt', { sessionId: this.sessionId, requestId, mode: 'queue', content: [{ type: 'text', text: prompt }] }, signal)
      let output = ''
      let currentTurn: number | undefined, targetTurn: number | undefined, attemptId: string | undefined
      for (;;) {
        const frame = record(await stream.next())
        if (frame.type === 'assistant-stream') {
          const piece = record(frame.frame)
          if (piece.type === 'start') {
            if (targetTurn === undefined || piece.turn !== targetTurn) continue
            if (output) throw new Error('模型开始重新生成，直播已停止，请检查会话后重试')
            output = ''; attemptId = typeof piece.attemptId === 'string' ? piece.attemptId : undefined
          }
          if (!attemptId || piece.attemptId !== attemptId) continue
          if (piece.type === 'end' && record(piece.outcome).kind === 'abandoned' && output) throw new Error('模型放弃了当前回复，直播已停止，请检查会话后重试')
          const delta = record(piece.chunk)
          if (delta.type === 'text-delta' && typeof delta.text === 'string') {
            output += delta.text
            if (output.length > 2_000_000) throw new Error('模型输出过大')
            this.publish(output); onText?.(output)
          }
        } else if (frame.type === 'event') {
          const event = record(frame.event), data = record(event.data)
          if (event.type === 'turn/start' && typeof data.turn === 'number') currentTurn = data.turn
          if (event.type === 'user/message' && record(data.source).rpcId === requestId) targetTurn = currentTurn
          if (event.type === 'assistant/message' && targetTurn !== undefined && data.turn === targetTurn) {
            const content = record(data.message).content
            if (Array.isArray(content)) { output = content.map(value => { const block = record(value); return block.type === 'text' ? String(block.text) : '' }).join('\n'); this.publish(output) }
          }
          if (event.type === 'turn/end' && targetTurn !== undefined && data.turn === targetTurn) {
            if (record(data.reason).kind !== 'completed' || !output.trim()) throw new Error('直播推理未完成，请查看 dsh 会话')
            return output.trim()
          }
        }
      }
    } catch (error) {
      if (this.sessionId) await this.rpc('session/cancel', { sessionId: this.sessionId }, AbortSignal.timeout(5000)).catch(cause => console.warn('直播取消失败', cause))
      throw error
    } finally {
      stream?.close()
      this.controller = undefined
    }
  }

  /** 停止自己的直播会话，不取消其他聊天。 */
  async stop(): Promise<void> {
    this.controller?.abort()
    if (this.sessionId) await this.rpc('session/cancel', { sessionId: this.sessionId }, AbortSignal.timeout(5000))
  }
}
