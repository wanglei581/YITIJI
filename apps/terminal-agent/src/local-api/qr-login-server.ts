import http, { IncomingMessage, ServerResponse } from 'http'
import { URL } from 'url'
import axios from 'axios'
import type { AgentConfig } from '../agent/types'
import { createApiClient } from '../agent/api-client'
import { log, warn } from '../logger'
import { allowedOrigins, isOriginAllowed } from './origin-guard'
import type { LocalApiError, LocalQrClaimRequest, LocalQrCreateRequest } from './types'
import type { ApiEnvelope, ApiErrorEnvelope, BackendQrClaimResult, BackendQrCreateResult } from './wire'

const DEFAULT_LOCAL_API_PORT = 9527
const LOCAL_HOST = '127.0.0.1'
const CLAIM_TOKEN_TTL_BUFFER_MS = 5_000
const MAX_BODY_BYTES = 8 * 1024
const TICKET_ID_RE = /^[A-Za-z0-9_-]{32,96}$/

interface StoredClaim {
  claimToken: string
  expiresAt: number
}

export interface LocalQrServerHandle {
  server: http.Server
  port: number
  close: () => Promise<void>
}

export function startQrLoginLocalServer(config: AgentConfig): LocalQrServerHandle | null {
  if (!config.terminalId || !config.agentToken) {
    warn('local-qr: terminal credentials missing; QR local bridge disabled')
    return null
  }

  const localApiPort = normalizePort(config.localApiPort)
  const origins = allowedOrigins(config.localApiAllowedOrigins)
  if (origins.length === 0) {
    warn('local-qr: no allowed origins configured; browser requests will be rejected')
  }
  const claims = new Map<string, StoredClaim>()
  const client = createApiClient(config.apiBaseUrl, config.agentToken, config.terminalId)

  const server = http.createServer((req, res) => {
    const origin = req.headers.origin
    void handleRequest({ req, res, origins, claims, client }).catch((error) => {
      const mapped = localExceptionFromUnknown(error)
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
  client: ReturnType<typeof createApiClient>
}): Promise<void> {
  const { req, res, origins, claims, client } = input
  const origin = req.headers.origin

  if (!isOriginAllowed(origin, origins)) {
    sendJson(res, 403, { code: 'LOCAL_QR_ORIGIN_FORBIDDEN', message: '扫码登录来源不被允许' })
    return
  }

  if (req.method === 'OPTIONS') {
    sendEmpty(res, 204, origin)
    return
  }

  const url = new URL(req.url ?? '/', `http://${LOCAL_HOST}`)
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

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  let bytes = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > MAX_BODY_BYTES) {
      throw { status: 413, error: { code: 'LOCAL_QR_BODY_TOO_LARGE', message: '请求体过大' } } satisfies LocalApiException
    }
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {} as T
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as unknown
  } catch {
    throw { status: 400, error: { code: 'LOCAL_QR_BAD_JSON', message: '请求 JSON 格式无效' } } satisfies LocalApiException
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw { status: 400, error: { code: 'LOCAL_QR_BAD_JSON', message: '请求 JSON 必须是对象' } } satisfies LocalApiException
  }
  return parsed as T
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

function backendError(error: unknown): LocalApiException {
  if (axios.isAxiosError<ApiErrorEnvelope>(error)) {
    const status = error.response?.status ?? 502
    const code = error.response?.data?.error?.code ?? 'LOCAL_QR_BACKEND_ERROR'
    const message = error.response?.data?.error?.message ?? '扫码登录后端请求失败'
    return { status, error: { code, message } }
  }
  return { status: 502, error: { code: 'LOCAL_QR_BACKEND_ERROR', message: '扫码登录后端请求失败' } }
}

function localExceptionFromUnknown(error: unknown): LocalApiException {
  if (isLocalApiException(error)) return error
  return { status: 500, error: { code: 'LOCAL_QR_INTERNAL_ERROR', message: '本机扫码登录服务异常' } }
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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
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
