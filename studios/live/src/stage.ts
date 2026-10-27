import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm'

export type Emotion = 'neutral' | 'happy' | 'relaxed' | 'surprised' | 'sad'

/** 预览和 OBS 共用 VRM 渲染器；释放时停止动画并回收显存。 */
export class VrmStage {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(30, 1, 0.01, 50)
  private vrm?: VRM
  private disposed = false
  private observer: ResizeObserver
  private started = performance.now()
  private previous = 0
  mouth = 0
  emotion: Emotion = 'neutral'
  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25))
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.domElement.className = 'h-full w-full'
    container.append(this.renderer.domElement)
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x64748b, 2.5))
    const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(1, 2, 3); this.scene.add(light)
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(container); this.resize()
    this.renderer.setAnimationLoop(time => {
      if (time - this.previous < 1000 / 30) return
      const delta = Math.min((time - this.previous) / 1000, 0.05); this.previous = time
      const seconds = (time - this.started) / 1000
      if (this.vrm) {
        const expressions = this.vrm.expressionManager
        for (const name of ['happy', 'relaxed', 'surprised', 'sad']) expressions?.setValue(name, this.emotion === name ? 0.6 : 0)
        expressions?.setValue('aa', Math.max(0, Math.min(1, this.mouth)))
        const phase = seconds % 4.3
        expressions?.setValue('blink', phase < 0.16 ? Math.sin(phase / 0.16 * Math.PI) : 0)
        const chest = this.vrm.humanoid.getNormalizedBoneNode('chest')
        if (chest) chest.rotation.x = Math.sin(seconds * 1.6) * 0.015
        this.vrm.update(delta)
      }
      this.renderer.render(this.scene, this.camera)
    })
  }
  private resize(): void {
    const width = Math.max(1, this.container.clientWidth), height = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(width, height, false); this.camera.aspect = width / height; this.camera.updateProjectionMatrix()
  }
  async load(bytes: ArrayBuffer): Promise<void> {
    const manager = new THREE.LoadingManager()
    manager.setURLModifier(url => { if (!url.startsWith('blob:') && !url.startsWith('data:')) throw new Error('请导入贴图内置的 VRM 文件'); return url })
    const loader = new GLTFLoader(manager); loader.register(parser => new VRMLoaderPlugin(parser))
    const gltf = await loader.parseAsync(bytes, '')
    const vrm: VRM | undefined = gltf.userData.vrm
    if (!vrm) { VRMUtils.deepDispose(gltf.scene); throw new Error('文件不包含有效的 VRM 模型') }
    if (this.disposed) { VRMUtils.deepDispose(vrm.scene); return }
    VRMUtils.removeUnnecessaryVertices(gltf.scene); VRMUtils.combineSkeletons(gltf.scene); VRMUtils.rotateVRM0(vrm)
    if (this.vrm) { this.scene.remove(this.vrm.scene); VRMUtils.deepDispose(this.vrm.scene) }
    this.vrm = vrm; this.scene.add(vrm.scene)
    const left = vrm.humanoid.getNormalizedBoneNode('leftUpperArm'), right = vrm.humanoid.getNormalizedBoneNode('rightUpperArm')
    if (left) left.rotation.z = -1.15
    if (right) right.rotation.z = 1.15
    vrm.update(0)
    const bounds = new THREE.Box3().setFromObject(vrm.scene), center = bounds.getCenter(new THREE.Vector3())
    const height = Math.max(0.1, bounds.max.y - bounds.min.y)
    this.camera.position.set(center.x, bounds.min.y + height * 0.58, center.z + height * 2.2)
    this.camera.lookAt(center.x, bounds.min.y + height * 0.53, center.z)
  }
  dispose(): void {
    this.disposed = true; this.observer.disconnect(); this.renderer.setAnimationLoop(null)
    if (this.vrm) VRMUtils.deepDispose(this.vrm.scene)
    this.renderer.dispose(); this.renderer.forceContextLoss(); this.renderer.domElement.remove()
  }
}
