/** 构建源码后同步运行文件；Git 安装直接使用已提交的运行文件。 */
import { cp, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
const root = fileURLToPath(new URL('../', import.meta.url))
await import('./source-build.mjs')
for (const path of ["lib","static","reborn","app","upstream","patches","adapters","studio.json","dsh.plugin.json","sources.json","LIVE2D.md","THIRD-PARTY-LIVE2D.txt"]) {
  const source = join(root, 'studios/live', path)
  if (await access(source).then(() => true, () => false)) await cp(source, join(root, path), { recursive: true })
}
console.log('根目录安装文件已同步：live')
