#!/usr/bin/env node
// Zero-install local launcher. Serves prebuilt assets and a loopback Ollama gateway;
// never exposes source, arbitrary files, environment variables or document storage.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { handleLocalModel } from './local-model.mjs'
const base = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(base, 'frontend/dist')
const port = Number(process.env.PORT || 4173)
if (!Number.isInteger(port) || port < 1024 || port > 65535) { console.error('PORT must be an integer between 1024 and 65535.'); process.exit(1) }
if (!fs.existsSync(path.join(root, 'index.html'))) { console.error('frontend/dist is missing. Restore the release package or run: cd frontend && npm ci && npm run build'); process.exit(1) }
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.srt': 'application/x-subrip; charset=utf-8', '.vtt': 'text/vtt; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2' }
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) { res.writeHead(403); res.end('Local host only'); return }
  if (await handleLocalModel(req, res, port)) return
  if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); res.writeHead(405); res.end('Method not allowed'); return }
  let pathname
  try { pathname = decodeURIComponent((req.url || '/').split('?')[0]) } catch { res.writeHead(400); res.end('Invalid URL'); return }
  if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').includes('..')) { res.writeHead(403); res.end('Forbidden'); return }
  let filename = path.resolve(root, '.' + pathname)
  if (filename !== root && !filename.startsWith(root + path.sep)) { res.writeHead(403); res.end('Forbidden'); return }
  if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
    const appRoute = pathname === '/' || /^\/(?:documents(?:\/new)?|review\/[^/]+|evaluations(?:\/new)?|evaluation\/[^/]+|glossary|settings|models|help|home|projects\/[^/]+(?:\/(?:documents(?:\/new)?|review\/[^/]+|glossary|models|evaluations(?:\/new)?|evaluation\/[^/]+))?)\/?$/.test(pathname)
    if (!appRoute) { res.writeHead(404); res.end('Not found'); return }
    filename = path.join(root, 'index.html') // React Router deep-link fallback
  }
  const type = mime[path.extname(filename)]
  if (!type) { res.writeHead(404); res.end('Not found'); return }
  const stat = fs.statSync(filename)
  res.setHeader('Content-Type', type)
  res.setHeader('Cache-Control', filename.includes(path.sep + 'assets' + path.sep) ? 'public, max-age=31536000, immutable' : 'no-cache')
  res.setHeader('Content-Length', stat.size)
  res.writeHead(200)
  if (req.method === 'HEAD') res.end()
  else { const stream = fs.createReadStream(filename); stream.on('error', () => res.destroy()); stream.pipe(res) }
})
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Close the other process or open an already-running Ian at http://127.0.0.1:${port}. Do not change the port unless you have backed up your data.` : error.message); process.exitCode = 1 })
server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${port}`
  console.log(`\n  IAN — Translation Review Workspace\n\n  Open: ${url}\n  Keep this terminal open. Stop with Ctrl+C.\n  Always use the same browser, profile and address.\n  Documents stay in your browser. Back up JSON regularly.\n`)
  if (!process.argv.includes('--no-open')) {
    const [command, args] = process.platform === 'win32' ? ['cmd.exe', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
    const child = spawn(command, args, { stdio: 'ignore', detached: true }); child.on('error', () => {}); child.unref()
  }
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); server.closeAllConnections(); })
