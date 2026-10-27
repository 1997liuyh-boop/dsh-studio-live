import { build } from 'esbuild'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
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
await build({ entryPoints: [join(dir, 'src/index.ts')], outfile: join(dir, 'lib/index.js'), bundle: true, platform: 'node', format: 'esm', target: 'node22', external: ['@deepseek-ai/*'], define: { STUDIO_PROJECT: JSON.stringify(project) } })
await build({ entryPoints: [join(root, 'packages/sdk/client.tsx')], outfile: join(dir, 'lib/client.js'), bundle: true, format: 'cjs', platform: 'browser', jsx: 'automatic', external: ['react', 'react/jsx-runtime'],
  define: { STUDIO_CARD_CSS: JSON.stringify(await css(join(root, 'packages/sdk/card.css'))), STUDIO_PROJECT: JSON.stringify(project), STUDIO_PROJECT_ORDER: String(project.order) },
  banner: { js: `window.__ModuleLoader__.load({id:${JSON.stringify(pkg.name)},factory:(require)=>{var module={exports:{}};var exports=module.exports;` }, footer: { js: 'return module.exports;}});' } })
await build({ entryPoints: [join(dir, 'src/main.tsx')], outfile: join(dir, 'static/app.js'), bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic', minify: true, define: { 'process.env.NODE_ENV': '"production"' } })
await writeFile(join(dir, 'static/app.css'), await css(join(dir, 'src/style.css')))
await writeFile(join(dir, 'static/index.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>直播工作室</title><link rel="stylesheet" href="/studio-projects/live/app.css"></head><body><div id="root"></div><script type="module" src="/studio-projects/live/app.js"></script></body></html>\n')
await writeFile(join(dir, 'dsh.plugin.json'), JSON.stringify({ name: pkg.name, version: pkg.version, description: project.description, entry: { name: pkg.name, inject: ['studioProjects', 'tools'] }, client: { platform: 'web' } }, null, 2) + '\n')
console.log('直播工作室独立构建完成')
