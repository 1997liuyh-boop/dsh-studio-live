import type { Cubism4InternalModel } from 'pixi-live2d-display/cubism4'

const eyeParameterIds = ['ParamEyeLOpen', 'ParamEyeROpen'] as const
const eyeMeshIds = [
  ['ArtMesh25', 'ArtMesh26', 'ArtMesh27', 'ArtMesh28', 'ArtMesh29', 'ArtMesh30'],
  ['ArtMesh31', 'ArtMesh32', 'ArtMesh33', 'ArtMesh34', 'ArtMesh35', 'ArtMesh36'],
] as const
const mocHash = '5440608cbb4defc9dbf71d20e01df0b67b3de34c3f62e0f3a2e8479286082aca'

/** 仅为已校验的鲸鱼娘模型修正中间眨眼形态。 */
export async function fixWhaleEyes(model: Cubism4InternalModel, modelUrl: string): Promise<void> {
  const url = new URL(modelUrl, location.href)
  if (!url.pathname.endsWith('/whale-girl-c13-v4.model3.json')) return
  const mocUrl = new URL('whale-girl-c13-v4.moc3', url)
  mocUrl.search = url.search
  const response = await fetch(mocUrl)
  if (!response.ok) throw new Error('鲸鱼娘模型校验失败，请重新载入模型')
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await response.arrayBuffer())), value => value.toString(16).padStart(2, '0')).join('')
  if (hash !== mocHash) return

  const core = model.coreModel
  const indices = eyeMeshIds.map(ids => ids.map(id => core.getDrawableIndex(id)))
  if (indices.some(group => group.some(index => index < 0))) throw new Error('鲸鱼娘眼部资源不完整，请重新载入模型')
  const originalUpdate = core.update.bind(core)
  core.update = () => {
    const values = eyeParameterIds.map(id => Math.max(0, Math.min(1, core.getParameterValueById(id))))
    if (values.every(value => value >= 0.999)) { originalUpdate(); return }
    for (const id of eyeParameterIds) core.setParameterValueById(id, 0)
    originalUpdate()
    const closed = indices.map(group => group.map(index => core.getDrawableVertices(index).slice()))
    for (const id of eyeParameterIds) core.setParameterValueById(id, 1)
    originalUpdate()
    const opened = indices.map(group => group.map(index => core.getDrawableVertices(index).slice()))
    eyeParameterIds.forEach((id, side) => core.setParameterValueById(id, values[side]))
    originalUpdate()
    const opacity = core.getModel().drawables.opacities
    indices.forEach((group, side) => group.forEach((index, mesh) => {
      const value = values[side], vertices = core.getDrawableVertices(index)
      for (let i = 0; i < vertices.length; i++) vertices[i] = closed[side][mesh][i] * (1 - value) + opened[side][mesh][i] * value
      if (mesh === 1) for (let i = 1; i < vertices.length; i += 2) vertices[i] -= 0.008 * Math.sin(Math.PI * value)
      if (opacity[index] < 0.999) opacity[index] = Math.min(1, value * 5)
    }))
  }
}
