/**
 * Native-binary-free, deterministic production bundler for this fixed React app.
 * TypeScript is the only build-time API. Static CommonJS dependencies are packed
 * into a self-contained script without eval, CDNs or runtime module fetching.
 * Keep npm run build:vite as the standard Vite alternative for development teams.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const resolveFromRoot = createRequire(path.join(root, 'package.json'))
const prod = {
  react: 'react/cjs/react.production.js',
  'react/jsx-runtime': 'react/cjs/react-jsx-runtime.production.js',
  'react-dom': 'react-dom/cjs/react-dom.production.js',
  'react-dom/client': 'react-dom/cjs/react-dom-client.production.js',
  scheduler: 'scheduler/cjs/scheduler.production.js',
  'react-router': 'react-router/dist/production/index.js',
  'react-router/dom': 'react-router/dist/production/dom-export.js',
  'react-router-dom': 'react-router-dom/dist/index.js',
}
const ids = new Map(), modules = []
function resolveModule(specifier, from) {
  if (specifier.endsWith('.css')) return null
  if (prod[specifier]) return path.join(root, 'node_modules', prod[specifier])
  if (specifier.startsWith('.')) {
    const full = path.resolve(path.dirname(from), specifier)
    for (const candidate of [full, `${full}.ts`, `${full}.tsx`, `${full}.js`, path.join(full, 'index.ts'), path.join(full, 'index.tsx'), path.join(full, 'index.js')]) if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
    throw new Error(`Cannot resolve ${specifier} from ${from}`)
  }
  return resolveFromRoot.resolve(specifier)
}
function add(file) {
  if (file === null) return -1
  if (ids.has(file)) return ids.get(file)
  if (!path.isAbsolute(file)) throw new Error(`A Node-only module reached the browser build: ${file}`)
  const id = modules.length; ids.set(file, id); modules.push(null)
  let code = fs.readFileSync(file, 'utf8')
  if (/\.tsx?$/.test(file)) {
    const compiled = ts.transpileModule(code, { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, removeComments: false }, reportDiagnostics: true })
    const diagnostics = compiled.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error) ?? []
    if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: f => f, getNewLine: () => '\n' }))
    code = compiled.outputText
  }
  code = code.replace(/process\.env\.NODE_ENV/g, '"production"')
  const mappings = {}
  // Only statically quoted calls are bundled. React Router's unused server-side
  // framework dynamic loading paths are left inaccessible (this app uses none).
  const calls = [...code.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)]
  for (const [, specifier] of calls) mappings[specifier] = add(resolveModule(specifier, file))
  modules[id] = { code, mappings, name: path.relative(root, file).replaceAll('\\', '/') }
  return id
}
const entry = add(path.join(root, 'src/main.tsx'))
const wrappers = modules.map(m => `function(module,exports,require){\n/* ${m.name} */\n${m.code}\n}`).join(',\n')
const script = `/* Ian Review production bundle. Third-party notices: /THIRD_PARTY_NOTICES.txt */\n(()=>{"use strict";const modules=[${wrappers}];const maps=${JSON.stringify(modules.map(m => m.mappings))};const cache={};function load(id){if(id===-1)return {};if(cache[id])return cache[id].exports;const m=cache[id]={exports:{}};modules[id](m,m.exports,s=>{if(!Object.prototype.hasOwnProperty.call(maps[id],s))throw new Error("Unsupported dynamic module: "+s);return load(maps[id][s]);});return m.exports;}load(${entry});})();\n`
const css = fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8')
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 12)
const jsName = `assets/app-${hash(script)}.js`, cssName = `assets/app-${hash(css)}.css`
const out = path.join(root, 'dist'); fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(path.join(out, 'assets'), { recursive: true })
fs.writeFileSync(path.join(out, jsName), script); fs.writeFileSync(path.join(out, cssName), css)
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace('<script type="module" src="/src/main.tsx"></script>', `<script defer src="/${jsName}"></script>`).replace('</head>', `  <link rel="stylesheet" href="/${cssName}" />\n</head>`)
fs.writeFileSync(path.join(out, 'index.html'), html)
if (fs.existsSync(path.join(root, 'public'))) fs.cpSync(path.join(root, 'public'), out, { recursive: true })
let notices = 'IAN REVIEW — THIRD-PARTY LICENSES\n\n'
for (const name of ['react', 'react-dom', 'scheduler', 'react-router', 'react-router-dom', 'cookie', 'set-cookie-parser']) {
  const dir = path.join(root, 'node_modules', name), pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
  const license = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'].find(f => fs.existsSync(path.join(dir, f)))
  if (!license) throw new Error(`Missing third-party license: ${name}`)
  notices += `\n${'='.repeat(70)}\n${name} ${pkg.version}\n${'='.repeat(70)}\n${fs.readFileSync(path.join(dir, license), 'utf8')}\n`
}
const pretendardLicense = path.join(root, 'public/fonts/OFL.txt')
if (fs.existsSync(pretendardLicense)) notices += `\n${'='.repeat(70)}\nPretendard Variable\n${'='.repeat(70)}\n${fs.readFileSync(pretendardLicense, 'utf8')}\n`
fs.writeFileSync(path.join(out, 'THIRD_PARTY_NOTICES.txt'), notices)
fs.writeFileSync(path.join(root, '../THIRD_PARTY_NOTICES.txt'), notices)
console.log(`Portable build complete: ${modules.length} modules, ${(Buffer.byteLength(script) / 1024).toFixed(0)} KB JS, ${(Buffer.byteLength(css) / 1024).toFixed(0)} KB CSS`)
console.log(`Output: ${out}`)
