/** 按已收到的完整句子提交语音，末尾残句只在模型完成后提交。 */
export class SentenceBuffer {
  private offset = 0
  private committed = ''
  constructor(private emit: (text: string) => void) {}
  push(text: string, final = false): void {
    if (!text.startsWith(this.committed)) throw new Error('模型改写了已播报内容，已停止本轮，请检查会话后重试')
    for (;;) {
      const pending = text.slice(this.offset), index = pending.search(/[。！？!?\n]/u)
      if (index < 0) break
      const sentence = pending.slice(0, index + 1).trim()
      this.offset += index + 1
      this.committed = text.slice(0, this.offset)
      if (sentence) this.emit(sentence)
    }
    if (final && text.slice(this.offset).trim()) {
      this.emit(text.slice(this.offset).trim())
      this.offset = text.length
      this.committed = text
    }
  }
}

interface SpeechJob { text: string; receivedAt: number; resolve(): void; reject(error: unknown): void }

/** 一个播放者依次消费有界队列；停止使当前播放与等待者全部结束，不接受旧轮次回调。 */
export class SpeechQueue {
  private jobs: SpeechJob[] = []
  private controller = new AbortController()
  private draining = false
  private idle: Promise<void> = Promise.resolve()
  constructor(private play: (text: string, signal: AbortSignal, receivedAt: number) => Promise<void>, private capacity = 8) {}
  get size(): number { return this.jobs.length }
  add(text: string, receivedAt: number): Promise<void> {
    if (this.controller.signal.aborted) return Promise.reject(this.controller.signal.reason)
    if (this.jobs.length >= this.capacity) return Promise.reject(new Error('语音队列已满，请降低回复频率'))
    const result = new Promise<void>((resolve, reject) => this.jobs.push({ text, receivedAt, resolve, reject }))
    if (!this.draining) this.idle = this.drain()
    return result
  }
  private async drain(): Promise<void> {
    this.draining = true
    try {
      while (this.jobs.length && !this.controller.signal.aborted) {
        const job = this.jobs[0]!
        try { await this.play(job.text, this.controller.signal, job.receivedAt); job.resolve() }
        catch (error) { job.reject(error); this.stop(error); break }
        if (this.jobs[0] === job) this.jobs.shift()
      }
    } finally { this.draining = false }
  }
  stop(reason: unknown = new DOMException('已停止直播语音', 'AbortError')): void {
    this.controller.abort(reason)
    for (const job of this.jobs.splice(0)) job.reject(reason)
  }
  async whenIdle(): Promise<void> { await this.idle }
}

/** 等待由所属运行取消，停止时不会遗留循环定时器。 */
export function pause(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve() }, ms)
    signal.addEventListener('abort', cancel, { once: true })
  })
}
