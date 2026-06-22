// ============================================================
// C 端求职者账号 API（L2-4A）
//
// 调用真实后端 /api/v1/member/*。
// - token 通过函数参数显式传入，不从任何存储读取。
// - 不引入 memberSession.ts，不写 localStorage / sessionStorage。
// - 后端响应 envelope：{ success: true, data: T }，call<T> 解包后返回 T。
// ============================================================

import { API_BASE_URL } from '../api/client'
import { isMemberSessionInvalidError, notifyMemberSessionExpired } from './memberSessionEvents'

// ── 错误类型 ──────────────────────────────────────────────────

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

// ── 响应类型 ──────────────────────────────────────────────────

export interface MemberUser {
  id: string
  phoneMasked: string
  nickname: string | null
}

export interface SendCodeResult {
  sent: true
  cooldownSeconds: number
  expiresInSeconds: number
}

export interface LoginResult {
  token: string
  user: MemberUser
}

// ── 内部 envelope 解包 ────────────────────────────────────────

interface Envelope<T> {
  success: boolean
  data: T
}

async function call<T>(
  path: string,
  method: 'GET' | 'POST',
  options: { body?: unknown; token?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`

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
      /* 非 JSON 响应，保留默认错误信息 */
    }
    if (isMemberSessionInvalidError(res.status, code, Boolean(options.token))) notifyMemberSessionExpired(options.token)
    throw new MemberApiError(code, message, res.status)
  }

  const json = (await res.json()) as Envelope<T>
  return json.data
}

// ── 公开 API 方法 ─────────────────────────────────────────────

/**
 * 发送手机验证码。
 * deviceId 用于短信频控的设备维度，可选。
 */
export function sendSmsCode(phone: string, deviceId?: string): Promise<SendCodeResult> {
  return call<SendCodeResult>('/member/auth/sms-code', 'POST', {
    body: deviceId ? { phone, deviceId } : { phone },
  })
}

/**
 * 手机号 + 验证码登录。
 * 成功后返回 token 和脱敏用户信息，token 由调用方注入内存 Context，不在此处存储。
 */
export function memberLogin(phone: string, code: string, deviceId?: string): Promise<LoginResult> {
  return call<LoginResult>('/member/auth/login', 'POST', {
    body: deviceId ? { phone, code, deviceId } : { phone, code },
  })
}

/**
 * 校验会话有效性，返回当前登录用户信息。
 * token 由调用方显式传入。
 */
export function fetchMemberMe(token: string): Promise<MemberUser> {
  return call<MemberUser>('/member/me', 'GET', { token })
}

/**
 * 登出：删除后端 Redis 会话。
 * token 由调用方显式传入。后端失败时调用方应保证本地状态已清（见 AuthContext.logout）。
 */
export function memberLogout(token: string): Promise<{ loggedOut: true }> {
  return call<{ loggedOut: true }>('/member/auth/logout', 'POST', { token })
}
