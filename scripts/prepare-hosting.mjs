import { readFileSync, readdirSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root = fileURLToPath(new URL('../', import.meta.url))
const frontend = path.join(root, 'frontend/dist')
const output = path.join(root, 'dist')
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json; charset=utf-8','.csv':'text/csv; charset=utf-8','.srt':'application/x-subrip; charset=utf-8','.vtt':'text/vtt; charset=utf-8','.txt':'text/plain; charset=utf-8','.woff2':'font/woff2'}
const assets = {}
function collect(directory) {
  for (const entry of readdirSync(directory, {withFileTypes:true})) {
    const file=path.join(directory,entry.name)
    if(entry.isDirectory()) collect(file)
    else if(entry.isFile()) {
      const type=mime[path.extname(file)]??'text/plain; charset=utf-8'
      const data=readFileSync(file)
      assets['/'+path.relative(frontend,file).split(path.sep).join('/')] = type==='font/woff2'
        ? {type,base64:data.toString('base64')}
        : {type,text:data.toString('utf8')}
    }
    else throw new Error('Static assets must be regular files')
  }
}
collect(frontend)
const source=readFileSync(path.join(root,'worker/index.mjs'),'utf8')
if(!source.includes('/*SITE_ASSETS*/{}'))throw new Error('Missing Worker asset marker')
rmSync(output,{recursive:true,force:true})
mkdirSync(path.join(output,'server'),{recursive:true})
mkdirSync(path.join(output,'.openai'),{recursive:true})
writeFileSync(path.join(output,'server/index.js'),source.replace('/*SITE_ASSETS*/{}',()=>JSON.stringify(assets)))
writeFileSync(path.join(output,'.openai/hosting.json'),readFileSync(path.join(root,'.openai/hosting.json')))
console.log('Sites Worker prepared with model gateway and '+Object.keys(assets).length+' bundled assets')
