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
  id:    string
  name:  string
  role:  'admin' | 'partner' | 'kiosk'
  orgId: string | null
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

async function postJson<T>(path: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; code: string; message: string; status: number }> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeader() },
    body: JSON.stringify(body),
  })
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
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'GET',
    headers: { Accept: 'application/json', ...authHeader() },
  })
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

// ─── Public auth API ─────────────────────────────────────────────────────────

export type LoginResult =
  | { ok: true; user: AuthedUser }
  | { ok: false; code: string; message: string }

/** 调 POST /auth/login,成功后落盘 token + user */
export async function login(username: string, password: string): Promise<LoginResult> {
  const r = await postJson<{ token: string; user: AuthedUser }>('/auth/login', { username, password })
  if (!r.ok) return { ok: false, code: r.code, message: r.message }
  writeState({ token: r.data.token, user: r.data.user })
  return { ok: true, user: r.data.user }
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
    const u = r.data as unknown as { userId: string; role: AuthedUser['role']; orgId: string | null }
    const cur = getUser()
    const normalized: AuthedUser = {
      id:    u.userId,
      name:  cur?.name ?? '当前用户',
      role:  u.role,
      orgId: u.orgId,
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
