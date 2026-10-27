import { VrmStage, type Emotion } from './stage'

export interface AvatarStage { mouth: number; emotion: Emotion | string; expression?: string; dispose(): void }
interface Live2dView extends AvatarStage { load(url: string): Promise<void> }
declare global { interface Window { Live2DCubismCore?: object; dshLive2d?: { Live2dStage: new (container: HTMLElement, report: (error: unknown) => void) => Live2dView } } }

const scripts = new Map<string, Promise<void>>()
function loadScript(url: URL): Promise<void> {
  const existing = scripts.get(url.href)
  if (existing) return existing
  const pending = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = url.href
    const timer = setTimeout(() => { script.remove(); reject(new Error('Live2D 运行库加载超时，请重新打开工作室')) }, 15000)
    script.onload = () => { clearTimeout(timer); resolve() }
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('Live2D 运行库不可用，请安装包含官方运行库的本地验证包')) }
    document.head.append(script)
  }).catch(error => { scripts.delete(url.href); throw error })
  scripts.set(url.href, pending)
  return pending
}

/** 按模型类型创建渲染器；取消加载或加载失败时释放已分配的画布。 */
export async function createAvatarStage(container: HTMLElement, kind: string, blob: Blob | undefined, modelUrl: string, signal: AbortSignal, report: (error: unknown) => void): Promise<AvatarStage> {
  signal.throwIfAborted()
  let view: AvatarStage
  if (kind === 'live2d') {
    const directory = new URL('.', import.meta.url)
    const runtimeUrl = (file: string) => { const url = new URL(file, directory), token = new URLSearchParams(location.search).get('token'); if (token) url.searchParams.set('token', token); return url }
    if (!window.Live2DCubismCore) await loadScript(runtimeUrl('live2dcubismcore.min.js'))
    signal.throwIfAborted()
    if (!window.dshLive2d) await loadScript(runtimeUrl('live2d.js'))
    signal.throwIfAborted()
    if (!window.dshLive2d) throw new Error('Live2D 渲染器未初始化')
    const stage = new window.dshLive2d.Live2dStage(container, report)
    view = stage
    const stopped = () => stage.dispose()
    signal.addEventListener('abort', stopped, { once: true })
    try { await stage.load(modelUrl); signal.throwIfAborted() }
    catch (error) { stage.dispose(); throw error }
    finally { signal.removeEventListener('abort', stopped) }
  } else {
    if (!blob) throw new Error('VRM 形象文件缺失')
    const stage = new VrmStage(container)
    view = stage
    const stopped = () => stage.dispose()
    signal.addEventListener('abort', stopped, { once: true })
    try { await stage.load(await blob.arrayBuffer()); signal.throwIfAborted() }
    catch (error) { if (!signal.aborted) stage.dispose(); throw error }
    finally { signal.removeEventListener('abort', stopped) }
  }
  return view
}
