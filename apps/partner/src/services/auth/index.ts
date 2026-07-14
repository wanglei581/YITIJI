/**
 * Phase C 轻量级前端鉴权(Partner 版,与 admin 同构,仅 STORAGE_KEY 不同)。
 * 详细注释参见 apps/admin/src/services/auth/index.ts。
 */

import { API_BASE_URL } from '../api/client'

const STORAGE_KEY = 'partner_auth_v1'

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

function mergeStoredUser(partial: Partial<AuthedUser>): void {
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

export function authHeader(): Record<string, string> {
  const t = getToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

export function redirectToLogin(): void {
  clearAuth()
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.href = '/login'
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string }
}

async function postJson<T>(path: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; code: string; message: string; status: number }> {
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
    const payload = await res.json() as { data: T }
    return { ok: true, data: payload.data }
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
    const payload = await res.json() as { data: T }
    return { ok: true, data: payload.data }
  }
  let code = `HTTP_${res.status}`
  try {
    const eb = await res.json() as ErrorBody
    if (eb.error?.code) code = eb.error.code
  } catch { /* keep defaults */ }
  return { ok: false, code, status: res.status }
}

export type LoginResult =
  | { ok: true; user: AuthedUser }
  | { ok: false; code: string; message: string }

function ensurePartnerSession(data: { token: string; user: AuthedUser }): LoginResult {
  if (data.user.role !== 'partner') {
    clearAuth()
    return { ok: false, code: 'AUTH_PORTAL_FORBIDDEN', message: '当前账号无权登录合作机构后台' }
  }
  writeState({ token: data.token, user: data.user })
  return { ok: true, user: data.user }
}

export async function login(loginId: string, password: string): Promise<LoginResult> {
  const r = await postJson<{ token: string; user: AuthedUser }>('/auth/login', { loginId, password, portal: 'partner' })
  if (!r.ok) return { ok: false, code: r.code, message: r.message }
  return ensurePartnerSession(r.data)
}

export async function sendLoginSmsCode(phone: string): Promise<{ ok: true; cooldownSeconds: number } | { ok: false; code: string; message: string }> {
  const r = await postJson<{ sent: true; cooldownSeconds: number }>('/auth/sms-code', {
    phone,
    purpose: 'login',
    portal: 'partner',
  })
  if (!r.ok) return { ok: false, code: r.code, message: r.message }
  return { ok: true, cooldownSeconds: r.data.cooldownSeconds }
}

export async function loginWithSms(phone: string, code: string): Promise<LoginResult> {
  const r = await postJson<{ token: string; user: AuthedUser }>('/auth/login/sms', { phone, code, portal: 'partner' })
  if (!r.ok) return { ok: false, code: r.code, message: r.message }
  return ensurePartnerSession(r.data)
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

/** 登录态自助改密:成功后旧 token 立即失效,调用方需自行清 session 并跳登录页 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const r = await postJson<{ success: true }>('/auth/password/change', { currentPassword, newPassword })
  if (!r.ok) return { ok: false, code: r.code, message: r.message }
  return { ok: true }
}

export async function verifyToken(): Promise<AuthedUser | null> {
  if (!getToken()) return null
  const r = await getJson<AuthedUser>('/auth/me')
  if (r.ok) {
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
    if (normalized.role !== 'partner') {
      clearAuth()
      return null
    }
    const tok = getToken()
    if (tok) writeState({ token: tok, user: normalized })
    return normalized
  }
  clearAuth()
  return null
}

export function logout(): void {
  clearAuth()
  if (typeof window !== 'undefined') {
    window.location.href = '/login'
  }
}
