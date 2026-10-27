import { VrmStage, type Emotion } from './stage'

const token = new URLSearchParams(location.search).get('token') ?? ''
const image = document.querySelector<HTMLImageElement>('img')!
const container = document.getElementById('stage')!
const caption = document.querySelector('p')!
let version = -1, stage: VrmStage | undefined, disposed = false

/** OBS 只读取形象状态，不播放第二份音频；声音捕获 dsh 应用音频。 */
async function refresh(): Promise<void> {
  try {
    const response = await fetch('/state?token=' + token)
    if (!response.ok) throw new Error('叠加层已断开')
    const state = await response.json()
    if (disposed) return
    caption.textContent = state.text
    if (version !== state.avatarVersion) {
      version = state.avatarVersion; stage?.dispose(); stage = undefined
      image.hidden = state.avatarKind !== 'image'; container.hidden = state.avatarKind !== 'vrm'
      if (state.avatarKind === 'image') image.src = '/avatar?token=' + token + '&v=' + version
      if (state.avatarKind === 'vrm') {
        stage = new VrmStage(container)
        const asset = await fetch('/avatar?token=' + token + '&v=' + version)
        if (!asset.ok) throw new Error('形象文件不可用')
        await stage.load(await asset.arrayBuffer())
      }
    }
    if (stage) { stage.mouth = state.mouth; stage.emotion = state.emotion as Emotion }
    image.classList.toggle('animate-pulse', state.speaking)
  } catch (error) {
    caption.textContent = error instanceof Error ? error.message : '叠加层连接失败'
    if (stage) stage.mouth = 0
  } finally { if (!disposed) setTimeout(() => void refresh(), 160) }
}
window.addEventListener('pagehide', () => { disposed = true; stage?.dispose() }, { once: true })
void refresh()
