import { API_BASE_URL } from '../api/client'
import { fetchProtectedLocalAgent } from '../localAgentBridge'
import { MemberApiError, type LoginResult } from './memberAuthApi'

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

async function callLocalEnvelope<T>(path: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetchProtectedLocalAgent(path, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new MemberApiError('NETWORK_ERROR', '本机扫码登录服务未连接', 0)
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

  return ((await res.json()) as Envelope<T>).data
}

export function createQrLoginViaLocalAgent(input: {
  deviceId?: string
  deviceLabel?: string
  returnTo?: string
}): Promise<LocalQrCreateResult> {
  return callLocalEnvelope<LocalQrCreateResult>('/local/qr-login/create', input)
}

export function claimQrLoginViaLocalAgent(ticketId: string): Promise<LoginResult> {
  return callLocalEnvelope<LoginResult>('/local/qr-login/claim', { ticketId })
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

export function buildQrLoginUrl(qrUrl: string): string {
  const configured = (import.meta.env['VITE_QR_LOGIN_PUBLIC_BASE_URL'] ?? '').trim()
  const base = parseQrLoginPublicBase(configured)
  const candidate = new URL(qrUrl, base)
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
