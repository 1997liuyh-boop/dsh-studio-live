import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { validateCatalog } from './catalog.mjs'
const root=fileURLToPath(new URL('../',import.meta.url))
const catalog=await validateCatalog(root)
const npmCli=process.env.npm_execpath?.endsWith('npm-cli.js') ? process.env.npm_execpath : join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js')
const localDevelopment=process.argv.includes('--local-development')
const output=join(root,'artifacts',...(localDevelopment ? ['local-development'] : []))
await mkdir(output,{recursive:true})
const artifacts=[]
for (const item of catalog.packages) {
  if (!localDevelopment && ['live2dcubismcore.min.js','Haru.zip','LIVE2D-DEVELOPMENT.json'].some(file=>existsSync(join(root,item.path,'static',file)))) throw new Error('包含官方 Live2D 资源，只能以 --local-development 打包供本地验证；公开发行前需要确认许可')
  const result=spawnSync(process.execPath,[npmCli,'pack','--json','--pack-destination',output],{cwd:join(root,item.path),encoding:'utf8'})
  if (result.status!==0) throw new Error('打包失败：'+item.id+' '+result.stderr)
  const [pack]=JSON.parse(result.stdout)
  artifacts.push({id:item.id,name:pack.name,version:pack.version,file:pack.filename,sha256:createHash('sha256').update(await readFile(join(output,pack.filename))).digest('hex')})
}
await writeFile(join(output,'manifest.json'),JSON.stringify({schemaVersion:1,localDevelopment,artifacts},null,2)+'\n')
console.log('已生成 '+artifacts.length+' 个安装包和 SHA256 清单')
