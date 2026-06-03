// ============================================================
// C 端账号 API（阶段 A）
//
// 调用真实后端 /api/v1/member/*。账号体系无 mock 适配器——登录始终走真实后端。
// token 通过 Authorization: Bearer 透传；手机号明文不落前端，响应只含 phoneMasked。
// ============================================================

import { API_BASE_URL } from '../api/client'
import { getDeviceId, getMemberToken } from './memberSession'

export class MemberApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'MemberApiError'
  }
}

export interface MemberUser {
  id: string
  phoneMasked: string
  nickname: string | null
}

interface Envelope<T> {
  success: boolean
  data: T
}

async function call<T>(
  path: string,
  method: 'GET' | 'POST',
  options: { body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.auth) {
    const token = getMemberToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
  }

  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    })
  } catch {
    throw new MemberApiError('NETWORK_ERROR', '网络连接失败，请检查网络后重试', 0)
  }

  if (!res.ok) {
    let code = 'UNKNOWN_ERROR'
    let message = `请求失败（${res.status}）`
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      code = body.error?.code ?? code
      message = body.error?.message ?? message
    } catch {
      /* 非 JSON 响应：保留默认 */
    }
    throw new MemberApiError(code, message, res.status)
  }

  const json = (await res.json()) as Envelope<T>
  return json.data
}

export interface SendCodeResult {
  sent: true
  cooldownSeconds: number
  expiresInSeconds: number
}

export function sendSmsCode(phone: string): Promise<SendCodeResult> {
  return call<SendCodeResult>('/member/auth/sms-code', 'POST', {
    body: { phone, deviceId: getDeviceId() },
  })
}

export interface LoginResult {
  token: string
  user: MemberUser
}

export function memberLogin(phone: string, code: string): Promise<LoginResult> {
  return call<LoginResult>('/member/auth/login', 'POST', {
    body: { phone, code, deviceId: getDeviceId() },
  })
}

export function memberLogout(): Promise<{ loggedOut: true }> {
  return call<{ loggedOut: true }>('/member/auth/logout', 'POST', { auth: true })
}

export function fetchMemberMe(): Promise<MemberUser> {
  return call<MemberUser>('/member/me', 'GET', { auth: true })
}
