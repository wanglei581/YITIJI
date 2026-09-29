// ============================================================
// C 端求职者账号 API（L2-4A）
//
// 调用真实后端 /api/v1/member/*。
// - token 通过函数参数显式传入，不从任何存储读取。
// - 不引入 memberSession.ts，不写 localStorage / sessionStorage。
// - 后端响应 envelope：{ success: true, data: T }，call<T> 解包后返回 T。
// ============================================================

import { API_BASE_URL } from '../api/client'
import { terminalAttributedFetch } from '../terminalAuth'
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

/** 协议还没正式发布时的登录拦截文案（C4）：一体机正式构建与服务端 LEGAL_DOCS_NOT_PUBLISHED 共用。 */
export const LEGAL_DOCS_NOT_PUBLISHED_COPY = '暂时无法登录：用户协议和隐私政策还没有正式发布。不登录也能打印和扫描。'

/**
 * 将 API 错误收敛为可直接展示给用户的文案。
 * 明确的业务消息原样保留；网络错误和通用 HTTP 占位消息使用调用场景自己的恢复提示。
 */
export function resolveMemberApiErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof MemberApiError)) return fallback
  if (error.code === 'NETWORK_ERROR' || error.status === 0) return fallback
  if (!error.message.trim() || /^请求失败（\d+）$/.test(error.message)) return fallback
  return error.message
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
  options: { body?: unknown; token?: string; keepalive?: boolean } = {},
  send: typeof fetch = fetch,
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`

  let res: Response
  try {
    res = await send(`${API_BASE_URL}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      keepalive: options.keepalive,
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
 *
 * 经 terminalAttributedFetch 发出：一体机上带 x-terminal-id + x-terminal-session-token，
 * 服务端据此按台计每日短信额度（带了终端编号却验不过签的会被 401 拒绝，届时换一次票重发）；
 * 手机上的扫码确认页没有终端身份，照旧只按号码 / 网络计。
 */
export function sendSmsCode(phone: string, deviceId?: string): Promise<SendCodeResult> {
  return call<SendCodeResult>('/member/auth/sms-code', 'POST', {
    body: deviceId ? { phone, deviceId } : { phone },
  }, terminalAttributedFetch)
}

/**
 * 手机号 + 验证码登录。
 * 成功后返回 token 和脱敏用户信息，token 由调用方注入内存 Context，不在此处存储。
 * termsVersion / privacyVersion 为勾选同意时展示的协议版本（与服务端当前有效版本对齐）。
 */
export function memberLogin(
  phone: string,
  code: string,
  consent: { termsVersion: string; privacyVersion: string },
  deviceId?: string,
): Promise<LoginResult> {
  return call<LoginResult>('/member/auth/login', 'POST', {
    body: {
      phone,
      code,
      termsVersion: consent.termsVersion,
      privacyVersion: consent.privacyVersion,
      ...(deviceId ? { deviceId } : {}),
    },
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
  return call<{ loggedOut: true }>('/member/auth/logout', 'POST', { token, keepalive: true })
}

// ── 换绑相关类型 ───────────────────────────────────────────────

export interface StepUpChallengeResult {
  challengeId: string
  phoneMasked: string
  expiresInSeconds: number
  cooldownSeconds: number
}

export interface StepUpGrantResult {
  stepUpToken: string
  action: string
  expiresInSeconds: number
}

export interface PhoneRebindResult {
  newPhoneMasked: string
  sessionsRevoked: number
}

/**
 * 为旧号发起 step-up 挑战（换绑用）。
 * 后端向当前注册手机号发送 OTP，返回 challengeId。
 */
export function sendPhoneRebindStepUpCode(
  token: string,
  deviceId?: string,
): Promise<StepUpChallengeResult> {
  return call<StepUpChallengeResult>('/member/auth/step-up/sms-code', 'POST', {
    token,
    body: deviceId ? { action: 'phone_rebind', deviceId } : { action: 'phone_rebind' },
  })
}

/**
 * 校验旧号 step-up OTP，获取一次性 stepUpToken（action=phone_rebind）。
 */
export function verifyPhoneRebindStepUp(
  token: string,
  challengeId: string,
  code: string,
  deviceId?: string,
): Promise<StepUpGrantResult> {
  return call<StepUpGrantResult>('/member/auth/step-up/verify', 'POST', {
    token,
    body: deviceId ? { challengeId, code, deviceId } : { challengeId, code },
  })
}

/**
 * 提交换绑。需同时提供：
 * - stepUpToken：旧号 step-up 验证后签发的一次性凭证
 * - newPhone：新手机号
 * - newPhoneCode：已发送到新号的 6 位验证码（先调 sendSmsCode 获取）
 *
 * 成功后所有旧会话失效，前端应清除内存 token 并提示用新号重新登录。
 */
export function submitPhoneRebind(
  token: string,
  stepUpToken: string,
  newPhone: string,
  newPhoneCode: string,
  deviceId?: string,
): Promise<PhoneRebindResult> {
  return call<PhoneRebindResult>('/member/phone/rebind', 'POST', {
    token,
    body: deviceId
      ? { stepUpToken, newPhone, newPhoneCode, deviceId }
      : { stepUpToken, newPhone, newPhoneCode },
  })
}
