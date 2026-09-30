// ============================================================
// Admin 内部账号名册 Service（3.9，对接 services/api admin-internal-accounts 模块）
//
// 端点（均需 admin 登录态）：
//   GET   /admin/internal-accounts                         名册（admin/partner/kiosk）
//   PATCH /admin/internal-accounts/:id/status              启停管理员账号
//   POST  /admin/internal-accounts/backup-admin/start      建备用管理员第一步（发码）
//   POST  /admin/internal-accounts/backup-admin/verify     第二步（验码建号）
//
// 后端这些端点返回裸对象（无全局 ApiResponse 包装），但同一后端其它端点有
// { success, data } 包装；这里两种形状都能解析，响应形状不对时按 INVALID_RESPONSE
// 拒绝，不当成功。错误响应统一为 { error: { code, message } }，code 与中文 message
// 原样带回调用方。
//
// 合规：密码 / 验证码 / ticket 只经请求体发给服务端，不进任何浏览器存储、
// 不进 console、不进 URL；401 统一 redirectToLogin。
// ============================================================

import { authHeader, redirectToLogin } from '../auth'
import { API_BASE_URL, API_MODE, ApiHttpError } from './client'

// ─── 契约（= services/api internal-accounts.types.ts 的对外形状）────────────

export type InternalAccountRole = 'admin' | 'partner' | 'kiosk'
export type InternalAccountPasswordState = 'temporary' | 'owner_managed' | 'legacy'

export const INTERNAL_ACCOUNT_PAGE_SIZES = [10, 20, 50, 100] as const
export type InternalAccountPageSize = (typeof INTERNAL_ACCOUNT_PAGE_SIZES)[number]

export interface InternalAccountItem {
  id: string
  username: string
  name: string
  role: string
  orgId: string | null
  orgName: string | null
  enabled: boolean
  phoneBound: boolean
  phoneVerified: boolean
  phoneMasked: string | null
  emailBound: boolean
  passwordState: InternalAccountPasswordState
  lastLoginAt: string | null
  createdAt: string
  isBackupAdmin: boolean
}

export interface InternalAccountListResult {
  items: InternalAccountItem[]
  total: number
  page: number
  pageSize: number
}

export interface InternalAccountListQuery {
  role?: InternalAccountRole
  enabled?: boolean
  orgId?: string
  /** 账号 / 姓名 / 关键字，或 11 位手机号（后端按手机号精确匹配）。≤50 字。 */
  keyword?: string
  page: number
  pageSize: number
}

export interface InternalAccountStatusInput {
  action: 'enable' | 'disable'
  /** trim 后 2–200 字，写进审计。 */
  reason: string
  /** 管理员本人当前密码（step-up 确认）。 */
  adminCurrentPassword: string
}

export type InternalAccountStatusResult = InternalAccountItem & { sessionInvalidation: 'ok' | 'failed' }

export interface BackupAdminStartInput {
  phone: string
  adminCurrentPassword: string
}

export interface BackupAdminStartResult {
  ticket: string
  phoneMasked: string
  expiresInSeconds: number
  cooldownSeconds: number
}

export interface BackupAdminVerifyInput {
  ticket: string
  code: string
}

// ─── HTTP 通道 ────────────────────────────────────────────────────────────────

interface ErrorBody {
  error?: { code?: string; message?: string }
}

function invalidResponse(status: number): never {
  throw new ApiHttpError('INVALID_RESPONSE', '服务响应异常，请稍后重试', status)
}

/** 后端裸对象与 { success: true, data } 包装两种形状都接受。 */
function unwrapEnvelope(value: unknown): unknown {
  if (typeof value === 'object' && value !== null && 'data' in value) {
    const candidate = value as { success?: unknown; data: unknown }
    if (candidate.success === true) return candidate.data
  }
  return value
}

async function request<T>(method: string, path: string, body: unknown, validate: (value: unknown) => value is T): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...authHeader(),
    },
    credentials: 'include',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (!response.ok) {
    let code = `HTTP_${response.status}`
    let message = response.statusText || '请求失败'
    try {
      const parsed = (await response.json()) as ErrorBody
      if (parsed.error?.code) code = parsed.error.code
      if (parsed.error?.message) message = parsed.error.message
    } catch {
      // 响应不是 JSON 时保留 HTTP 状态信息。
    }
    if (response.status === 401) {
      redirectToLogin()
      throw new ApiHttpError(code || 'AUTH_REQUIRED', '登录已过期', response.status)
    }
    throw new ApiHttpError(code, message, response.status)
  }
  const raw: unknown = await response.json().catch(() => null)
  const payload = unwrapEnvelope(raw)
  if (!validate(payload)) invalidResponse(response.status)
  return payload
}

// ─── 响应形状守卫 ─────────────────────────────────────────────────────────────

function isInternalAccountItem(value: unknown): value is InternalAccountItem {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' && typeof v.username === 'string' && typeof v.name === 'string'
    && typeof v.role === 'string' && typeof v.enabled === 'boolean' && typeof v.isBackupAdmin === 'boolean'
    && typeof v.phoneBound === 'boolean' && typeof v.phoneVerified === 'boolean' && typeof v.emailBound === 'boolean'
    && (v.passwordState === 'temporary' || v.passwordState === 'owner_managed' || v.passwordState === 'legacy')
    && (v.lastLoginAt === null || typeof v.lastLoginAt === 'string') && typeof v.createdAt === 'string'
    && (v.orgId === null || typeof v.orgId === 'string') && (v.orgName === null || typeof v.orgName === 'string')
    && (v.phoneMasked === null || typeof v.phoneMasked === 'string')
  )
}

function isListResult(value: unknown): value is InternalAccountListResult {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    Array.isArray(v.items) && v.items.every(isInternalAccountItem)
    && typeof v.total === 'number' && typeof v.page === 'number' && typeof v.pageSize === 'number'
  )
}

function isStatusResult(value: unknown): value is InternalAccountStatusResult {
  if (!isInternalAccountItem(value)) return false
  const invalidation = (value as unknown as Record<string, unknown>).sessionInvalidation
  return invalidation === 'ok' || invalidation === 'failed'
}

function isBoundedSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 600
}

function isBackupAdminStartResult(value: unknown): value is BackupAdminStartResult {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.ticket === 'string' && v.ticket.length > 0 && typeof v.phoneMasked === 'string'
    && isBoundedSeconds(v.expiresInSeconds) && isBoundedSeconds(v.cooldownSeconds)
  )
}

// ─── 对外 API ─────────────────────────────────────────────────────────────────

/** 后端只接受 10/20/50/100；越界值收敛到默认 20，绝不发送非法 pageSize。 */
export function toAllowedPageSize(value: number): InternalAccountPageSize {
  return (INTERNAL_ACCOUNT_PAGE_SIZES as readonly number[]).includes(value)
    ? (value as InternalAccountPageSize)
    : 20
}

function demoModeUnavailable(action: string): Promise<never> {
  return Promise.reject(new ApiHttpError('DEMO_MODE_READONLY', `当前为演示模式，${action}需要连接真实后端`, 501))
}

export function listInternalAccounts(query: InternalAccountListQuery): Promise<InternalAccountListResult> {
  if (API_MODE !== 'http') {
    return Promise.resolve({ items: [], total: 0, page: query.page, pageSize: toAllowedPageSize(query.pageSize) })
  }
  const params = new URLSearchParams()
  params.set('page', String(Math.max(1, Math.trunc(query.page) || 1)))
  params.set('pageSize', String(toAllowedPageSize(query.pageSize)))
  if (query.role) params.set('role', query.role)
  if (query.enabled !== undefined) params.set('enabled', String(query.enabled))
  if (query.orgId) params.set('orgId', query.orgId)
  const keyword = query.keyword?.trim().slice(0, 50)
  if (keyword) params.set('keyword', keyword)
  return request<InternalAccountListResult>('GET', `/admin/internal-accounts?${params.toString()}`, undefined, isListResult)
}

/** 只支持 role=admin 的账号；partner 账号请到合作机构管理页启停。 */
export function setInternalAccountStatus(id: string, input: InternalAccountStatusInput): Promise<InternalAccountStatusResult> {
  if (API_MODE !== 'http') return demoModeUnavailable('启停内部账号')
  return request<InternalAccountStatusResult>(
    'PATCH',
    `/admin/internal-accounts/${encodeURIComponent(id)}/status`,
    { action: input.action, reason: input.reason.trim(), adminCurrentPassword: input.adminCurrentPassword },
    isStatusResult,
  )
}

/** 建备用管理员第一步：本人密码确认 + 给备用手机号发验证码。 */
export function startBackupAdmin(input: BackupAdminStartInput): Promise<BackupAdminStartResult> {
  if (API_MODE !== 'http') return demoModeUnavailable('新建备用管理员')
  return request<BackupAdminStartResult>(
    'POST',
    '/admin/internal-accounts/backup-admin/start',
    { phone: input.phone.trim(), adminCurrentPassword: input.adminCurrentPassword },
    isBackupAdminStartResult,
  )
}

/** 建备用管理员第二步：验证码通过即建号（默认停用、随机临时密码、手机号已验证）。 */
export function verifyBackupAdmin(input: BackupAdminVerifyInput): Promise<InternalAccountItem> {
  if (API_MODE !== 'http') return demoModeUnavailable('验证备用管理员验证码')
  return request<InternalAccountItem>(
    'POST',
    '/admin/internal-accounts/backup-admin/verify',
    { ticket: input.ticket, code: input.code },
    isInternalAccountItem,
  )
}
