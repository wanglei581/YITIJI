// ============================================================================
// 模拟终端的本机网桥：127.0.0.1:<bridge-port>，路由、鉴权（X-Local-Bridge-Token / 本机短期会话）、
// CORS、响应信封逐条照抄 apps/terminal-agent/src/local-api/qr-login-server.ts。
//
//   GET  /local/panel                   只读状态页（qr-login-server.ts:144-161）
//   POST /local/terminal-boot-ticket    换 60 秒一次性启动票（:165-197）
//   GET  /local/terminal-identity       { terminalId, terminalCode }（:217-224）
//   POST /local/bridge/session          Origin 绑定的 5 分钟短期会话（:226-238，bridge-session.ts）
//   POST /local/print/wake              立刻领一次打印任务（:240-243、:273-307）
//   GET  /local/usb/status              U 盘在不在（:328-332）
//   GET  /local/usb/files               列 U 盘文件、发一次性 safeId（:334-340）
//   POST /local/usb/upload              读文件并代传 POST /files/kiosk-upload（:342-412）
//   POST /local/qr-login/create         代调 POST /member/auth/qr/create（:260-263、:434-462）
//   POST /local/qr-login/claim          代调 POST /member/auth/qr/:ticketId/claim（:265-268、:464-495）
//
// U 盘 = ${SIM_AGENT_DIR}/usb 目录（非空，或 ${SIM_AGENT_DIR}/usb-inserted 标记存在 → 视为已插入）。
// 枚举规则照抄 apps/terminal-agent/src/usb/usb-files.ts（根目录 + 一级子目录、pdf/jpg/jpeg/png、≤15MB、
// 不跟随符号链接、safeId 一次性且 10 分钟过期、读取前复核大小与真实路径）。
// ============================================================================

import http from 'node:http'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { extname, join, sep } from 'node:path'
import { HttpError, SIM_AGENT_VERSION, apiRequest, errorText, info, warn } from './common.mjs'

const MAX_BODY_BYTES = 8 * 1024
const TICKET_ID_RE = /^[A-Za-z0-9_-]{32,96}$/
const CLAIM_TOKEN_TTL_BUFFER_MS = 5_000
const BOOT_TICKET_RATE_WINDOW_MS = 60_000
const BOOT_TICKET_RATE_LIMIT = 6
const SESSION_TTL_SECONDS = 5 * 60
const MAX_ACTIVE_SESSIONS = 32

// ── 静态令牌 / 短期会话（origin-guard.ts、bridge-session.ts）────────────────

function staticTokenValid(headerValue, configured) {
  const token = configured?.trim()
  if (!token) return false
  const provided = Array.isArray(headerValue) ? headerValue[0] : headerValue
  if (!provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

function createSessionStore(ttlSeconds = SESSION_TTL_SECONDS) {
  const sessions = new Map()
  const digest = (t) => createHash('sha256').update(t).digest('hex')
  const cleanup = (now) => {
    for (const [d, s] of sessions) if (s.expiresAt <= now) sessions.delete(d)
    while (sessions.size >= MAX_ACTIVE_SESSIONS) {
      const oldest = sessions.keys().next().value
      if (!oldest) break
      sessions.delete(oldest)
    }
  }
  return {
    issue(origin) {
      const now = Date.now()
      cleanup(now)
      const token = randomBytes(32).toString('base64url')
      sessions.set(digest(token), { origin, expiresAt: now + ttlSeconds * 1000 })
      return { token, expiresInSeconds: ttlSeconds }
    },
    validate(headerValue, origin) {
      const provided = Array.isArray(headerValue) ? headerValue[0] : headerValue
      if (!provided) return false
      const now = Date.now()
      cleanup(now)
      const stored = sessions.get(digest(provided))
      return Boolean(stored && stored.origin === origin && stored.expiresAt > now)
    },
  }
}

// ── 响应（:575-600）──────────────────────────────────────────────────────────

function writeCors(res, origin) {
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Local-Bridge-Token')
  res.setHeader('Access-Control-Allow-Private-Network', 'true')
  res.setHeader('Access-Control-Max-Age', '300')
  res.setHeader('Vary', 'Origin')
}
function sendEnvelope(res, status, data, origin) {
  writeCors(res, origin)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ success: true, data }))
}
function sendJson(res, status, error, origin) {
  if (origin) writeCors(res, origin)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ success: false, error }))
}
function sendEmpty(res, status, origin) {
  writeCors(res, origin)
  res.writeHead(status)
  res.end()
}

class LocalApiException {
  constructor(status, code, message) {
    this.status = status
    this.error = { code, message }
  }
}

async function readJsonBody(req, context = 'qr') {
  const prefix = context === 'usb' ? 'LOCAL_USB' : 'LOCAL_QR'
  let bytes = 0
  const chunks = []
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > MAX_BODY_BYTES) throw new LocalApiException(413, `${prefix}_BODY_TOO_LARGE`, '请求体过大')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  let parsed
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
  } catch {
    throw new LocalApiException(400, `${prefix}_BAD_JSON`, '请求 JSON 格式无效')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new LocalApiException(400, `${prefix}_BAD_JSON`, '请求 JSON 必须是对象')
  return parsed
}

async function assertEmptyBody(req) {
  let bytes = 0
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > MAX_BODY_BYTES) throw new LocalApiException(413, 'LOCAL_PRINT_BODY_TOO_LARGE', '请求体过大')
  }
  if (bytes > 0) throw new LocalApiException(400, 'LOCAL_PRINT_BODY_NOT_ALLOWED', '本机打印唤醒不接受请求体')
}

/** :547-557 backendError */
function backendError(err, context = 'qr', retryable = false) {
  const fallbackCode = context === 'usb' ? 'LOCAL_USB_BACKEND_ERROR' : 'LOCAL_QR_BACKEND_ERROR'
  const fallbackMessage = context === 'usb' ? 'U 盘文件上传后端请求失败' : '扫码登录后端请求失败'
  if (err instanceof HttpError) {
    return new LocalApiException(retryable ? 503 : err.status, retryable ? 'LOCAL_TERMINAL_BOOT_RETRYABLE' : (err.code ?? fallbackCode), err.apiMessage ?? fallbackMessage)
  }
  // 网络层错误（axios 无 response）→ 502；启动票 → 503 可重试
  return new LocalApiException(retryable ? 503 : 502, retryable ? 'LOCAL_TERMINAL_BOOT_RETRYABLE' : fallbackCode, retryable ? '云端暂不可用，请稍后重试' : fallbackMessage)
}

function localExceptionFromUnknown(err, context) {
  if (err instanceof LocalApiException) return err
  if (context === 'print') return new LocalApiException(500, 'LOCAL_PRINT_INTERNAL_ERROR', '本机打印唤醒服务异常')
  return context === 'usb'
    ? new LocalApiException(500, 'LOCAL_USB_INTERNAL_ERROR', 'U 盘导入本地服务异常')
    : new LocalApiException(500, 'LOCAL_QR_INTERNAL_ERROR', '本机扫码登录服务异常')
}

// ── U 盘（usb/usb-files.ts）──────────────────────────────────────────────────

const ALLOWED_USB_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png'])
const MAX_USB_FILE_BYTES = 15 * 1024 * 1024
const MAX_USB_FILES_LISTED = 200
const SAFE_ID_TTL_MS = 10 * 60 * 1000
const IGNORED_NAMES = new Set(['system volume information', '$recycle.bin'])
const USB_LABEL = '模拟U盘'

function createUsb(paths) {
  let registry = new Map()

  function detectDrive() {
    let nonEmpty = false
    try {
      nonEmpty = readdirSync(paths.usb).some((n) => !n.startsWith('.'))
    } catch {
      nonEmpty = false
    }
    if (nonEmpty || existsSync(paths.usbMarker)) return { rootPath: paths.usb, label: USB_LABEL }
    return null
  }

  function enumerate(rootPath) {
    let names
    try {
      names = readdirSync(rootPath)
    } catch {
      return []
    }
    const entries = []
    const subdirectories = []
    const collect = (dirPath, prefix, dirNames) => {
      for (const name of dirNames) {
        if (entries.length >= MAX_USB_FILES_LISTED) break
        if (name.startsWith('.') || name.startsWith('$')) continue
        if (IGNORED_NAMES.has(name.toLowerCase())) continue
        const fullPath = join(dirPath, name)
        let stat
        try {
          stat = lstatSync(fullPath)
        } catch {
          continue
        }
        if (stat.isDirectory() && prefix === '') {
          subdirectories.push(name)
          continue
        }
        if (!stat.isFile()) continue
        const ext = extname(name).toLowerCase()
        if (!ALLOWED_USB_EXTENSIONS.has(ext)) continue
        if (stat.size <= 0 || stat.size > MAX_USB_FILE_BYTES) continue
        entries.push({ filename: prefix + name, extension: ext, sizeBytes: stat.size, absolutePath: fullPath })
      }
    }
    collect(rootPath, '', names)
    for (const sub of subdirectories) {
      if (entries.length >= MAX_USB_FILES_LISTED) break
      let child
      try {
        child = readdirSync(join(rootPath, sub))
      } catch {
        continue
      }
      collect(join(rootPath, sub), `${sub}/`, child)
    }
    return entries
  }

  return {
    status() {
      const drive = detectDrive()
      return drive ? { present: true, driveLabel: drive.label } : { present: false, driveLabel: null }
    },
    refresh() {
      registry = new Map()
      const drive = detectDrive()
      if (!drive) return { present: false, driveLabel: null, files: [] }
      const files = enumerate(drive.rootPath).map((entry) => {
        const safeId = randomUUID()
        registry.set(safeId, { ...entry, driveRoot: drive.rootPath, createdAt: Date.now() })
        return { safeId, filename: entry.filename, extension: entry.extension, sizeBytes: entry.sizeBytes }
      })
      return { present: true, driveLabel: drive.label, files }
    },
    consume(safeId) {
      const entry = registry.get(safeId)
      if (!entry) return null
      registry.delete(safeId)
      if (Date.now() - entry.createdAt > SAFE_ID_TTL_MS) return null
      let stat
      try {
        stat = lstatSync(entry.absolutePath)
      } catch {
        return null
      }
      if (!stat.isFile() || stat.size !== entry.sizeBytes) return null
      try {
        const realRoot = realpathSync.native(entry.driveRoot)
        const realFile = realpathSync.native(entry.absolutePath)
        const rootWithSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep
        if (!realFile.startsWith(rootWithSep)) return null
      } catch {
        return null
      }
      let buffer
      try {
        buffer = readFileSync(entry.absolutePath)
      } catch {
        return null
      }
      if (buffer.length <= 0 || buffer.length > MAX_USB_FILE_BYTES) return null
      return { buffer, filename: entry.filename, extension: entry.extension }
    },
  }
}

function guessUsbMimeType(ext) {
  if (ext === '.pdf') return 'application/pdf'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.png') return 'image/png'
  return 'application/octet-stream'
}

function normalizeEndUserAuthorization(value) {
  const a = Array.isArray(value) ? value[0] : value
  if (!a || a.length > 8 * 1024) return undefined
  return /^Bearer\s+[^\s]+$/i.test(a) ? a : undefined
}

// ── 只读状态页（status-panel.ts，文案同源，标题标明「走查模拟」）────────────

const PRINTER_LABELS = { ready: '打印机就绪', offline: '打印机离线', error: '打印机异常', low_paper: '打印纸不足', paper_empty: '打印机缺纸（模拟）', unknown: '打印机状态待确认' }
function escapeHtml(v) {
  return String(v).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[c])
}
function renderPanel(s) {
  const card = (label, value, ok) => `<article class="card"><div class="label">${label}</div><div class="value ${ok === undefined ? '' : ok ? 'ok' : 'warn'}">${escapeHtml(value)}</div></article>`
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="15"><title>模拟终端状态</title>
<style>body{margin:0;padding:24px 16px;font-family:"PingFang SC","Microsoft YaHei",sans-serif;background:#f4f7fb;color:#172033}main{max-width:780px;margin:0 auto}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}.card{background:#fff;border:1px solid #dce5f2;border-radius:14px;padding:16px}.label{font-size:13px;color:#71809a}.value{margin-top:6px;font-size:17px;font-weight:700}.ok{color:#147a45}.warn{color:#a45a07}.note{color:#a45a07;font-weight:700}</style></head>
<body><main><h1>模拟终端（走查）</h1><p class="note">这是走查用的模拟终端程序，不连接任何真实打印机、扫描仪或 U 盘。</p><section class="grid">
${card('终端编号', s.terminalCode)}${card('Agent 版本', SIM_AGENT_VERSION)}${card('云端连接', s.cloudConnected ? '云端连接正常' : '云端暂未连接', s.cloudConnected)}
${card('最近成功心跳', s.lastHeartbeatAt ? new Date(s.lastHeartbeatAt).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' }) : '尚未成功连接')}
${card('打印设备', PRINTER_LABELS[s.printerStatus] ?? '打印机状态待确认', s.printerStatus === 'ready')}${card('任务存储', '本地任务库就绪', true)}
${card('扫描输入', '扫描目录就绪（模拟收件箱）', true)}${card('终端凭据', s.credentialStatus === 'ready' ? '终端凭据有效' : '终端凭据需重新绑定', s.credentialStatus === 'ready')}
</section></main></body></html>`
}
const PANEL_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Content-Type': 'text/html; charset=utf-8',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
}

// ── 服务器 ──────────────────────────────────────────────────────────────────

/**
 * @param {{ port: number, allowedOrigins: string[], bridgeToken?: string, apiBaseUrl: string,
 *           credential: { terminalId: string, terminalCode: string, terminalToken: string },
 *           paths: object, wakePrintQueue?: () => { accepted: boolean, coalesced: boolean },
 *           getPanelStatus?: () => object }} options
 */
export function startBridge(options) {
  const { allowedOrigins, apiBaseUrl, credential, paths } = options
  const origins = [...new Set(allowedOrigins.map((o) => o.trim()).filter(Boolean))]
  const bridgeToken = options.bridgeToken?.trim() || undefined
  const sessions = createSessionStore()
  const claims = new Map()
  const bootTicketRequests = []
  const usb = createUsb(paths)
  const originAllowed = (o) => Boolean(o) && origins.includes(o)
  const authorized = (req, origin) => staticTokenValid(req.headers['x-local-bridge-token'], bridgeToken) || sessions.validate(req.headers['x-local-bridge-token'], origin)
  // api-client.ts：带终端凭证；qr create/claim 走默认重试，启动票与 U 盘上传显式不重试。
  const api = (method, path, body, opts = {}) => apiRequest({ apiBaseUrl, method, path, body, credential, ...opts })

  async function handle(req, res) {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const isUsbRoute = url.pathname.startsWith('/local/usb/')
    const isPrintRoute = url.pathname.startsWith('/local/print/')

    if (url.pathname === '/local/panel') {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET')
        return sendJson(res, 405, { code: 'LOCAL_PANEL_METHOD_NOT_ALLOWED', message: '本机状态页仅支持读取' })
      }
      if (url.search.length > 0) return sendJson(res, 400, { code: 'LOCAL_PANEL_QUERY_NOT_ALLOWED', message: '本机状态页不接受查询参数' })
      const status = options.getPanelStatus?.()
      if (!status) return sendJson(res, 503, { code: 'LOCAL_PANEL_UNAVAILABLE', message: '本机状态暂不可用' })
      res.writeHead(200, PANEL_HEADERS)
      return res.end(renderPanel(status))
    }

    // 看门狗没有 Origin：只在本机回环、只发一分钟一次性票，从不暴露终端凭证。
    if (req.method === 'POST' && url.pathname === '/local/terminal-boot-ticket') {
      if (origin && (!originAllowed(origin) || !staticTokenValid(req.headers['x-local-bridge-token'], bridgeToken))) {
        return sendJson(res, 403, { code: 'LOCAL_TERMINAL_BOOT_ORIGIN_FORBIDDEN', message: '终端启动票仅供本机启动器使用' }, originAllowed(origin) ? origin : undefined)
      }
      if (url.search.length > 0) return sendJson(res, 400, { code: 'LOCAL_TERMINAL_BOOT_QUERY_NOT_ALLOWED', message: '终端启动票不接受查询参数' })
      const now = Date.now()
      while (bootTicketRequests[0] !== undefined && bootTicketRequests[0] <= now - BOOT_TICKET_RATE_WINDOW_MS) bootTicketRequests.shift()
      if (bootTicketRequests.length >= BOOT_TICKET_RATE_LIMIT) {
        return sendJson(res, 429, { code: 'LOCAL_TERMINAL_BOOT_RATE_LIMITED', message: '终端启动票请求过于频繁，请稍后重试' }, origin)
      }
      bootTicketRequests.push(now)
      if (!credential.terminalId || !credential.terminalToken) {
        return sendJson(res, 503, { code: 'LOCAL_TERMINAL_BOOT_NOT_READY', message: '终端云端注册尚未就绪，请稍后重试' }, origin)
      }
      await assertEmptyBody(req)
      let ticket
      try {
        ticket = await api('POST', '/terminals/boot-ticket', undefined, { retries: 0, timeoutMs: 3_000 })
      } catch (err) {
        throw backendError(err, 'qr', true)
      }
      info('bridge.boot_ticket', '已为一体机页面换发一次性启动票')
      return sendEnvelope(res, 200, ticket, origin ?? '')
    }

    if (!originAllowed(origin)) {
      return sendJson(res, 403, isUsbRoute
        ? { code: 'LOCAL_USB_ORIGIN_FORBIDDEN', message: 'U 盘导入来源不被允许' }
        : isPrintRoute
          ? { code: 'LOCAL_PRINT_ORIGIN_FORBIDDEN', message: '本机打印唤醒来源不被允许' }
          : { code: 'LOCAL_QR_ORIGIN_FORBIDDEN', message: '扫码登录来源不被允许' })
    }

    if (req.method === 'OPTIONS') return sendEmpty(res, 204, origin)

    if (req.method === 'GET' && url.pathname === '/local/terminal-identity') {
      return sendEnvelope(res, 200, { terminalId: credential.terminalId?.trim() ?? '', terminalCode: String(credential.terminalCode ?? '').trim() }, origin)
    }

    if (url.pathname === '/local/bridge/session') {
      if (req.method !== 'POST') return sendJson(res, 405, { code: 'LOCAL_BRIDGE_METHOD_NOT_ALLOWED', message: '本机会话仅支持 POST' }, origin)
      if (url.search.length > 0) return sendJson(res, 400, { code: 'LOCAL_BRIDGE_QUERY_NOT_ALLOWED', message: '本机会话不接受查询参数' }, origin)
      await assertEmptyBody(req)
      return sendEnvelope(res, 200, sessions.issue(origin), origin)
    }

    if (url.pathname === '/local/print/wake') {
      if (!authorized(req, origin)) return sendJson(res, 403, { code: 'LOCAL_PRINT_BRIDGE_TOKEN_INVALID', message: '本机打印唤醒令牌校验失败' }, origin)
      if (req.method !== 'POST') return sendJson(res, 405, { code: 'LOCAL_PRINT_METHOD_NOT_ALLOWED', message: '本机打印唤醒仅支持 POST' }, origin)
      if (url.search.length > 0) return sendJson(res, 400, { code: 'LOCAL_PRINT_QUERY_NOT_ALLOWED', message: '本机打印唤醒不接受查询参数' }, origin)
      await assertEmptyBody(req)
      const result = options.wakePrintQueue?.()
      if (!result?.accepted) return sendJson(res, 503, { code: 'LOCAL_PRINT_WAKE_UNAVAILABLE', message: '本机打印任务调度暂不可用' }, origin)
      info('bridge.print_wake', `一体机唤醒领任务${result.coalesced ? '（与在途一轮合并）' : ''}`)
      return sendEnvelope(res, 202, { accepted: true, coalesced: result.coalesced }, origin)
    }

    if (isUsbRoute) {
      if (!authorized(req, origin)) return sendJson(res, 403, { code: 'LOCAL_USB_BRIDGE_TOKEN_INVALID', message: 'U 盘导入本地令牌校验失败' }, origin)
      if (req.method === 'GET' && url.pathname === '/local/usb/status') return sendEnvelope(res, 200, usb.status(), origin)
      if (req.method === 'GET' && url.pathname === '/local/usb/files') {
        const result = usb.refresh()
        info('bridge.usb_files', `U 盘文件列表刷新：${result.present ? `${result.files.length} 个文件` : '未插入'}`)
        return sendEnvelope(res, 200, result, origin)
      }
      if (req.method === 'POST' && url.pathname === '/local/usb/upload') return handleUsbUpload(req, res, origin)
      return sendJson(res, 404, { code: 'LOCAL_USB_NOT_FOUND', message: 'U 盘导入接口不存在' }, origin)
    }

    if (!authorized(req, origin)) return sendJson(res, 403, { code: 'LOCAL_QR_BRIDGE_TOKEN_INVALID', message: '扫码登录本地令牌校验失败' }, origin)

    const now = Date.now()
    for (const [id, stored] of claims) if (stored.expiresAt <= now) claims.delete(id)

    if (req.method === 'POST' && url.pathname === '/local/qr-login/create') {
      const body = await readJsonBody(req)
      let data
      try {
        data = await api('POST', '/member/auth/qr/create', {
          ...(body.deviceId ? { deviceId: body.deviceId } : {}),
          ...(body.deviceLabel ? { deviceLabel: body.deviceLabel } : {}),
          ...(body.returnTo ? { returnTo: body.returnTo } : {}),
        })
      } catch (err) {
        throw backendError(err)
      }
      claims.set(data.ticketId, { claimToken: data.claimToken, expiresAt: Date.now() + data.expiresInSeconds * 1000 + CLAIM_TOKEN_TTL_BUFFER_MS })
      info('bridge.qr_create', '已创建扫码登录票据')
      return sendEnvelope(res, 200, { ticketId: data.ticketId, qrUrl: data.qrUrl, expiresInSeconds: data.expiresInSeconds, returnTo: body.returnTo || '/' }, origin)
    }

    if (req.method === 'POST' && url.pathname === '/local/qr-login/claim') {
      const body = await readJsonBody(req)
      const ticketId = typeof body.ticketId === 'string' ? body.ticketId : ''
      if (!TICKET_ID_RE.test(ticketId)) return sendJson(res, 400, { code: 'LOCAL_QR_TICKET_INVALID', message: '二维码票据无效' }, origin)
      const stored = claims.get(ticketId)
      if (!stored) return sendJson(res, 410, { code: 'LOCAL_QR_CLAIM_MISSING', message: '二维码登录凭证已失效，请刷新二维码' }, origin)
      let data
      try {
        data = await api('POST', `/member/auth/qr/${encodeURIComponent(ticketId)}/claim`, { claimToken: stored.claimToken })
      } catch (err) {
        const mapped = backendError(err)
        if (mapped.status === 404 || mapped.status === 410 || mapped.status === 401) claims.delete(ticketId)
        throw mapped
      }
      claims.delete(ticketId)
      info('bridge.qr_claim', '扫码登录已领取会员身份')
      return sendEnvelope(res, 200, data, origin)
    }

    return sendJson(res, 404, { code: 'LOCAL_QR_NOT_FOUND', message: '本机扫码登录接口不存在' }, origin)
  }

  async function handleUsbUpload(req, res, origin) {
    const body = await readJsonBody(req, 'usb')
    const safeId = typeof body.safeId === 'string' ? body.safeId : ''
    if (!safeId) return sendJson(res, 400, { code: 'LOCAL_USB_SAFE_ID_REQUIRED', message: '缺少要导入的文件标识' }, origin)
    const purpose = body.purpose ?? 'print_doc'
    if (purpose !== 'print_doc' && purpose !== 'resume_upload') return sendJson(res, 400, { code: 'LOCAL_USB_PURPOSE_INVALID', message: 'U 盘文件用途不受支持' }, origin)
    const authorization = normalizeEndUserAuthorization(req.headers.authorization)
    if (req.headers.authorization && !authorization) return sendJson(res, 400, { code: 'LOCAL_USB_AUTHORIZATION_INVALID', message: '会员身份格式无效，请重新登录后再试' }, origin)
    const consumed = usb.consume(safeId)
    if (!consumed) return sendJson(res, 410, { code: 'LOCAL_USB_FILE_EXPIRED', message: '该文件已失效，请重新刷新 U 盘文件列表' }, origin)

    const form = new FormData()
    form.append('file', new Blob([consumed.buffer], { type: guessUsbMimeType(consumed.extension) }), consumed.filename)
    form.append('purpose', purpose)
    let uploaded
    try {
      // 上传不幂等、请求体只能发一次：与真实终端程序一样显式不重试（:388-396）。
      uploaded = await api('POST', '/files/kiosk-upload', undefined, {
        form,
        retries: 0,
        headers: purpose === 'resume_upload' && authorization ? { Authorization: authorization } : {},
      })
    } catch (err) {
      throw backendError(err, 'usb')
    }
    info('bridge.usb_upload', `U 盘文件已代传（用途 ${purpose}，${(consumed.buffer.length / 1024).toFixed(1)} KB）`, { purpose, fileId: uploaded.fileId })
    return sendEnvelope(res, 200, {
      fileId: uploaded.fileId,
      filename: uploaded.filename,
      sizeBytes: uploaded.sizeBytes,
      mimeType: uploaded.mimeType,
      sha256: uploaded.sha256,
      fileUrl: uploaded.signedUrl ?? null,
      fileUrlExpiresAt: uploaded.signedUrlExpiresAt ?? null,
    }, origin)
  }

  const server = http.createServer((req, res) => {
    const origin = req.headers.origin
    handle(req, res).catch((err) => {
      const path = req.url ?? ''
      const context = path.startsWith('/local/usb/') ? 'usb' : path.startsWith('/local/print/') ? 'print' : 'qr'
      const mapped = localExceptionFromUnknown(err, context)
      if (mapped.status >= 500) warn('bridge.error', `本机网桥请求出错：${mapped.status} ${mapped.error.code}${err instanceof LocalApiException ? '' : ` — ${errorText(err)}`}`)
      if (!res.headersSent) sendJson(res, mapped.status, mapped.error, originAllowed(origin) ? origin : undefined)
      else res.end()
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, '127.0.0.1', () => {
      server.off('error', reject)
      server.on('error', (err) => warn('bridge.server_error', `本机网桥出错：${errorText(err)}`))
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : options.port
      info('bridge.listen', `本机网桥已监听 http://127.0.0.1:${port}（允许来源：${origins.join(', ') || '无'}；静态令牌：${bridgeToken ? '已配置' : '未配置，只认短期会话'}）`)
      resolve({
        server,
        port,
        close: () => new Promise((done) => {
          server.closeAllConnections?.()
          server.close(() => done())
        }),
      })
    })
  })
}

