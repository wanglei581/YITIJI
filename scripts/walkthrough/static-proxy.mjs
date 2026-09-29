// 走查用静态托管 + 反向代理：模仿生产 nginx（前端 dist 静态文件、SPA 回落 index.html、/api 反代到 API）。
// 用法：node scripts/walkthrough/static-proxy.mjs <dist 目录> <端口> [API 源，默认 http://127.0.0.1:4300]
// 只监听 127.0.0.1，只用于本地全功能走查。
import http from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'

const [distArg, portArg, apiArg] = process.argv.slice(2)
if (!distArg || !portArg) {
  console.error('用法：node static-proxy.mjs <dist> <port> [apiOrigin]')
  process.exit(64)
}
const dist = resolve(distArg)
const port = Number(portArg)
const api = new URL(apiArg ?? 'http://127.0.0.1:4300')

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.wasm': 'application/wasm', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
}

function proxy(req, res) {
  const upstream = http.request(
    { hostname: api.hostname, port: api.port, method: req.method, path: req.url, headers: { ...req.headers, host: `${api.hostname}:${api.port}`, 'x-forwarded-for': req.socket.remoteAddress ?? '127.0.0.1' } },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers)
      up.pipe(res)
    },
  )
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ success: false, error: { code: 'WALK_PROXY_UPSTREAM_DOWN', message: 'API 不可达' } }))
  })
  req.pipe(upstream)
}

function serveFile(res, file, cache) {
  const type = TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache ? 'public, max-age=3600' : 'no-store' })
  createReadStream(file).pipe(res)
}

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return proxy(req, res)
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '')
    const file = join(dist, rel)
    if (file.startsWith(dist) && existsSync(file) && statSync(file).isFile()) return serveFile(res, file, rel.startsWith('assets/'))
    if (extname(rel) && !rel.endsWith('.html')) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      return res.end('not found')
    }
    serveFile(res, join(dist, 'index.html'), false)
  })
  .listen(port, '127.0.0.1', () => console.log(`static-proxy ${dist} → http://127.0.0.1:${port} (api ${api.origin})`))
