type JsonObject = Record<string, unknown>
const record = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}

/** 标准 dsh 会话承载直播推理，模型密钥始终留在宿主。 */
export class LiveModel {
  private sessionId = ''
  private controller?: AbortController
  constructor(private publish: (text: string) => void) {}

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
  async ask(prompt: string): Promise<string> {
    if (this.controller) throw new Error('AI 正在处理上一条消息')
    const controller = new AbortController()
    this.controller = controller
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)])
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      if (!this.sessionId) {
        const reservation = await fetch('/studio-projects/live/api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'reserve-session' }), signal })
        if (!reservation.ok) throw new Error('无法准备直播会话')
        const reserved = record(await reservation.json())
        const created = await this.rpc('session/create', { sessionId: reserved.sessionId }, signal)
        if (typeof created.sessionId !== 'string') throw new Error('dsh 未返回会话标识')
        this.sessionId = created.sessionId
        await this.rpc('session/rename', { sessionId: this.sessionId, title: '直播工作室' }, signal)
      }
      const response = await fetch('/.dsh/remote-stream', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint: 'session/follow', payload: { args: { request: { address: { kind: 'session', sessionId: this.sessionId }, assistantStream: true } } } }), signal })
      if (!response.ok || !response.body) throw new Error('直播会话流不可用，请使用 Windows 桌面端')
      reader = response.body.getReader()
      await this.rpc('session/prompt', { sessionId: this.sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: prompt }] }, signal)
      let pending = '', output = ''
      const decoder = new TextDecoder()
      for (;;) {
        const chunk = await reader.read()
        pending += decoder.decode(chunk.value, { stream: !chunk.done })
        if (pending.length > 2_000_000) throw new Error('模型输出过大')
        const lines = pending.split('\n'); pending = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          const frame = record(JSON.parse(line))
          if (frame.type === 'assistant-stream') {
            const delta = record(record(frame.frame).chunk)
            if (delta.type === 'text-delta' && typeof delta.text === 'string') { output += delta.text; this.publish(output) }
          } else if (frame.type === 'event') {
            const event = record(frame.event), data = record(event.data)
            if (event.type === 'assistant/message') {
              const content = record(data.message).content
              if (Array.isArray(content)) { output = content.map(value => { const block = record(value); return block.type === 'text' ? String(block.text) : '' }).join('\n'); this.publish(output) }
            }
            if (event.type === 'turn/end') {
              if (record(data.reason).kind !== 'completed' || !output.trim()) throw new Error('直播推理未完成，请查看 dsh 会话')
              return output.trim()
            }
          }
        }
        if (chunk.done) throw new Error('会话流提前结束，请查看 dsh 会话后重试')
      }
    } catch (error) {
      if (this.sessionId) await this.rpc('session/cancel', { sessionId: this.sessionId }, AbortSignal.timeout(5000)).catch(cause => console.warn('直播取消失败', cause))
      throw error
    } finally {
      if (reader) await reader.cancel().catch(error => console.debug('直播流已关闭', error))
      this.controller = undefined
    }
  }

  /** 停止自己的直播会话，不取消其他聊天。 */
  async stop(): Promise<void> {
    this.controller?.abort()
    if (this.sessionId) await this.rpc('session/cancel', { sessionId: this.sessionId }, AbortSignal.timeout(5000))
  }
}
