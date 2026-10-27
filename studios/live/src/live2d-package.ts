import { strFromU8, strToU8, unzipSync } from 'fflate'
import { record } from './obs'

export interface Live2dPackage { entry: string; name: string; expressions: string[]; files: Map<string, Uint8Array> }
const safePath = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 240
  && !/[\\:%?#\u0000-\u001f]/u.test(value) && value.split('/').every(part => !!part && part !== '.' && part !== '..')

/** 校验导出的模型 ZIP，只保留本包引用的资源；不读取磁盘或执行模型脚本。 */
export function readLive2dPackage(bytes: Uint8Array): Live2dPackage {
  if (bytes.byteLength > 32_000_000) throw new Error('模型 ZIP 最多 32 MB')
  let count = 0, total = 0
  const names = new Set<string>()
  const archive = unzipSync(bytes, { filter(file) {
    const path = file.name.endsWith('/') ? file.name.slice(0, -1) : file.name
    if (!safePath(path) || names.has(file.name)) throw new Error('模型 ZIP 存在无效或重复路径')
    names.add(file.name); count++; total += file.originalSize
    if (count > 256 || total > 128_000_000 || file.originalSize > 32_000_000) throw new Error('模型 ZIP 解压后过大，请仅打包导出的模型资源')
    return /\.(?:json|moc3|png)$/iu.test(file.name)
  } })
  const entries = Object.keys(archive).filter(name => /\.model3\.json$/iu.test(name))
  if (entries.length !== 1) throw new Error('请导入只包含一个 model3.json 的 Live2D 模型 ZIP')
  const entry = entries[0], base = entry.slice(0, entry.lastIndexOf('/') + 1)
  const files = new Map<string, Uint8Array>()
  const json = (path: string): Record<string, unknown> => {
    const data = archive[path]
    if (!data || data.length > 2_000_000) throw new Error('模型 JSON 缺失或过大：' + path)
    let value: unknown
    try { value = JSON.parse(strFromU8(data)) }
    catch (error) { throw new Error('模型 JSON 无法解析：' + path, { cause: error }) }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('模型 JSON 内容无效：' + path)
    return record(value)
  }
  const use = (value: unknown, suffix: RegExp): string => {
    if (!safePath(value) || !suffix.test(value)) throw new Error('模型引用必须是 ZIP 内的相对资源路径')
    const path = base + value, data = archive[path]
    if (!data) throw new Error('模型缺少资源：' + value)
    files.set(path, data)
    if (path.toLowerCase().endsWith('.json')) json(path)
    return value
  }
  const model = json(entry), references = record(model.FileReferences)
  if (model.Version !== 3) throw new Error('当前支持 Cubism 3/4 导出的 model3.json 模型')
  const moc = use(references.Moc, /\.moc3$/iu), mocBytes = archive[base + moc]
  if (mocBytes.length < 8 || strFromU8(mocBytes.subarray(0, 4)) !== 'MOC3') throw new Error('模型 moc3 文件无效')
  if (!Array.isArray(references.Textures) || !references.Textures.length || references.Textures.length > 16) throw new Error('模型需要 1 至 16 张 PNG 贴图')
  let texturePixels = 0
  const textures = references.Textures.map(value => {
    const path = use(value, /\.png$/iu), data = archive[base + path]
    const header = new DataView(data.buffer, data.byteOffset, data.byteLength)
    if (data.length < 24 || header.getUint32(0) !== 0x89504e47 || header.getUint32(4) !== 0x0d0a1a0a
      || !header.getUint32(16) || !header.getUint32(20) || header.getUint32(16) > 4096 || header.getUint32(20) > 4096) throw new Error('模型 PNG 贴图无效或超过 4096 像素')
    texturePixels += header.getUint32(16) * header.getUint32(20)
    if (texturePixels > 34_000_000) throw new Error('模型贴图总量过大，请减小贴图以适配本机渲染')
    return path
  })
  const exported: Record<string, unknown> = { Moc: moc, Textures: textures }
  for (const key of ['Physics', 'Pose', 'UserData', 'DisplayInfo']) if (references[key] !== undefined) exported[key] = use(references[key], /\.json$/iu)
  const expressions: string[] = []
  if (references.Expressions !== undefined) {
    if (!Array.isArray(references.Expressions) || references.Expressions.length > 64) throw new Error('模型表情列表无效')
    exported.Expressions = references.Expressions.map(value => {
      const item = record(value)
      if (typeof item.Name !== 'string' || !item.Name.trim() || item.Name.length > 80 || expressions.includes(item.Name)) throw new Error('模型表情名称无效或重复')
      expressions.push(item.Name)
      return { Name: item.Name, File: use(item.File, /\.exp3\.json$/iu) }
    })
  }
  if (references.Motions !== undefined) {
    const motions = record(references.Motions), output: [string, object[]][] = []
    if (Object.keys(motions).length > 32) throw new Error('模型动作组过多')
    for (const [group, items] of Object.entries(motions)) {
      if (!group || group.length > 80 || !Array.isArray(items) || items.length > 64) throw new Error('模型动作列表无效')
      output.push([group, items.map(value => {
        const item = record(value), motion: Record<string, unknown> = { File: use(item.File, /\.motion3\.json$/iu) }
        for (const key of ['FadeInTime', 'FadeOutTime']) if (typeof item[key] === 'number' && Number.isFinite(item[key])) motion[key] = item[key]
        return motion
      })])
    }
    exported.Motions = Object.fromEntries(output)
  }
  const settings: Record<string, unknown> = { Version: 3, FileReferences: exported }
  for (const key of ['Groups', 'HitAreas']) {
    if (model[key] !== undefined) {
      if (!Array.isArray(model[key]) || model[key].length > 128) throw new Error('模型参数列表无效')
      settings[key] = model[key].map(value => {
        const item = record(value)
        if (typeof item.Name !== 'string' || item.Name.length > 128) throw new Error('模型参数名称无效')
        if (key === 'HitAreas') {
          if (typeof item.Id !== 'string' || item.Id.length > 128) throw new Error('模型点击区域无效')
          return { Id: item.Id, Name: item.Name }
        }
        if (typeof item.Target !== 'string' || item.Target.length > 80 || !Array.isArray(item.Ids) || item.Ids.length > 256 || item.Ids.some(id => typeof id !== 'string' || id.length > 128)) throw new Error('模型参数组无效')
        return { Target: item.Target, Name: item.Name, Ids: item.Ids }
      })
    }
  }
  if (model.Layout !== undefined) {
    const layout = record(model.Layout)
    if (Object.values(layout).some(value => typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1000)) throw new Error('模型布局参数无效')
    settings.Layout = layout
  }
  files.set(entry, strToU8(JSON.stringify(settings)))
  return { entry, name: entry.slice(entry.lastIndexOf('/') + 1).replace(/\.model3\.json$/iu, ''), expressions, files }
}

/** 文件只由校验后的资源表提供，ZIP 内其余文件不会变成网页资源。 */
export function live2dContentType(path: string): string {
  return path.toLowerCase().endsWith('.png') ? 'image/png' : path.toLowerCase().endsWith('.json') ? 'application/json' : 'application/octet-stream'
}
