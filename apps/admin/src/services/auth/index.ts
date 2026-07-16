/**
 * Phase C 轻量级前端鉴权模块。
 *
 * 设计口径(架构师建议):
 *   - JWT 自身 expire 是唯一过期机制,前端只负责"401 就回登录"
 *   - 不做 refresh token / 客户端 expire 倒计时 / remember me
 *   - 401 → 清 token → 跳 /login(用 window.location.href 触发全量重新加载,
 *     比 React Router 编程跳转更彻底,能重置所有 in-memory 状态)
 *
 * 存储:localStorage `admin_auth_v1` = { token, user }
 *   versioned key 方便未来 schema 迁移直接 clearAuth。
 */

import { API_BASE_URL } from '../api/client'

const STORAGE_KEY = 'admin_auth_v1'

export interface AuthedUser {
  id:           string
  name:         string
  role:         'admin' | 'partner' | 'kiosk'
  orgId:        string | null
  phoneMasked?: string
  phoneVerifiedAt?: string | null
}

interface AuthState {
  token: string
  user:  AuthedUser
}

// ─── localStorage helpers ────────────────────────────────────────────────────

function readState(): AuthState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AuthState>
    if (!parsed.token || !parsed.user) return null
    return parsed as AuthState
  } catch {
    return null
  }
}

function writeState(state: AuthState): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* ignore */ }
}

/** 仅合并可安全持久化的当前用户展示字段；调用方不得传入密码、验证码或 ticket。 */
export function mergeStoredUser(partial: Partial<AuthedUser>): void {
  const state = readState()
  if (!state) return
  writeState({ token: state.token, user: { ...state.user, ...partial } })
}

export function getToken(): string | null {
  return readState()?.token ?? null
}

export function getUser(): AuthedUser | null {
  return readState()?.user ?? null
}

export function clearAuth(): void {
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
}

/** 给 adapter 用:Bearer 头(无 token 时返回空对象,不影响公开接口) */
export function authHeader(): Record<string, string> {
  const t = getToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

/** 401 统一处理:清 token + 跳登录页(全量重新加载) */
export function redirectToLogin(): void {
  clearAuth()
  // 避免在登录页本身触发循环跳转
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.href = '/login'
  }
}

// ─── API calls(不走 adapter,避免循环依赖)──────────────────────────────

interface ErrorBody {
  error?: { code?: string; message?: string }
}

async function postJson<T>(path: string, body: unknown): Promise<{ ok: true; data: T; status: number } | { ok: false; code: string; message: string; status: number }> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeader() },
      body: JSON.stringify(body),
    })
  } catch {
    // fetch() 本身抛出(断网/DNS/CORS)时不会走 res.ok 分支；不捕获会导致调用方
    // 卡在 submitting=true 无法恢复(见改密页 network exception 走查)。
    return { ok: false, code: 'NETWORK_ERROR', message: '网络连接异常，请检查网络后重试', status: 0 }
  }
  if (res.ok) {
    try {
      const payload = await res.json() as { data: T }
      return { ok: true, data: payload.data, status: res.status }
    } catch {
      return { ok: false, code: 'INVALID_RESPONSE', message: '服务响应异常，请稍后重试', status: res.status }
    }
  }
  let code = `HTTP_${res.status}`
  let message = res.statusText || '请求失败'
  try {
    const eb = await res.json() as ErrorBody
    if (eb.error?.code)    code    = eb.error.code
    if (eb.error?.message) message = eb.error.message
  } catch { /* keep defaults */ }
  return { ok: false, code, message, status: res.status }
}

async function getJson<T>(path: string): Promise<{ ok: true; data: T } | { ok: false; code: string; status: number }> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json', ...authHeader() },
    })
  } catch {
    return { ok: false, code: 'NETWORK_ERROR', status: 0 }
  }
  if (res.ok) {
    try {
      const payload = await res.json() as { data: T }
      return { ok: true, data: payload.data }
    } catch {
      return { ok: false, code: 'INVALID_RESPONSE', status: res.status }
    }
  }
  let code = `HTTP_${res.status}`
  try {
    const eb = await res.json() as ErrorBody
    if (eb.error?.code) code = eb.error.code
  } catch { /* keep defaults */ }
  return { ok: false, code, status: res.status }
}

type AdminInitialPhoneBindStartData = {
  bindTicket: string
  cooldownSeconds: number
  expiresInSeconds: number
}

type AdminInitialPhoneBindVerifyData = {
  phoneMasked: string
  phoneVerifiedAt: string
}

type AdminInitialPhoneBindCancelData = {
  cancelled: true
}

type AdminInitialPhoneBindFailure = {
  ok: false
  code: string
  message: string
  status: number
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MASKED_PHONE_PATTERN = /^1[3-9]\d\*{4}\d{4}$/

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isUuid(value: unknown): value is string {
  return isNonEmptyString(value) && UUID_PATTERN.test(value)
}

function isBoundedSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 300
}

function isMaskedPhone(value: unknown): value is string {
  return typeof value === 'string' && (MASKED_PHONE_PATTERN.test(value) || value === '***')
}

function isCanonicalIsoDate(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) && new Date(value).toISOString() === value
}

function isValidAdminInitialPhoneBindStartResponse(data: unknown): data is AdminInitialPhoneBindStartData {
  if (typeof data !== 'object' || data === null) return false
  const candidate = data as Record<string, unknown>
  return (
    isUuid(candidate.bindTicket) &&
    isBoundedSeconds(candidate.cooldownSeconds) &&
    isBoundedSeconds(candidate.expiresInSeconds) &&
    candidate.expiresInSeconds > 0
  )
}

function isValidAdminInitialPhoneBindVerifyResponse(data: unknown): data is AdminInitialPhoneBindVerifyData {
  if (typeof data !== 'object' || data === null) return false
  const candidate = data as Record<string, unknown>
  return isMaskedPhone(candidate.phoneMasked) && isCanonicalIsoDate(candidate.phoneVerifiedAt)
}

function isValidAdminInitialPhoneBindCancelResponse(data: unknown): data is AdminInitialPhoneBindCancelData {
  return typeof data === 'object' && data !== null && (data as Record<string, unknown>).cancelled === true
}

function invalidAdminInitialPhoneBindResponse(status: number): AdminInitialPhoneBindFailure {
  return { ok: false, code: 'INVALID_RESPONSE', message: '服务响应异常，请稍后再试', status }
}

// ─── Public auth API ─────────────────────────────────────────────────────────

export type LoginResult =
  | { ok: true; user: AuthedUser }
  | { ok: false; code: string; message: string }

/** 调 POST /auth/login,成功后落盘 token + user */
function ensureAdminSession(data: { token: string; user: AuthedUser }): LoginResult {
  if (data.user.role !== 'admin') {
    clearAuth()
    return { ok: false, code: 'AUTH_PORTAL_FORBIDDEN', message: '当前账号无权登录管理员后台' }
  }
  writeState({ token: data.token, user: data.user })
  return { ok: true, user: data.user }
}

export async function login(loginId: string, password: string): Promise<LoginResult> {
  const r = await postJson<{ token: string; user: AuthedUser }>('/auth/login', { loginId, password, portal: 'admin' })
  if (!r.ok) return { ok: false, code: r.code, message: r.message }
  return ensureAdminSession(r.data)
}

export async function sendLoginSmsCode(phone: string): Promise<{ ok: true; cooldownSeconds: number } | { ok: false; code: string; message: string }> {
  const r = await postJson<{ sent: true; cooldownSeconds: number }>('/auth/sms-code', {
    phone,
    purpose: 'login',
    portal: 'admin',
  })
  if (!r.ok) return { ok: false, code: r.code, message: r.message }
  return { ok: true, cooldownSeconds: r.data.cooldownSeconds }
}

export async function loginWithSms(phone: string, code: string): Promise<LoginResult> {
  const r = await postJson<{ token: string; user: AuthedUser }>('/auth/login/sms', { phone, code, portal: 'admin' })
  if (!r.ok) return { ok: false, code: r.code, message: r.message }
  return ensureAdminSession(r.data)
}

export async function startPasswordReset(loginIdOrPhone: string): Promise<{ ok: true; cooldownSeconds: number } | { ok: false; code: string; message: string }> {
  const r = await postJson<{ sent: true; cooldownSeconds: number }>('/auth/password/reset/start', { loginIdOrPhone })
  if (!r.ok) return { ok: false, code: r.code, message: r.message }
  return { ok: true, cooldownSeconds: r.data.cooldownSeconds }
}

export async function verifyPasswordReset(loginIdOrPhone: string, code: string): Promise<{ ok: true; resetTicket: string } | { ok: false; code: string; message: string }> {
  const r = await postJson<{ resetTicket: string }>('/auth/password/reset/verify', { loginIdOrPhone, code })
  if (!r.ok) return { ok: false, code: r.code, message: r.message }
  return { ok: true, resetTicket: r.data.resetTicket }
}

export async function completePasswordReset(resetTicket: string, newPassword: string): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const r = await postJson<{ success: true }>('/auth/password/reset/complete', { resetTicket, newPassword })
  if (!r.ok) return { ok: false, code: r.code, message: r.message }
  return { ok: true }
}

export async function sendOwnPhoneCode(): Promise<{ ok: true; cooldownSeconds: number } | { ok: false; code: string; message: string }> {
  const r = await postJson<{ sent: true; cooldownSeconds: number }>('/auth/phone/code', {})
  if (!r.ok) return { ok: false, code: r.code, message: r.message }
  return { ok: true, cooldownSeconds: r.data.cooldownSeconds }
}

export async function verifyOwnPhone(code: string): Promise<{ ok: true; phoneVerifiedAt: string } | { ok: false; code: string; message: string }> {
  const r = await postJson<{ phoneMasked: string; phoneVerifiedAt: string }>('/auth/phone/verify', { code })
  if (!r.ok) return { ok: false, code: r.code, message: r.message }
  mergeStoredUser({ phoneMasked: r.data.phoneMasked, phoneVerifiedAt: r.data.phoneVerifiedAt })
  return { ok: true, phoneVerifiedAt: r.data.phoneVerifiedAt }
}

export async function startInitialPhoneBind(
  currentPassword: string,
  phone: string,
): Promise<{ ok: true; bindTicket: string; cooldownSeconds: number; expiresInSeconds: number } | { ok: false; code: string; message: string }> {
  const r = await postJson<{ bindTicket: string; cooldownSeconds: number; expiresInSeconds: number }>(
    '/auth/phone/initial-bind/start',
    { currentPassword, phone },
  )
  if (!r.ok) return { ok: false, code: r.code, message: r.message }
  return { ok: true, ...r.data }
}

export async function completeInitialPhoneBind(
  bindTicket: string,
  code: string,
): Promise<{ ok: true; phoneMasked: string; phoneVerifiedAt: string } | { ok: false; code: string; message: string }> {
  const r = await postJson<{ phoneMasked: string; phoneVerifiedAt: string }>(
    '/auth/phone/initial-bind/verify',
    { bindTicket, code },
  )
  if (!r.ok) return { ok: false, code: r.code, message: r.message }
  return { ok: true, ...r.data }
}

/** Admin 首次绑定只能走严格状态机，成功响应必须先经过运行时 shape guard。 */
export async function startAdminInitialPhoneBind(
  currentPassword: string,
  phone: string,
): Promise<{ ok: true; bindTicket: string; cooldownSeconds: number; expiresInSeconds: number } | AdminInitialPhoneBindFailure> {
  const r = await postJson<unknown>('/auth/admin/phone/initial-bind/start', { currentPassword, phone })
  if (!r.ok) return { ok: false, code: r.code, message: r.message, status: r.status }
  if (!isValidAdminInitialPhoneBindStartResponse(r.data)) return invalidAdminInitialPhoneBindResponse(r.status)
  return {
    ok: true,
    bindTicket: r.data.bindTicket,
    cooldownSeconds: r.data.cooldownSeconds,
    expiresInSeconds: r.data.expiresInSeconds,
  }
}

/** Admin 严格首次绑定成功后，才允许把脱敏展示字段写回现有会话。 */
export async function verifyAdminInitialPhoneBind(
  bindTicket: string,
  code: string,
): Promise<{ ok: true; phoneMasked: string; phoneVerifiedAt: string } | AdminInitialPhoneBindFailure> {
  const r = await postJson<unknown>('/auth/admin/phone/initial-bind/verify', { bindTicket, code })
  if (!r.ok) return { ok: false, code: r.code, message: r.message, status: r.status }
  if (!isValidAdminInitialPhoneBindVerifyResponse(r.data)) return invalidAdminInitialPhoneBindResponse(r.status)
  const bound = { phoneMasked: r.data.phoneMasked, phoneVerifiedAt: r.data.phoneVerifiedAt }
  mergeStoredUser(bound)
  return { ok: true, ...bound }
}

/** 仅用于放弃当前 Admin 自己的严格首次绑定 ticket；不写本地会话。 */
export async function cancelAdminInitialPhoneBind(
  bindTicket: string,
): Promise<{ ok: true } | AdminInitialPhoneBindFailure> {
  const r = await postJson<unknown>('/auth/admin/phone/initial-bind/cancel', { bindTicket })
  if (!r.ok) return { ok: false, code: r.code, message: r.message, status: r.status }
  if (!isValidAdminInitialPhoneBindCancelResponse(r.data)) return invalidAdminInitialPhoneBindResponse(r.status)
  return { ok: true }
}

/** 登录态自助改密:成功后旧 token 立即失效,调用方需自行清 session 并跳登录页 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const r = await postJson<{ success: true }>('/auth/password/change', { currentPassword, newPassword })
  if (!r.ok) return { ok: false, code: r.code, message: r.message }
  return { ok: true }
}

/**
 * 启动时调 GET /auth/me 校验 token 是否仍有效。
 * 成功:返回 user(同时刷新本地 user 信息);失败:清 token,返回 null。
 */
export async function verifyToken(): Promise<AuthedUser | null> {
  if (!getToken()) return null
  const r = await getJson<AuthedUser>('/auth/me')
  if (r.ok) {
    // /auth/me 返回 { userId, role, orgId },字段名与 LoginResult.user 略异,
    // 后端给的是 AuthedUser(userId 字段)。这里规范化为前端 AuthedUser(id 字段)。
    const u = r.data as unknown as { userId: string; role: AuthedUser['role']; orgId: string | null; phoneMasked?: string; phoneVerifiedAt?: string | null }
    const cur = getUser()
    const normalized: AuthedUser = {
      id:    u.userId,
      name:  cur?.name ?? '当前用户',
      role:  u.role,
      orgId: u.orgId,
      phoneMasked: u.phoneMasked ?? cur?.phoneMasked,
      phoneVerifiedAt: u.phoneVerifiedAt ?? cur?.phoneVerifiedAt ?? null,
    }
    if (normalized.role !== 'admin') {
      clearAuth()
      return null
    }
    const tok = getToken()
    if (tok) writeState({ token: tok, user: normalized })
    return normalized
  }
  // 任何非 200(401/403/网络错误)都视为登录失效
  clearAuth()
  return null
}

/** 主动登出:清 token + 跳 /login */
export function logout(): void {
  clearAuth()
  if (typeof window !== 'undefined') {
    window.location.href = '/login'
  }
}
