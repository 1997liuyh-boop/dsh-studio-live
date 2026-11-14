import { Application, ShaderSystem } from 'pixi.js'
import { install } from '@pixi/unsafe-eval'
import { Live2DModel, config, type Cubism4InternalModel } from 'pixi-live2d-display/cubism4'
import { fixWhaleEyes } from './whale-eye-fix'

install({ ShaderSystem })
config.sound = false

/** 此脚本只在官方 Core 加载后执行；预览和 OBS 使用同一渲染实现。 */
export class Live2dStage {
  private app: Application
  private model?: Live2DModel<Cubism4InternalModel>
  private observer: ResizeObserver
  private disposed = false
  private selectedExpression = ''
  private expressionRequest = 0
  mouth = 0
  emotion = 'neutral'
  /** @param resolution 渲染倍率（画布像素 / 布局像素），由清晰度决定；缺省为屏幕倍率，最高 1.25。 */
  constructor(private container: HTMLElement, private report: (error: unknown) => void, resolution = Math.min(devicePixelRatio, 1.25)) {
    this.app = new Application({ backgroundAlpha: 0, antialias: true, resolution, autoDensity: true, powerPreference: 'low-power' })
    this.app.view.className = 'h-full w-full'
    container.append(this.app.view)
    this.app.ticker.maxFPS = 30
    this.app.ticker.add(() => {
      try { this.model?.update(Math.min(this.app.ticker.deltaMS, 100)) }
      catch (error) { this.app.ticker.stop(); this.report(error) }
    })
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(container); this.resize()
  }
  private resize(): void {
    const width = Math.max(1, this.container.clientWidth), height = Math.max(1, this.container.clientHeight)
    this.app.renderer.resize(width, height)
    if (this.model) {
      const model = this.model
      model.scale.set(Math.min(width / model.internalModel.width, height / model.internalModel.height) * 0.95)
      model.anchor.set(0.5, 0.5); model.position.set(width / 2, height / 2)
    }
  }
  async load(url: string): Promise<void> {
    const model = await Live2DModel.from<typeof Live2DModel<Cubism4InternalModel>>(url, { autoUpdate: false, autoInteract: false })
    if (this.disposed) { model.destroy({ children: true, texture: true, baseTexture: true }); return }
    try { await fixWhaleEyes(model.internalModel, url) }
    catch (error) { model.destroy({ children: true, texture: true, baseTexture: true }); throw error }
    if (this.disposed) { model.destroy({ children: true, texture: true, baseTexture: true }); return }
    this.model = model
    const internal = model.internalModel, ids = [...(internal.settings.getLipSyncParameters() ?? [])]
    if (!ids.length) ids.push('ParamMouthOpenY')
    internal.on('beforeModelUpdate', () => {
      const speechMouth = Math.max(0, Math.min(1, this.mouth))
      for (const id of ids) {
        const expressionMouth = internal.coreModel.getParameterValueById(id)
        internal.coreModel.setParameterValueById(id, Math.max(expressionMouth, speechMouth))
      }
    })
    this.app.stage.addChild(model); this.resize()
  }
  get expression(): string { return this.selectedExpression }
  set expression(value: string) {
    if (value === this.selectedExpression || !this.model) return
    this.selectedExpression = value
    const request = ++this.expressionRequest
    if (!value) {
      const manager = this.model.internalModel.motionManager.expressionManager
      if (manager) {
        // 自然选择清除依赖缓存，并取消仍在加载的表情。
        manager.reserveExpressionIndex = -1
        manager.currentExpression = manager.defaultExpression
        manager.resetExpression()
      }
      return
    }
    void this.model.expression(value).then(ok => {
      if (!ok && !this.disposed && request === this.expressionRequest) this.report(new Error('模型表情加载失败，请重新导入完整模型包'))
    }).catch(error => {
      if (!this.disposed && request === this.expressionRequest) this.report(error)
    })
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true; this.observer.disconnect(); this.app.ticker.stop()
    this.app.destroy(true, { children: true, texture: true, baseTexture: true }); this.model = undefined
  }
}
