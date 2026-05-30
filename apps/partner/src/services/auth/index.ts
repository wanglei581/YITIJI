/**
 * Phase C 轻量级前端鉴权(Partner 版,与 admin 同构,仅 STORAGE_KEY 不同)。
 * 详细注释参见 apps/admin/src/services/auth/index.ts。
 */

import { API_BASE_URL } from '../api/client'

const STORAGE_KEY = 'partner_auth_v1'

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

export type LoginResult =
  | { ok: true; user: AuthedUser }
  | { ok: false; code: string; message: string }

export async function login(username: string, password: string): Promise<LoginResult> {
  const r = await postJson<{ token: string; user: AuthedUser }>('/auth/login', { username, password })
  if (!r.ok) return { ok: false, code: r.code, message: r.message }
  writeState({ token: r.data.token, user: r.data.user })
  return { ok: true, user: r.data.user }
}

export async function verifyToken(): Promise<AuthedUser | null> {
  if (!getToken()) return null
  const r = await getJson<AuthedUser>('/auth/me')
  if (r.ok) {
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
  clearAuth()
  return null
}

export function logout(): void {
  clearAuth()
  if (typeof window !== 'undefined') {
    window.location.href = '/login'
  }
}
