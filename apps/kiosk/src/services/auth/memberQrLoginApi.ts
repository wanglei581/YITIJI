import { API_BASE_URL } from '../api/client'
import { MemberApiError, type LoginResult } from './memberAuthApi'

const configuredLocalAgentBaseUrl = (import.meta.env['VITE_TERMINAL_AGENT_LOCAL_URL'] ?? '').trim()
const LOCAL_AGENT_BASE_URL = configuredLocalAgentBaseUrl || 'http://127.0.0.1:9527'
// 与 U 盘导入本地网桥共用同一个静态令牌:随 Kiosk 构建注入,须与本机 Terminal Agent 的
// localApiBridgeToken 配置一致,安装时一起下发。
const BRIDGE_TOKEN = (import.meta.env['VITE_TERMINAL_AGENT_BRIDGE_TOKEN'] ?? '').trim()

/** 本机程序没连上时扫码登录页上写的话：说清是哪一环，并指出不用扫码的路（手机号登录）。 */
export const LOCAL_AGENT_UNREACHABLE_MESSAGE = '这台机器的本机程序没连上，扫码登录暂时用不了，请改用手机号登录。'

function requireLocalAgentHeaders(): HeadersInit {
  if (!BRIDGE_TOKEN) {
    throw new MemberApiError(
      'LOCAL_QR_BRIDGE_TOKEN_MISSING',
      '这台机器还没配好扫码登录',
      0,
    )
  }
  return { 'X-Local-Bridge-Token': BRIDGE_TOKEN }
}

interface Envelope<T> {
  success: boolean
  data: T
}

export interface LocalQrCreateResult {
  ticketId: string
  qrUrl: string
  expiresInSeconds: number
  returnTo: string
}

export interface QrLoginStatusResult {
  status: 'pending' | 'confirmed'
  deviceLabel?: string
  returnTo: string
  expiresInSeconds: number
}

export interface ConfirmQrLoginResult {
  status: 'confirmed'
}

async function callEnvelope<T>(
  baseUrl: string,
  path: string,
  method: 'GET' | 'POST',
  body?: unknown,
  extraHeaders?: HeadersInit,
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...extraHeaders,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    // 连不上的是这台机器自己的本机程序（127.0.0.1）时，说法要和云上接口断开不同：那不是「网络」的事，
    // 让人去查网络没用（10/29 本机走查 I-32）。如实说本机程序没连上，并给不用扫码的出路。
    if (baseUrl === LOCAL_AGENT_BASE_URL) {
      throw new MemberApiError('LOCAL_AGENT_UNREACHABLE', LOCAL_AGENT_UNREACHABLE_MESSAGE, 0)
    }
    throw new MemberApiError('NETWORK_ERROR', '网络连接失败，请稍后重试', 0)
  }

  if (!res.ok) {
    let code = 'UNKNOWN_ERROR'
    let message = `请求失败（${res.status}）`
    try {
      const payload = (await res.json()) as { error?: { code?: string; message?: string } }
      code = payload.error?.code ?? code
      message = payload.error?.message ?? message
    } catch {
      /* keep default */
    }
    throw new MemberApiError(code, message, res.status)
  }

  const json = (await res.json()) as Envelope<T>
  return json.data
}

const qrCreatesInFlight = new Map<string, Promise<LocalQrCreateResult>>()

export function createQrLoginViaLocalAgent(input: {
  deviceId?: string
  deviceLabel?: string
  returnTo?: string
}): Promise<LocalQrCreateResult> {
  const key = JSON.stringify(input)
  const existing = qrCreatesInFlight.get(key)
  if (existing) return existing
  const request = callEnvelope<LocalQrCreateResult>(
    LOCAL_AGENT_BASE_URL,
    '/local/qr-login/create',
    'POST',
    input,
    requireLocalAgentHeaders(),
  ).finally(() => {
    if (qrCreatesInFlight.get(key) === request) qrCreatesInFlight.delete(key)
  })
  qrCreatesInFlight.set(key, request)
  return request
}

export function claimQrLoginViaLocalAgent(ticketId: string): Promise<LoginResult> {
  return callEnvelope<LoginResult>(
    LOCAL_AGENT_BASE_URL,
    '/local/qr-login/claim',
    'POST',
    { ticketId },
    requireLocalAgentHeaders(),
  )
}

export function fetchQrLoginStatus(ticketId: string): Promise<QrLoginStatusResult> {
  return callEnvelope<QrLoginStatusResult>(
    API_BASE_URL,
    `/member/auth/qr/${encodeURIComponent(ticketId)}/status`,
    'GET',
  )
}

export function confirmQrLogin(
  ticketId: string,
  phone: string,
  code: string,
  deviceId?: string,
): Promise<ConfirmQrLoginResult> {
  return callEnvelope<ConfirmQrLoginResult>(
    API_BASE_URL,
    `/member/auth/qr/${encodeURIComponent(ticketId)}/confirm`,
    'POST',
    deviceId ? { phone, code, deviceId } : { phone, code },
  )
}

/** 一体机登录票据格式：服务端 randomBytes(24) 的 base64url 为 32 位，这里留出余量；手机码路径只认这个字符集。 */
const QR_LOGIN_TICKET_PATTERN = /^[A-Za-z0-9_-]{32,96}$/

export function isQrLoginTicketId(value: unknown): value is string {
  return typeof value === 'string' && QR_LOGIN_TICKET_PATTERN.test(value)
}

/**
 * 一体机屏上扫码登录码的地址。
 * qrUrl 里取得到合格票据：`<公网基址>/k/l/<票据>`。微信「扫普通链接二维码打开小程序」规则生效时扫码直接进小程序；
 * 没生效或用别的软件扫，打开网页中转页 /k/l/:ticketId，再转到 /member/qr-login?ticketId=…。
 * 取不到合格票据：照旧把 qrUrl 落到公网基址上。
 */
export function buildQrLoginUrl(qrUrl: string): string {
  const configured = (import.meta.env['VITE_QR_LOGIN_PUBLIC_BASE_URL'] ?? '').trim()
  const base = parseQrLoginPublicBase(configured)
  const candidate = new URL(qrUrl, base)
  const ticketId = candidate.searchParams.get('ticketId')
  if (isQrLoginTicketId(ticketId)) return new URL(`/k/l/${ticketId}`, base).toString()
  if (candidate.origin === base.origin) return candidate.toString()
  return new URL(`${candidate.pathname}${candidate.search}${candidate.hash}`, base).toString()
}

function parseQrLoginPublicBase(configured: string): URL {
  try {
    return new URL(configured || window.location.origin)
  } catch {
    console.warn('[member-qr-login] VITE_QR_LOGIN_PUBLIC_BASE_URL 无效，已回退到当前页面地址')
    return new URL(window.location.origin)
  }
}
