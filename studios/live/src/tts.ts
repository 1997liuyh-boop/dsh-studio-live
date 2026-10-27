import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'

/** 每次合成独占连接；取消、超时和卸载都会关闭连接，不复用失效实例。 */
export async function synthesize(text: string, voice: string, signal: AbortSignal, createEngine: () => Pick<MsEdgeTTS, 'setMetadata' | 'toStream' | 'close'> = () => new MsEdgeTTS({ connectionTimeoutMs: 8000, synthesisTimeoutMs: 10000 })): Promise<Buffer> {
  signal.throwIfAborted()
  const engine = createEngine()
  const close = () => engine.close()
  signal.addEventListener('abort', close, { once: true })
  try {
    await engine.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
    signal.throwIfAborted()
    const escaped = text.replace(/[<>&"']/gu, value => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[value]!)
    const { audioStream } = engine.toStream(escaped)
    const destroy = () => audioStream.destroy(new Error('语音合成已取消'))
    signal.addEventListener('abort', destroy, { once: true })
    try {
      const chunks: Buffer[] = []; let size = 0
      for await (const chunk of audioStream) {
        signal.throwIfAborted()
        const bytes = Buffer.from(chunk); size += bytes.length
        if (size > 2_000_000) throw new Error('语音文件过大')
        chunks.push(bytes)
      }
      if (!size) throw new Error('云端未返回语音，请重试或切换本机语音')
      return Buffer.concat(chunks)
    } finally { signal.removeEventListener('abort', destroy) }
  } finally { signal.removeEventListener('abort', close); engine.close() }
}
