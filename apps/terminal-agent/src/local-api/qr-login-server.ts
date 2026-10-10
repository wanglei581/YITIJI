import http, { IncomingMessage, ServerResponse } from 'http'
import { URL } from 'url'
import axios from 'axios'
import FormData from 'form-data'
import type { AgentConfig } from '../agent/types'
import { createApiClient, NO_RETRY_CONFIG } from '../agent/api-client'
import { log, warn } from '../logger'
import { consumeUsbFileOutcome, getUsbStatus, refreshUsbFileList } from '../usb/usb-files'
import { decideUsbImport } from '../usb/usb-capability'
import { allowedOrigins, isLocalBridgeTokenValid, isOriginAllowed } from './origin-guard'
import type {
  LocalApiError,
  LocalAgentPanelStatus,
  LocalPrintWakeResponse,
  LocalQrClaimRequest,
  LocalQrCreateRequest,
  LocalTerminalIdentityResponse,
  LocalTerminalBootTicketResponse,
  LocalUsbFileItem,
  LocalUsbListResponse,
  LocalUsbStatusResponse,
  LocalUsbUploadRequest,
  LocalUsbUploadResponse,
} from './types'
import { sendLocalAgentStatusPanel } from './status-panel'
import type {
  ApiEnvelope,
  ApiErrorEnvelope,
  BackendKioskUploadResult,
  BackendQrClaimResult,
  BackendQrCreateResult,
} from './wire'
import { createLocalBridgeSessionStore, type LocalBridgeSessionStore } from './bridge-session'

const DEFAULT_LOCAL_API_PORT = 9527
const LOCAL_HOST = '127.0.0.1'
const CLAIM_TOKEN_TTL_BUFFER_MS = 5_000
const MAX_BODY_BYTES = 8 * 1024
const TICKET_ID_RE = /^[A-Za-z0-9_-]{32,96}$/
const BOOT_TICKET_RATE_WINDOW_MS = 60_000
const BOOT_TICKET_RATE_LIMIT = 6

interface StoredClaim {
  claimToken: string
  expiresAt: number
}

export interface LocalQrServerHandle {
  server: http.Server
  port: number
  close: () => Promise<void>
}

export interface LocalQrServerOptions {
  wakePrintQueue?: () => { accepted: boolean; coalesced: boolean }
  getPanelStatus?: () => LocalAgentPanelStatus
}

export function startQrLoginLocalServer(
  config: AgentConfig,
  options: LocalQrServerOptions = {},
): LocalQrServerHandle | null {
  if (!config.terminalId || !config.agentToken) {
    warn('local-qr: terminal credentials not ready; local identity stays available and cloud routes return retryable 503')
  }

  const localApiPort = normalizePort(config.localApiPort)
  const origins = allowedOrigins(config.localApiAllowedOrigins)
  if (origins.length === 0) {
    warn('local-qr: no allowed origins configured; browser requests will be rejected')
  }
  const claims = new Map<string, StoredClaim>()
  const bootTicketRequests: number[] = []
  const bridgeSessions = createLocalBridgeSessionStore()
  // The server starts before cloud registration completes, so credentials can
  // arrive later. Build the client from the current config instead of patching
  // headers in an interceptor: a per-request override (the USB resume upload
  // swaps in the member token) must never be overwritten by the Agent token.
  let cachedClient: { key: string; client: ReturnType<typeof createApiClient> } | null = null
  const currentClient = (): ReturnType<typeof createApiClient> => {
    const key = `${config.agentToken ?? ''}\u0000${config.terminalId ?? ''}`
    if (!cachedClient || cachedClient.key !== key) {
      cachedClient = { key, client: createApiClient(config.apiBaseUrl, config.agentToken, config.terminalId) }
    }
    return cachedClient.client
  }
  const bridgeToken = config.localApiBridgeToken?.trim() || undefined
  if (!bridgeToken) log('local-qr: static bridge token not configured; using short-lived local browser sessions')

  const server = http.createServer((req, res) => {
    const origin = req.headers.origin
    void handleRequest({ req, res, origins, claims, bootTicketRequests, client: currentClient(), bridgeToken, bridgeSessions, config, options }).catch((error) => {
      const isUsbRoute = (req.url ?? '').startsWith('/local/usb/')
      const isPrintRoute = (req.url ?? '').startsWith('/local/print/')
      const context = isUsbRoute ? 'usb' : isPrintRoute ? 'print' : 'qr'
      const mapped = localExceptionFromUnknown(error, context)
      if (mapped.status >= 500) warn(`local-qr: unexpected request error — ${safeErrorMessage(error)}`)
      sendJson(
        res,
        mapped.status,
        mapped.error,
        isOriginAllowed(origin, origins) ? origin : undefined,
      )
    })
  })

  server.on('error', (error) => {
    warn(`local-qr: server error — ${safeErrorMessage(error)}`)
  })

  server.listen(localApiPort, LOCAL_HOST, () => {
    const address = server.address()
    const actualPort = typeof address === 'object' && address ? address.port : localApiPort
    log(`local-qr: listening on http://${LOCAL_HOST}:${actualPort}`)
  })

  return {
    server,
    get port() {
      const address = server.address()
      return typeof address === 'object' && address ? address.port : localApiPort
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

async function handleRequest(input: {
  req: IncomingMessage
  res: ServerResponse
  origins: string[]
  claims: Map<string, StoredClaim>
  bootTicketRequests: number[]
  client: ReturnType<typeof createApiClient>
  bridgeToken: string | undefined
  bridgeSessions: LocalBridgeSessionStore
  config: AgentConfig
  options: LocalQrServerOptions
}): Promise<void> {
  const { req, res, origins, claims, bootTicketRequests, client, bridgeToken, bridgeSessions, config, options } = input
  const origin = req.headers.origin
  const url = new URL(req.url ?? '/', `http://${LOCAL_HOST}`)
  const isUsbRoute = url.pathname.startsWith('/local/usb/')
  const isPrintRoute = url.pathname.startsWith('/local/print/')

  if (url.pathname === '/local/panel') {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      sendJson(res, 405, { code: 'LOCAL_PANEL_METHOD_NOT_ALLOWED', message: '本机状态页仅支持读取' })
      return
    }
    if (url.search.length > 0) {
      sendJson(res, 400, { code: 'LOCAL_PANEL_QUERY_NOT_ALLOWED', message: '本机状态页不接受查询参数' })
      return
    }
    const status = options.getPanelStatus?.()
    if (!status) {
      sendJson(res, 503, { code: 'LOCAL_PANEL_UNAVAILABLE', message: '本机状态暂不可用' })
      return
    }
    sendLocalAgentStatusPanel(res, status)
    return
  }

  // The watchdog has no browser Origin. The server is loopback-only and returns
  // a one-minute, one-time ticket instead of ever exposing an Agent credential.
  if (req.method === 'POST' && url.pathname === '/local/terminal-boot-ticket') {
    if (origin && (!isOriginAllowed(origin, origins) || !isLocalBridgeTokenValid(req.headers['x-local-bridge-token'], bridgeToken))) {
      sendJson(res, 403, { code: 'LOCAL_TERMINAL_BOOT_ORIGIN_FORBIDDEN', message: '终端启动票仅供本机启动器使用' }, isOriginAllowed(origin, origins) ? origin : undefined)
      return
    }
    if (url.search.length > 0) {
      sendJson(res, 400, { code: 'LOCAL_TERMINAL_BOOT_QUERY_NOT_ALLOWED', message: '终端启动票不接受查询参数' })
      return
    }
    const now = Date.now()
    while (bootTicketRequests[0] !== undefined && bootTicketRequests[0] <= now - BOOT_TICKET_RATE_WINDOW_MS) bootTicketRequests.shift()
    if (bootTicketRequests.length >= BOOT_TICKET_RATE_LIMIT) {
      sendJson(res, 429, { code: 'LOCAL_TERMINAL_BOOT_RATE_LIMITED', message: '终端启动票请求过于频繁，请稍后重试' }, origin)
      return
    }
    bootTicketRequests.push(now)
    if (!config.terminalId || !config.agentToken) {
      sendJson(res, 503, { code: 'LOCAL_TERMINAL_BOOT_NOT_READY', message: '终端云端注册尚未就绪，请稍后重试' }, origin)
      return
    }
    await assertEmptyBody(req)
    // 只请求一次：两个调用方（看门狗、页面）都是 4 秒超时并自带重试，这里再重试只会在它们放弃后白白换票。
    // 云端没就绪时回 503 可重试码，调用方据此稍后再来。
    const response = await client.post<ApiEnvelope<LocalTerminalBootTicketResponse> | LocalTerminalBootTicketResponse>('/terminals/boot-ticket', undefined, {
      ...NO_RETRY_CONFIG,
      timeout: 3_000,
    })
      .catch((error) => { throw backendError(error, 'qr', true) })
    const payload = response.data
    const ticket = 'data' in payload ? payload.data : payload
    sendEnvelope(res, 200, ticket, origin ?? '')
    return
  }

  if (!isOriginAllowed(origin, origins)) {
    sendJson(
      res,
      403,
      isUsbRoute
        ? { code: 'LOCAL_USB_ORIGIN_FORBIDDEN', message: 'U 盘导入来源不被允许' }
        : isPrintRoute
          ? { code: 'LOCAL_PRINT_ORIGIN_FORBIDDEN', message: '本机打印唤醒来源不被允许' }
        : { code: 'LOCAL_QR_ORIGIN_FORBIDDEN', message: '扫码登录来源不被允许' },
    )
    return
  }

  if (req.method === 'OPTIONS') {
    sendEmpty(res, 204, origin)
    return
  }

  if (req.method === 'GET' && url.pathname === '/local/terminal-identity') {
    const identity: LocalTerminalIdentityResponse = {
      terminalId: config.terminalId?.trim() ?? '',
      terminalCode: config.terminalCode.trim(),
    }
    sendEnvelope(res, 200, identity, origin)
    return
  }

  if (url.pathname === '/local/bridge/session') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { code: 'LOCAL_BRIDGE_METHOD_NOT_ALLOWED', message: '本机会话仅支持 POST' }, origin)
      return
    }
    if (url.search.length > 0) {
      sendJson(res, 400, { code: 'LOCAL_BRIDGE_QUERY_NOT_ALLOWED', message: '本机会话不接受查询参数' }, origin)
      return
    }
    await assertEmptyBody(req)
    sendEnvelope(res, 200, bridgeSessions.issue(origin), origin)
    return
  }

  if (url.pathname === '/local/print/wake') {
    await handlePrintWake(req, res, origin, url, bridgeToken, bridgeSessions, options.wakePrintQueue)
    return
  }

  if (isUsbRoute) {
    await handleUsbRoute(req, res, origin, url, client, bridgeToken, bridgeSessions, config)
    return
  }

  if (
    !isLocalBridgeTokenValid(req.headers['x-local-bridge-token'], bridgeToken) &&
    !bridgeSessions.validate(req.headers['x-local-bridge-token'], origin)
  ) {
    sendJson(res, 403, { code: 'LOCAL_QR_BRIDGE_TOKEN_INVALID', message: '扫码登录本地令牌校验失败' }, origin)
    return
  }

  cleanupExpiredClaims(claims)

  if (req.method === 'POST' && url.pathname === '/local/qr-login/create') {
    await handleCreate(req, res, origin, claims, client)
    return
  }

  if (req.method === 'POST' && url.pathname === '/local/qr-login/claim') {
    await handleClaim(req, res, origin, claims, client)
    return
  }

  sendJson(res, 404, { code: 'LOCAL_QR_NOT_FOUND', message: '本机扫码登录接口不存在' }, origin)
}

async function handlePrintWake(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string,
  url: URL,
  bridgeToken: string | undefined,
  bridgeSessions: LocalBridgeSessionStore,
  wakePrintQueue: LocalQrServerOptions['wakePrintQueue'],
): Promise<void> {
  if (
    !isLocalBridgeTokenValid(req.headers['x-local-bridge-token'], bridgeToken) &&
    !bridgeSessions.validate(req.headers['x-local-bridge-token'], origin)
  ) {
    sendJson(res, 403, { code: 'LOCAL_PRINT_BRIDGE_TOKEN_INVALID', message: '本机打印唤醒令牌校验失败' }, origin)
    return
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { code: 'LOCAL_PRINT_METHOD_NOT_ALLOWED', message: '本机打印唤醒仅支持 POST' }, origin)
    return
  }
  if (url.search.length > 0) {
    sendJson(res, 400, { code: 'LOCAL_PRINT_QUERY_NOT_ALLOWED', message: '本机打印唤醒不接受查询参数' }, origin)
    return
  }

  await assertEmptyBody(req)
  const result = wakePrintQueue?.()
  if (!result?.accepted) {
    sendJson(res, 503, { code: 'LOCAL_PRINT_WAKE_UNAVAILABLE', message: '本机打印任务调度暂不可用' }, origin)
    return
  }

  const response: LocalPrintWakeResponse = { accepted: true, coalesced: result.coalesced }
  sendEnvelope(res, 202, response, origin)
}

// ── U 盘导入路由（Task 9） ───────────────────────────────────────────────────

async function handleUsbRoute(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string,
  url: URL,
  client: ReturnType<typeof createApiClient>,
  bridgeToken: string | undefined,
  bridgeSessions: LocalBridgeSessionStore,
  config: AgentConfig,
): Promise<void> {
  if (
    !isLocalBridgeTokenValid(req.headers['x-local-bridge-token'], bridgeToken) &&
    !bridgeSessions.validate(req.headers['x-local-bridge-token'], origin)
  ) {
    sendJson(res, 403, { code: 'LOCAL_USB_BRIDGE_TOKEN_INVALID', message: 'U 盘导入本地令牌校验失败' }, origin)
    return
  }

  if (req.method === 'GET' && url.pathname === '/local/usb/status') {
    const status: LocalUsbStatusResponse = await getUsbStatus()
    sendEnvelope(res, 200, status, origin)
    return
  }

  if (req.method === 'GET' && url.pathname === '/local/usb/files') {
    if (await usbImportClosedResponse(config, res, origin)) return
    const result = await refreshUsbFileList()
    const files: LocalUsbFileItem[] = result.files
    const response: LocalUsbListResponse = { present: result.present, driveLabel: result.driveLabel, readable: result.readable, files }
    sendEnvelope(res, 200, response, origin)
    return
  }

  if (req.method === 'POST' && url.pathname === '/local/usb/upload') {
    await handleUsbUpload(req, res, origin, client, config)
    return
  }

  sendJson(res, 404, { code: 'LOCAL_USB_NOT_FOUND', message: 'U 盘导入接口不存在' }, origin)
}

async function handleUsbUpload(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string,
  client: ReturnType<typeof createApiClient>,
  config: AgentConfig,
): Promise<void> {
  const body = await readJsonBody<LocalUsbUploadRequest>(req, 'usb')
  const safeId = typeof body.safeId === 'string' ? body.safeId : ''
  if (!safeId) {
    sendJson(res, 400, { code: 'LOCAL_USB_SAFE_ID_REQUIRED', message: '缺少要导入的文件标识' }, origin)
    return
  }
  const purpose = body.purpose ?? 'print_doc'
  if (purpose !== 'print_doc' && purpose !== 'resume_upload') {
    sendJson(res, 400, { code: 'LOCAL_USB_PURPOSE_INVALID', message: 'U 盘文件用途不受支持' }, origin)
    return
  }
  const authorization = normalizeEndUserAuthorization(req.headers.authorization)
  if (req.headers.authorization && !authorization) {
    sendJson(res, 400, { code: 'LOCAL_USB_AUTHORIZATION_INVALID', message: '会员身份格式无效，请重新登录后再试' }, origin)
    return
  }

  // 必须在 consumeUsbFileOutcome 之前：被拦时不消耗 safeId、不读文件、不转发。
  if (await usbImportClosedResponse(config, res, origin)) return

  const outcome = consumeUsbFileOutcome(safeId)
  if (!outcome.ok) {
    if (outcome.reason === 'unreadable') {
      // 读的那一下失败（Defender 拦截、已被隔离、被替换）。重试同一个文件不会成功，只能换一个。
      sendJson(res, 422, { code: 'LOCAL_USB_FILE_UNREADABLE', message: '这个文件读不了，请换一个文件' }, origin)
      return
    }
    sendJson(res, 410, { code: 'LOCAL_USB_FILE_EXPIRED', message: '该文件已失效，请重新刷新 U 盘文件列表' }, origin)
    return
  }
  const consumed = outcome.file

  const form = new FormData()
  form.append('file', consumed.buffer, {
    filename: consumed.filename,
    contentType: guessUsbMimeType(consumed.extension),
  })
  form.append('purpose', purpose)

  let uploaded: BackendKioskUploadResult
  try {
    // form-data 流一次发送后即被消费,自动重试会提交空体;上传也非幂等
    // (响应丢失时重试会重复落文件),所以这里显式禁用 api-client 的自动重试。
    const response = await client.post<ApiEnvelope<BackendKioskUploadResult>>('/files/kiosk-upload', form, {
      headers: {
        ...form.getHeaders(),
        ...(purpose === 'resume_upload' && authorization ? { Authorization: authorization } : {}),
      },
      ...NO_RETRY_CONFIG,
    })
    uploaded = response.data.data
  } catch (error) {
    throw backendError(error, 'usb')
  }

  const result: LocalUsbUploadResponse = {
    fileId: uploaded.fileId,
    filename: uploaded.filename,
    sizeBytes: uploaded.sizeBytes,
    mimeType: uploaded.mimeType,
    sha256: uploaded.sha256,
    fileUrl: uploaded.signedUrl ?? null,
    fileUrlExpiresAt: uploaded.signedUrlExpiresAt ?? null,
  }
  sendEnvelope(res, 200, result, origin)
}

/** 能力开关关着或查不到时写响应并返回 true。/local/usb/status 不走这里。 */
async function usbImportClosedResponse(config: AgentConfig, res: ServerResponse, origin: string): Promise<boolean> {
  const decision = await decideUsbImport({
    apiBaseUrl: config.apiBaseUrl,
    terminalId: config.terminalId,
  })
  if (decision.allowed) return false
  sendJson(res, decision.httpStatus, { code: decision.code, message: decision.message }, origin)
  return true
}

function guessUsbMimeType(extension: string): string {
  switch (extension) {
    case '.pdf':
      return 'application/pdf'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    default:
      return 'application/octet-stream'
  }
}

function normalizeEndUserAuthorization(value: string | string[] | undefined): string | undefined {
  const authorization = Array.isArray(value) ? value[0] : value
  if (!authorization || authorization.length > 8 * 1024) return undefined
  return /^Bearer\s+[^\s]+$/i.test(authorization) ? authorization : undefined
}

async function handleCreate(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string,
  claims: Map<string, StoredClaim>,
  client: ReturnType<typeof createApiClient>,
): Promise<void> {
  const body = await readJsonBody<LocalQrCreateRequest>(req)
  const response = await client.post<ApiEnvelope<BackendQrCreateResult>>('/member/auth/qr/create', {
    ...(body.deviceId ? { deviceId: body.deviceId } : {}),
    ...(body.deviceLabel ? { deviceLabel: body.deviceLabel } : {}),
    ...(body.returnTo ? { returnTo: body.returnTo } : {}),
  }).catch((error) => {
    throw backendError(error)
  })

  const data = response.data.data
  claims.set(data.ticketId, {
    claimToken: data.claimToken,
    expiresAt: Date.now() + data.expiresInSeconds * 1000 + CLAIM_TOKEN_TTL_BUFFER_MS,
  })

  sendEnvelope(res, 200, {
    ticketId: data.ticketId,
    qrUrl: data.qrUrl,
    expiresInSeconds: data.expiresInSeconds,
    returnTo: body.returnTo || '/',
  }, origin)
}

async function handleClaim(
  req: IncomingMessage,
  res: ServerResponse,
  origin: string,
  claims: Map<string, StoredClaim>,
  client: ReturnType<typeof createApiClient>,
): Promise<void> {
  const body = await readJsonBody<LocalQrClaimRequest>(req)
  const ticketId = typeof body.ticketId === 'string' ? body.ticketId : ''
  if (!TICKET_ID_RE.test(ticketId)) {
    sendJson(res, 400, { code: 'LOCAL_QR_TICKET_INVALID', message: '二维码票据无效' }, origin)
    return
  }

  const stored = claims.get(ticketId)
  if (!stored) {
    sendJson(res, 410, { code: 'LOCAL_QR_CLAIM_MISSING', message: '二维码登录凭证已失效，请刷新二维码' }, origin)
    return
  }

  const response = await client.post<ApiEnvelope<BackendQrClaimResult>>(
    `/member/auth/qr/${encodeURIComponent(ticketId)}/claim`,
    { claimToken: stored.claimToken },
  ).catch((error) => {
    const mapped = backendError(error)
    if (mapped.status === 404 || mapped.status === 410 || mapped.status === 401) claims.delete(ticketId)
    throw mapped
  })

  claims.delete(ticketId)
  sendEnvelope(res, 200, response.data.data, origin)
}

async function readJsonBody<T>(req: IncomingMessage, context: 'qr' | 'usb' = 'qr'): Promise<T> {
  const prefix = context === 'usb' ? 'LOCAL_USB' : 'LOCAL_QR'
  let bytes = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > MAX_BODY_BYTES) {
      throw { status: 413, error: { code: `${prefix}_BODY_TOO_LARGE`, message: '请求体过大' } } satisfies LocalApiException
    }
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {} as T
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as unknown
  } catch {
    throw { status: 400, error: { code: `${prefix}_BAD_JSON`, message: '请求 JSON 格式无效' } } satisfies LocalApiException
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw { status: 400, error: { code: `${prefix}_BAD_JSON`, message: '请求 JSON 必须是对象' } } satisfies LocalApiException
  }
  return parsed as T
}

async function assertEmptyBody(req: IncomingMessage): Promise<void> {
  let bytes = 0
  for await (const chunk of req) {
    bytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk))
    if (bytes > MAX_BODY_BYTES) {
      throw { status: 413, error: { code: 'LOCAL_PRINT_BODY_TOO_LARGE', message: '请求体过大' } } satisfies LocalApiException
    }
  }
  if (bytes > 0) {
    throw { status: 400, error: { code: 'LOCAL_PRINT_BODY_NOT_ALLOWED', message: '本机打印唤醒不接受请求体' } } satisfies LocalApiException
  }
}

function cleanupExpiredClaims(claims: Map<string, StoredClaim>): void {
  const now = Date.now()
  for (const [ticketId, stored] of claims) {
    if (stored.expiresAt <= now) claims.delete(ticketId)
  }
}

interface LocalApiException {
  status: number
  error: LocalApiError
}

function backendError(error: unknown, context: 'qr' | 'usb' = 'qr', retryable = false): LocalApiException {
  const fallbackCode = context === 'usb' ? 'LOCAL_USB_BACKEND_ERROR' : 'LOCAL_QR_BACKEND_ERROR'
  const fallbackMessage = context === 'usb' ? 'U 盘文件上传后端请求失败' : '扫码登录后端请求失败'
  if (axios.isAxiosError<ApiErrorEnvelope>(error)) {
    const status = error.response?.status ?? 502
    const code = error.response?.data?.error?.code ?? fallbackCode
    const message = error.response?.data?.error?.message ?? fallbackMessage
    return { status: retryable ? 503 : status, error: { code: retryable ? 'LOCAL_TERMINAL_BOOT_RETRYABLE' : code, message } }
  }
  return { status: retryable ? 503 : 502, error: { code: retryable ? 'LOCAL_TERMINAL_BOOT_RETRYABLE' : fallbackCode, message: retryable ? '云端暂不可用，请稍后重试' : fallbackMessage } }
}

function localExceptionFromUnknown(error: unknown, context: 'qr' | 'usb' | 'print' = 'qr'): LocalApiException {
  if (isLocalApiException(error)) return error
  if (context === 'print') {
    return { status: 500, error: { code: 'LOCAL_PRINT_INTERNAL_ERROR', message: '本机打印唤醒服务异常' } }
  }
  return context === 'usb'
    ? { status: 500, error: { code: 'LOCAL_USB_INTERNAL_ERROR', message: 'U 盘导入本地服务异常' } }
    : { status: 500, error: { code: 'LOCAL_QR_INTERNAL_ERROR', message: '本机扫码登录服务异常' } }
}

function isLocalApiException(error: unknown): error is LocalApiException {
  if (!error || typeof error !== 'object') return false
  const candidate = error as LocalApiException
  return typeof candidate.status === 'number' && typeof candidate.error?.code === 'string'
}

function sendEnvelope<T>(res: ServerResponse, status: number, data: T, origin: string): void {
  writeCorsHeaders(res, origin)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ success: true, data }))
}

function sendJson(res: ServerResponse, status: number, error: LocalApiError, origin?: string): void {
  if (origin) writeCorsHeaders(res, origin)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ success: false, error }))
}

function sendEmpty(res: ServerResponse, status: number, origin: string): void {
  writeCorsHeaders(res, origin)
  res.writeHead(status)
  res.end()
}

function writeCorsHeaders(res: ServerResponse, origin: string): void {
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Local-Bridge-Token')
  res.setHeader('Access-Control-Allow-Private-Network', 'true')
  res.setHeader('Access-Control-Max-Age', '300')
  res.setHeader('Vary', 'Origin')
}

function normalizePort(port: number | undefined): number {
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 0 || port > 65535) return DEFAULT_LOCAL_API_PORT
  return port
}

function safeErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error && 'error' in error) {
    const local = error as LocalApiException
    return `${local.status} ${local.error.code}`
  }
  if (error instanceof Error) return error.message
  return String(error)
}
