import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { build } from 'esbuild'

// 使用实际 SDK 的帧更新顺序，避免测试只重复预期的保存/恢复实现。
const sdkSource = await readFile(new URL('../node_modules/pixi-live2d-display/dist/cubism4.es.js', import.meta.url), 'utf8')
const sdkClassStart = sdkSource.indexOf('class Cubism4InternalModel extends InternalModel')
const sdkUpdateStart = sdkSource.indexOf('  update(dt, now) {', sdkClassStart)
const sdkUpdateEnd = sdkSource.indexOf('  updateFocus() {', sdkUpdateStart)
assert.ok(sdkClassStart >= 0 && sdkUpdateStart > sdkClassStart && sdkUpdateEnd > sdkUpdateStart, '无法找到当前 SDK 的真实帧更新方法')
const sdkUpdate = vm.runInNewContext(`class Base { update() {} } class SdkFrame extends Base { ${sdkSource.slice(sdkUpdateStart, sdkUpdateEnd)} }; SdkFrame.prototype.update`)

const runtime = await build({
  entryPoints: [fileURLToPath(new URL('../studios/live/src/live2d-runtime.ts', import.meta.url))],
  write: false, bundle: true, platform: 'browser', format: 'iife', globalName: 'testedRuntime',
  plugins: [{
    name: 'live2d-rendering-stubs',
    setup(builder) {
      builder.onResolve({ filter: /^(?:pixi\.js|@pixi\/unsafe-eval|pixi-live2d-display\/cubism4)$/ }, args => ({ path: args.path, namespace: 'render-stub' }))
      builder.onLoad({ filter: /.*/, namespace: 'render-stub' }, args => ({ contents: args.path === 'pixi.js'
        ? 'export class ShaderSystem {} export class Application { view = {}; ticker = { add() {}, stop() {} }; renderer = { resize() {} }; stage = { addChild() {} }; destroy() {} }'
        : args.path === '@pixi/unsafe-eval' ? 'export function install() {}'
        : 'export const config = {}; export class Live2DModel { static async from() { return globalThis.fixtureModel } }' }))
    },
  }],
})

/** 在真实阶段注册回调后，按真实 SDK 时序驱动参数；这里不创建或伪造 moc3。 */
async function stageFixture(ids = ['ParamMouthOpenY'], expressionManager) {
  const initial = { ParamMouthOpenY: 0, ParamMouthForm: -0.4, ParamSecondaryMouth: 0 }
  let values = { ...initial }, saved = { ...initial }, now = 0
  const expressions = {}, frames = [], events = new Map(), reports = []
  const coreModel = {
    saves: 0, loads: 0,
    getParameterValueById(id) { return values[id] ?? 0 },
    setParameterValueById(id, value) { values[id] = value },
    saveParameters() { saved = { ...values }; this.saves++ },
    loadParameters() { values = { ...saved }; this.loads++ },
    update() { frames.push({ ...values }) },
  }
  const internal = {
    width: 100, height: 100, coreModel,
    settings: { getLipSyncParameters() { return ids } },
    on(name, callback) { events.set(name, callback) },
    emit(name) { events.get(name)?.() },
    motionManager: {
      update() { return false },
      expressionManager: expressionManager ?? { update() { Object.assign(values, expressions) }, resetExpression() {} },
    },
    updateFocus() {}, updateNaturalMovements() {},
  }
  const sandbox = {
    devicePixelRatio: 1,
    ResizeObserver: class { observe() {} disconnect() {} },
    fixtureModel: { expression(value) { return expressionManager.setExpression(value) }, internalModel: internal, scale: { set() {} }, anchor: { set() {} }, position: { set() {} } },
  }
  vm.runInNewContext(runtime.outputFiles[0].text, sandbox)
  const container = { clientWidth: 400, clientHeight: 400, append() {} }
  const stage = new sandbox.testedRuntime.Live2dStage(container, error => { reports.push(error) })
  await stage.load('fixture.model3.json')
  return { stage, expressions, frames, coreModel, reports, frame() { sdkUpdate.call(internal, 33, now += 33); return frames.at(-1) } }
}

test('静音保留当前表情嘴部基值，MouthForm 不受语音写入影响', async () => {
  const fixture = await stageFixture()
  fixture.expressions.ParamMouthOpenY = 0.6
  const frame = fixture.frame()
  assert.equal(frame.ParamMouthOpenY, 0.6)
  assert.equal(frame.ParamMouthForm, -0.4)
  assert.equal(fixture.coreModel.getParameterValueById('ParamMouthOpenY'), 0)
})

test('语音超过表情时打开，停止后每帧恢复表情且不锁存语音值', async () => {
  const fixture = await stageFixture()
  fixture.expressions.ParamMouthOpenY = 0.6
  fixture.stage.mouth = 0.9
  assert.equal(fixture.frame().ParamMouthOpenY, 0.9)
  fixture.stage.mouth = 0
  assert.equal(fixture.frame().ParamMouthOpenY, 0.6)
  assert.equal(fixture.frame().ParamMouthOpenY, 0.6)
  fixture.expressions.ParamMouthOpenY = 0.2
  assert.equal(fixture.frame().ParamMouthOpenY, 0.2)
  delete fixture.expressions.ParamMouthOpenY
  assert.equal(fixture.frame().ParamMouthOpenY, 0)
  assert.equal(fixture.coreModel.saves, 5)
  assert.equal(fixture.coreModel.loads, 5)
})

test('语音仍限制在零到一，低于表情的语音不会缩小表情嘴型', async () => {
  const fixture = await stageFixture()
  fixture.stage.mouth = 2
  assert.equal(fixture.frame().ParamMouthOpenY, 1)
  fixture.stage.mouth = -1
  assert.equal(fixture.frame().ParamMouthOpenY, 0)
  fixture.expressions.ParamMouthOpenY = 0.7
  fixture.stage.mouth = 0.3
  assert.equal(fixture.frame().ParamMouthOpenY, 0.7)
})

test('多个 LipSync 参数分别保留当帧基值，未声明时使用标准嘴部参数', async () => {
  const fixture = await stageFixture(['ParamMouthOpenY', 'ParamSecondaryMouth'])
  fixture.expressions.ParamMouthOpenY = 0.2
  fixture.expressions.ParamSecondaryMouth = 0.8
  fixture.stage.mouth = 0.5
  const frame = fixture.frame()
  assert.equal(frame.ParamMouthOpenY, 0.5)
  assert.equal(frame.ParamSecondaryMouth, 0.8)
  const fallback = await stageFixture([])
  fallback.expressions.ParamMouthOpenY = 0.4
  assert.equal(fallback.frame().ParamMouthOpenY, 0.4)
})

// 保留依赖实际的选中缓存与异步预留逻辑，只替换资源加载和绘制。
const sdkExpressionStart = sdkSource.indexOf('class ExpressionManager extends EventEmitter')
const sdkExpressionEnd = sdkSource.indexOf('const EPSILON', sdkExpressionStart)
assert.ok(sdkExpressionStart >= 0 && sdkExpressionEnd > sdkExpressionStart, '无法找到当前 SDK 的真实表情管理器')
const SdkExpressionManager = vm.runInNewContext(`${sdkSource.slice(0, sdkSource.indexOf('import '))}${sdkSource.slice(sdkExpressionStart, sdkExpressionEnd)}; ExpressionManager`, {
  EventEmitter: class { emit() {} }, logger: { warn() {} },
})

function expressionManager(load) {
  const manager = new SdkExpressionManager({ name: 'fixture' })
  const names = ['wink', 'laugh']
  manager.definitions = names.map(Name => ({ Name }))
  manager.createExpression = () => ({ name: 'neutral' })
  manager.stopAllExpressions = () => {}
  manager._setExpression = expression => { manager.active = expression }
  manager.getExpressionIndex = name => names.indexOf(name)
  manager._loadExpression = index => load ? load(index) : Promise.resolve({ name: names[index] })
  manager.init()
  return manager
}

const settleExpressions = () => new Promise(resolve => setImmediate(resolve))

test('Wink 和大笑切回自然后仍能再次启用同一表情', async () => {
  for (const name of ['wink', 'laugh']) {
    const manager = expressionManager()
    const fixture = await stageFixture(undefined, manager)
    fixture.stage.expression = name
    await settleExpressions()
    assert.equal(manager.active.name, name)
    fixture.stage.expression = ''
    assert.equal(manager.active.name, 'neutral')
    fixture.stage.expression = name
    await settleExpressions()
    assert.equal(manager.active.name, name)
    assert.equal(fixture.reports.length, 0)
  }
})

test('选择自然会取消未完成表情，迟到的加载不会覆盖自然或误报失败', async () => {
  let finish
  const manager = expressionManager(() => new Promise(resolve => { finish = resolve }))
  const fixture = await stageFixture(undefined, manager)
  fixture.stage.expression = 'wink'
  fixture.stage.expression = ''
  finish({ name: 'wink' })
  await settleExpressions()
  assert.equal(manager.active.name, 'neutral')
  assert.equal(manager.currentExpression.name, 'neutral')
  assert.equal(fixture.reports.length, 0)
})

test('旧表情被新选择替代后只报告当前请求的真实失败', async () => {
  let rejectOld
  const manager = expressionManager(index => index === 0 ? new Promise((resolve, reject) => { rejectOld = reject }) : Promise.resolve(undefined))
  const fixture = await stageFixture(undefined, manager)
  fixture.stage.expression = 'wink'
  fixture.stage.expression = 'laugh'
  rejectOld(new Error('旧请求失败'))
  await settleExpressions()
  assert.equal(fixture.reports.length, 1)
  assert.match(fixture.reports[0].message, /模型表情加载失败/)
})
