export interface AudioFrame { text: string; speaking: boolean; mouth: number }

/** 以实际音频开始播放计时；预计算包络驱动口型，取消时立即停止声音。 */
export class LiveAudio {
  private context?: AudioContext
  constructor(private frame: (value: AudioFrame) => void, private latency: (ms: number) => void, private warning: (text: string) => void) {}
  async unlock(): Promise<void> { this.context ??= new AudioContext(); await this.context.resume() }
  async play(text: string, signal: AbortSignal, receivedAt: number, mode: string, voice: string, cloud: (text: string, voice: string, signal: AbortSignal) => Promise<string>): Promise<void> {
    signal.throwIfAborted()
    this.frame({ text, speaking: false, mouth: 0 })
    if (mode === 'off') return
    if (mode === 'system') { await this.system(text, signal, receivedAt); return }
    let bytes: string
    try { bytes = await cloud(text, voice, signal) }
    catch (error) {
      signal.throwIfAborted()
      this.warning('云端语音失败，本句改用本机语音；可在设置中重选语音引擎')
      await this.system(text, signal, receivedAt); return
    }
    signal.throwIfAborted()
    const context = this.context
    if (!context || context.state !== 'running') throw new Error('音频尚未解锁，请停止后重新点击开始预演')
    const binary = Uint8Array.from(atob(bytes), value => value.charCodeAt(0))
    const buffer = await context.decodeAudioData(binary.buffer)
    signal.throwIfAborted()
    const samples = buffer.getChannelData(0), windowSize = Math.max(1, Math.floor(buffer.sampleRate * 0.04)), envelope: number[] = []
    for (let start = 0; start < samples.length; start += windowSize) {
      let sum = 0; const end = Math.min(samples.length, start + windowSize)
      for (let index = start; index < end; index++) sum += samples[index]! ** 2
      envelope.push(Math.sqrt(sum / (end - start)))
    }
    const peak = envelope.reduce((value, sample) => Math.max(value, sample), 0.01)
    await new Promise<void>((resolve, reject) => {
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination)
      const started = context.currentTime
      let finished = false
      const finish = (error?: unknown) => {
        if (finished) return
        finished = true; clearInterval(timer); clearTimeout(deadline); signal.removeEventListener('abort', cancel)
        source.onended = null; source.stop(); source.disconnect(); this.frame({ text, speaking: false, mouth: 0 })
        if (error) reject(error); else resolve()
      }
      const cancel = () => finish(signal.reason)
      const timer = setInterval(() => {
        const value = envelope[Math.floor((context.currentTime - started) / 0.04)] ?? 0
        this.frame({ text, speaking: true, mouth: Math.min(1, value / peak * 0.9) })
      }, 40)
      const deadline = setTimeout(() => finish(new Error('语音播放超时，已停止本轮')), Math.min(60000, buffer.duration * 1000 + 3000))
      source.onended = () => finish(); signal.addEventListener('abort', cancel, { once: true })
      source.start(); this.latency(Date.now() - receivedAt)
      this.frame({ text, speaking: true, mouth: 0 })
    })
  }
  private async system(text: string, signal: AbortSignal, receivedAt: number): Promise<void> {
    if (!('speechSynthesis' in window)) throw new Error('本机语音不可用，请选择云端语音')
    await new Promise<void>((resolve, reject) => {
      const speech = new SpeechSynthesisUtterance(text); speech.lang = 'zh-CN'
      let finished = false
      const finish = (error?: unknown) => {
        if (finished) return
        finished = true; clearTimeout(timer); signal.removeEventListener('abort', cancel)
        speech.onend = null; speech.onerror = null; this.frame({ text, speaking: false, mouth: 0 })
        if (error) { speechSynthesis.cancel(); reject(error) } else resolve()
      }
      const cancel = () => finish(signal.reason)
      const timer = setTimeout(() => finish(new Error('本机语音播放超时，请检查系统语音设置')), 30000)
      speech.onstart = () => { if (!finished) { this.latency(Date.now() - receivedAt); this.frame({ text, speaking: true, mouth: 0.45 }) } }
      speech.onend = () => finish(); speech.onerror = () => finish(new Error('本机语音播放失败，请检查系统语音设置'))
      signal.addEventListener('abort', cancel, { once: true }); speechSynthesis.speak(speech)
    })
  }
  async dispose(): Promise<void> { await this.context?.close(); this.context = undefined }
}
