import { build } from 'esbuild'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { validateCatalog } from './catalog.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
await validateCatalog(root)
const dir = join(root, 'studios/live')
const project = JSON.parse(await readFile(join(dir, 'studio.json'), 'utf8'))
const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
const css = async path => (await postcss([tailwind()]).process(await readFile(path, 'utf8'), { from: path })).css
await mkdir(join(dir, 'lib'), { recursive: true })
await mkdir(join(dir, 'static'), { recursive: true })
await build({ entryPoints: [join(dir, 'src/index.ts')], outfile: join(dir, 'lib/index.js'), bundle: true, platform: 'node', format: 'esm', target: 'node22', external: ['@deepseek-ai/*'], banner: { js: "import { createRequire as createNodeRequire } from 'node:module'; const require = createNodeRequire(import.meta.url);" }, define: { STUDIO_PROJECT: JSON.stringify(project) } })
await build({ entryPoints: [join(root, 'packages/sdk/client.tsx')], outfile: join(dir, 'lib/client.js'), bundle: true, format: 'cjs', platform: 'browser', jsx: 'automatic', external: ['react', 'react/jsx-runtime'],
  define: { STUDIO_CARD_CSS: JSON.stringify(await css(join(root, 'packages/sdk/card.css'))), STUDIO_PROJECT: JSON.stringify(project), STUDIO_PROJECT_ORDER: String(project.order) },
  banner: { js: `window.__ModuleLoader__.load({id:${JSON.stringify(pkg.name)},factory:(require)=>{var module={exports:{}};var exports=module.exports;` }, footer: { js: 'return module.exports;}});' } })
await build({ entryPoints: [join(dir, 'src/main.tsx')], outfile: join(dir, 'static/app.js'), bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic', minify: true, define: { 'process.env.NODE_ENV': '"production"' } })
await build({ entryPoints: [join(dir, 'src/overlay.ts')], outfile: join(dir, 'static/overlay.js'), bundle: true, platform: 'browser', format: 'esm', minify: true })
await build({ entryPoints: [join(dir, 'src/live2d-runtime.ts')], outfile: join(dir, 'static/live2d.js'), bundle: true, platform: 'browser', format: 'iife', globalName: 'dshLive2d', minify: true })
// 官方运行库和样例仅在显式指定的本地验证构建中复制。
for (const file of ['live2dcubismcore.min.js', 'Haru.zip', 'LIVE2D-NOTICE.txt', 'LIVE2D-DEVELOPMENT.json']) await rm(join(dir, 'static', file), { force: true })
if (process.argv.includes('--local-development')) {
  for (const [from, to] of [['live2dcubismcore.min.js', 'live2dcubismcore.min.js'], ['Haru.zip', 'Haru.zip'], ['NOTICE.txt', 'LIVE2D-NOTICE.txt'], ['manifest.json', 'LIVE2D-DEVELOPMENT.json']]) await copyFile(join(root, '.local-live2d', from), join(dir, 'static', to))
}
await build({ entryPoints: [join(dir, 'src/minecraft-worker.ts')], outfile: join(dir, 'lib/minecraft-worker.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['mineflayer'] })
await writeFile(join(dir, 'static/app.css'), await css(join(dir, 'src/style.css')))
await writeFile(join(dir, 'static/index.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>直播工作室</title><link rel="stylesheet" href="/studio-projects/live/app.css"></head><body><div id="root"></div><script type="module" src="/studio-projects/live/app.js"></script></body></html>\n')
await writeFile(join(dir, 'dsh.plugin.json'), JSON.stringify({ name: pkg.name, version: pkg.version, description: project.description, entry: { name: pkg.name, inject: ['studioProjects', 'tools'] }, client: { platform: 'web' } }, null, 2) + '\n')
console.log('直播工作室独立构建完成')
