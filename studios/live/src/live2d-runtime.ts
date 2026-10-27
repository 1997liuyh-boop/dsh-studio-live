import { Application, ShaderSystem } from 'pixi.js'
import { install } from '@pixi/unsafe-eval'
import { Live2DModel, config, type Cubism4InternalModel } from 'pixi-live2d-display/cubism4'

install({ ShaderSystem })
config.sound = false

/** 此脚本只在官方 Core 加载后执行；预览和 OBS 使用同一渲染实现。 */
export class Live2dStage {
  private app: Application
  private model?: Live2DModel<Cubism4InternalModel>
  private observer: ResizeObserver
  private disposed = false
  private selectedExpression = ''
  mouth = 0
  emotion = 'neutral'
  constructor(private container: HTMLElement, private report: (error: unknown) => void) {
    this.app = new Application({ backgroundAlpha: 0, antialias: true, resolution: Math.min(devicePixelRatio, 1.25), autoDensity: true, powerPreference: 'low-power' })
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
    this.model = model
    const internal = model.internalModel, ids = [...(internal.settings.getLipSyncParameters() ?? [])]
    if (!ids.length) ids.push('ParamMouthOpenY')
    internal.on('beforeModelUpdate', () => {
      for (const id of ids) internal.coreModel.setParameterValueById(id, Math.max(0, Math.min(1, this.mouth)))
    })
    this.app.stage.addChild(model); this.resize()
  }
  get expression(): string { return this.selectedExpression }
  set expression(value: string) {
    if (value === this.selectedExpression || !this.model) return
    this.selectedExpression = value
    if (!value) this.model.internalModel.motionManager.expressionManager?.resetExpression()
    else void this.model.expression(value).then(ok => { if (!ok && !this.disposed) this.report(new Error('模型表情加载失败，请重新导入完整模型包')) }).catch(this.report)
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true; this.observer.disconnect(); this.app.ticker.stop()
    this.app.destroy(true, { children: true, texture: true, baseTexture: true }); this.model = undefined
  }
}
