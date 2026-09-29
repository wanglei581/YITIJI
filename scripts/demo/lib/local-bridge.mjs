// ============================================================================
// 演示用本机网桥：只替代 Windows 终端程序（apps/terminal-agent）本机接口里
// 一体机页面「拿终端身份」要用的两条，其余一律如实回「演示环境不可用」。
//
//   GET  /local/terminal-identity     → { terminalId, terminalCode }
//   POST /local/terminal-boot-ticket  → 用演示终端凭证向服务端换一张 60 秒一次性启动票
//
// 行为照抄 apps/terminal-agent/src/local-api/qr-login-server.ts 的同名两条：
// 只监听 127.0.0.1、只认演示一体机的 Origin、启动票必须带网桥令牌、每分钟最多 6 张。
// 终端凭证只在本进程内存里，不进浏览器。
//
// 不做的事（故意）：不上报心跳、不领打印任务、不碰打印机与扫描仪。
// 所以一体机上的设备状态会如实显示「未连接」，打印任务不会被领走，
// 页面上不会出现「已打印」。
// ============================================================================

import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'

const BOOT_TICKET_RATE_WINDOW_MS = 60_000
const BOOT_TICKET_RATE_LIMIT = 6

function tokenMatches(provided, expected) {
  const value = Array.isArray(provided) ? provided[0] : provided
  if (!value || !expected) return false
  const a = Buffer.from(value)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function cors(res, origin) {
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Local-Bridge-Token')
  res.setHeader('Access-Control-Allow-Private-Network', 'true')
  res.setHeader('Access-Control-Max-Age', '300')
  res.setHeader('Vary', 'Origin')
}

function send(res, status, body, origin) {
  if (origin) cors(res, origin)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

/**
 * @param {{ port: number, allowedOrigins: string[], bridgeToken: string, apiBaseUrl: string,
 *           terminalId: string, terminalCode: string, agentToken: string, log?: (line: string) => void }} options
 */
export function startDemoBridge(options) {
  const { port, allowedOrigins, bridgeToken, apiBaseUrl, terminalId, terminalCode, agentToken } = options
  const log = options.log ?? (() => {})
  const ticketRequests = []

  const server = http.createServer((req, res) => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined
    const allowed = origin !== undefined && allowedOrigins.includes(origin)
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')

    if (!allowed) {
      send(res, 403, { success: false, error: { code: 'LOCAL_DEMO_ORIGIN_FORBIDDEN', message: '演示网桥只接受本机演示一体机页面的请求' } })
      return
    }
    if (req.method === 'OPTIONS') {
      cors(res, origin)
      res.writeHead(204)
      res.end()
      return
    }

    if (req.method === 'GET' && url.pathname === '/local/terminal-identity') {
      send(res, 200, { success: true, data: { terminalId, terminalCode } }, origin)
      return
    }

    if (req.method === 'POST' && url.pathname === '/local/terminal-boot-ticket') {
      if (!tokenMatches(req.headers['x-local-bridge-token'], bridgeToken)) {
        send(res, 403, { success: false, error: { code: 'LOCAL_TERMINAL_BOOT_ORIGIN_FORBIDDEN', message: '终端启动票仅供本机演示一体机使用' } }, origin)
        return
      }
      const now = Date.now()
      while (ticketRequests[0] !== undefined && ticketRequests[0] <= now - BOOT_TICKET_RATE_WINDOW_MS) ticketRequests.shift()
      if (ticketRequests.length >= BOOT_TICKET_RATE_LIMIT) {
        send(res, 429, { success: false, error: { code: 'LOCAL_TERMINAL_BOOT_RATE_LIMITED', message: '终端启动票请求过于频繁，请稍后重试' } }, origin)
        return
      }
      ticketRequests.push(now)
      req.resume()
      fetch(`${apiBaseUrl}/terminals/boot-ticket`, {
        method: 'POST',
        headers: { 'x-terminal-id': terminalId, Authorization: `Bearer ${agentToken}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(3_000),
      })
        .then(async (response) => {
          const payload = await response.json().catch(() => ({}))
          if (!response.ok) {
            log(`启动票申请被服务端拒绝：HTTP ${response.status}`)
            send(res, 503, { success: false, error: { code: 'LOCAL_TERMINAL_BOOT_NOT_READY', message: '服务端暂未签发启动票，请稍后重试' } }, origin)
            return
          }
          const ticket = payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload
          send(res, 200, { success: true, data: ticket }, origin)
        })
        .catch(() => {
          send(res, 503, { success: false, error: { code: 'LOCAL_TERMINAL_BOOT_NOT_READY', message: '连不上本机演示服务端，请稍后重试' } }, origin)
        })
      return
    }

    // 扫码登录、U 盘、打印唤醒等本机硬件接口：演示环境没有终端程序，如实告知。
    send(res, 503, { success: false, error: { code: 'LOCAL_DEMO_NOT_AVAILABLE', message: '演示环境未连接一体机硬件程序，此功能不可用' } }, origin)
  })

  return new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolvePromise({
        server,
        close: () => new Promise((done) => {
          server.closeAllConnections?.()
          server.close(() => done())
        }),
      })
    })
  })
}
