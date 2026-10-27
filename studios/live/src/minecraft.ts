import { Worker } from 'node:worker_threads'
import { randomUUID } from 'node:crypto'
import { record } from './obs'
import { minecraftActions } from './game'

/** 游戏协议与物理运算在独立 Worker 内运行，停止时终止整个 Worker。 */
export class MinecraftAdapter {
  private worker?: Worker
  private pending = new Map<string, { resolve(value: Record<string, unknown>): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  private ready = false
  private revision = 0
  private error = 'Minecraft 尚未连接'
  /** 等待旧 Worker 退出后连接；期间收到停止或新连接请求时拒绝本次连接。 */
  async start(port: number, username: string): Promise<void> {
    const stopping = this.stop(), revision = this.revision
    await stopping
    if (revision !== this.revision) throw new Error('Minecraft 已停止')
    const worker = new Worker(new URL('./minecraft-worker.cjs', import.meta.url), { workerData: { port, username } }); this.worker = worker
    worker.on('error', () => { if (this.worker === worker) this.fail('Minecraft 适配器启动失败，请检查插件依赖和本机测试服') })
    worker.on('exit', () => { if (this.worker === worker) { this.worker = undefined; this.fail('Minecraft 适配器已退出') } })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('Minecraft 连接超时，请检查测试服后重新开始预演')); void this.stop() }, 15000)
      const initial = (message: unknown) => {
        const value = record(message)
        if (this.worker !== worker) return
        if (value.type === 'ready') { clearTimeout(timer); worker.off('message', initial); this.ready = true; resolve() }
        if (value.type === 'failure') { clearTimeout(timer); worker.off('message', initial); reject(new Error(String(value.error))); void this.stop() }
      }
      worker.on('message', initial)
      worker.once('error', () => { clearTimeout(timer); reject(new Error('Minecraft 适配器无法启动')) })
      worker.once('exit', () => { clearTimeout(timer); if (this.worker !== worker || !this.ready) reject(new Error('Minecraft 连接提前结束')) })
    })
    worker.on('message', message => {
      if (this.worker !== worker) return
      const value = record(message)
      if (value.type === 'failure') { this.fail(String(value.error)); return }
      if (typeof value.id !== 'string') return
      const item = this.pending.get(value.id); if (!item) return
      clearTimeout(item.timer); this.pending.delete(value.id)
      if (typeof value.error === 'string') item.reject(new Error(value.error)); else item.resolve(record(value.state))
    })
  }
  private fail(message: string): void {
    this.ready = false; this.error = message
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error(message)) }
    this.pending.clear()
  }
  async stop(): Promise<void> {
    this.revision++
    const worker = this.worker; this.worker = undefined; this.fail('Minecraft 已停止')
    if (worker) await worker.terminate()
  }
  request(action: string): Promise<Record<string, unknown>> {
    if (!this.worker || !this.ready) return Promise.reject(new Error(this.error))
    if (action !== 'state' && !minecraftActions.includes(action as typeof minecraftActions[number])) return Promise.reject(new Error('Minecraft 动作无效'))
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Minecraft 动作结果未知，已停止连接，请检查游戏')); void this.stop() }, 7000)
      this.pending.set(id, { resolve, reject, timer }); this.worker!.postMessage({ id, action })
    })
  }
}
