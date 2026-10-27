import { createAvatarStage, type AvatarStage } from './avatar-stage'

const token = new URLSearchParams(location.search).get('token') ?? ''
const image = document.querySelector<HTMLImageElement>('img')!
const container = document.getElementById('stage')!
const caption = document.querySelector('p')!
let version = -1, stage: AvatarStage | undefined, disposed = false
let loading: AbortController | undefined
let renderingIssue = ''
const report = (error: unknown) => { renderingIssue = error instanceof Error ? error.message : '形象加载失败'; if (!disposed) caption.textContent = renderingIssue }

/** OBS 只读取形象状态，不播放第二份音频；声音捕获 dsh 应用音频。 */
async function refresh(): Promise<void> {
  let delay = 160
  try {
    const response = await fetch('/state?token=' + token)
    if (!response.ok) throw new Error('叠加层已断开')
    const state = await response.json()
    if (disposed) return
    caption.textContent = renderingIssue || state.text
    if (version !== state.avatarVersion) {
      loading?.abort(); stage?.dispose(); stage = undefined
      renderingIssue = ''
      container.dataset.avatarReady = 'false'
      image.hidden = state.avatarKind !== 'image'
      container.hidden = !['vrm', 'live2d'].includes(state.avatarKind)
      if (state.avatarKind === 'image') image.src = '/avatar?token=' + token + '&v=' + state.avatarVersion
      if (!container.hidden) {
        const controller = new AbortController(); loading = controller
        let blob: Blob | undefined
        if (state.avatarKind === 'vrm') {
          const asset = await fetch('/avatar?token=' + token + '&v=' + state.avatarVersion, { signal: controller.signal })
          if (!asset.ok) throw new Error('形象文件不可用')
          blob = await asset.blob()
        }
        const view = await createAvatarStage(container, state.avatarKind, blob, state.modelUrl, controller.signal, report)
        if (disposed || controller.signal.aborted) { view.dispose(); return }
        stage = view; container.dataset.avatarReady = 'true'
      }
      version = state.avatarVersion
    }
    if (stage) { stage.mouth = state.mouth; stage.emotion = state.emotion; stage.expression = state.expression }
    image.classList.toggle('animate-pulse', state.speaking)
  } catch (error) {
    if (!disposed) caption.textContent = error instanceof Error ? error.message : '叠加层连接失败'
    delay = 3000
    if (stage) stage.mouth = 0
  } finally { if (!disposed) setTimeout(() => void refresh(), delay) }
}
window.addEventListener('pagehide', () => { disposed = true; loading?.abort(); stage?.dispose() }, { once: true })
void refresh()
