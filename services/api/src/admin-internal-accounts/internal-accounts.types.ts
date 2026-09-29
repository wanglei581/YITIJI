import { HttpException, HttpStatus, Logger } from '@nestjs/common'
import { maskPhoneFromEnc } from '../common/crypto/phone-identity'
import { PASSWORD_PROOF_STATE } from '../auth/password-proof-state'

/**
 * 内部账号名册（3.9）的对外形状与错误。
 *
 * 名册只从 `INTERNAL_ACCOUNT_SELECT` 读列，再由 `toInternalAccountItem` 逐字段拼新对象：
 * passwordHash / phoneHash / phoneEnc / emailHash / emailEnc / tokenVersion 不会出现在响应里
 * （phoneEnc / emailEnc 只读来派生「是否绑定」与脱敏号码；verify:internal-accounts
 * 把整页响应序列化后搜这些字段名与值）。
 */
export const INTERNAL_ACCOUNT_ROLES = ['admin', 'partner', 'kiosk'] as const
export type InternalAccountRole = (typeof INTERNAL_ACCOUNT_ROLES)[number]
export const INTERNAL_ACCOUNT_PAGE_SIZES = [10, 20, 50, 100] as const

export type InternalAccountPasswordState = 'temporary' | 'owner_managed' | 'legacy'

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
  keyword?: string
  page: number
  pageSize: number
}

/** 请求来源：ip 给短信频控用；ipAddress / userAgent / requestId 写进审计三列。 */
export interface InternalAccountRequestContext {
  ip: string
  ipAddress: string | null
  userAgent: string | null
  requestId: string | null
  deviceId?: string
}

/** 名册唯一允许读取的列。加列前先想清楚它能不能出现在管理后台的表格里。 */
export const INTERNAL_ACCOUNT_SELECT = {
  id: true,
  username: true,
  name: true,
  role: true,
  orgId: true,
  org: { select: { name: true } },
  enabled: true,
  phoneEnc: true,
  phoneVerifiedAt: true,
  emailEnc: true,
  passwordProofState: true,
  lastLoginAt: true,
  createdAt: true,
  isBackupAdmin: true,
} as const

export interface InternalAccountRow {
  id: string
  username: string
  name: string
  role: string
  orgId: string | null
  org: { name: string } | null
  enabled: boolean
  phoneEnc: string | null
  phoneVerifiedAt: Date | null
  emailEnc: string | null
  passwordProofState: string
  lastLoginAt: Date | null
  createdAt: Date
  isBackupAdmin: boolean
}

const logger = new Logger('InternalAccounts')

export function toInternalAccountItem(row: InternalAccountRow): InternalAccountItem {
  let phoneMasked: string | null = null
  if (row.phoneEnc) {
    try {
      phoneMasked = maskPhoneFromEnc(row.phoneEnc)
    } catch {
      logger.warn(`手机号密文解密失败，已降级脱敏展示 userId=${row.id}`)
      phoneMasked = '***'
    }
  }
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    orgId: row.orgId,
    orgName: row.org?.name ?? null,
    enabled: row.enabled,
    phoneBound: row.phoneEnc !== null,
    phoneVerified: row.phoneEnc !== null && row.phoneVerifiedAt !== null,
    phoneMasked,
    emailBound: row.emailEnc !== null,
    passwordState: toPasswordState(row.passwordProofState),
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    isBackupAdmin: row.isBackupAdmin,
  }
}

function toPasswordState(value: string): InternalAccountPasswordState {
  if (value === PASSWORD_PROOF_STATE.TEMPORARY) return 'temporary'
  if (value === PASSWORD_PROOF_STATE.OWNER_MANAGED) return 'owner_managed'
  return 'legacy'
}

export function internalAccountError(status: HttpStatus, code: string, message: string): HttpException {
  return new HttpException({ error: { code, message } }, status)
}

export const internalAccountErrors = {
  notFound: () => internalAccountError(HttpStatus.NOT_FOUND, 'INTERNAL_ACCOUNT_NOT_FOUND', '账号不存在或已删除'),
  roleUnsupported: () => internalAccountError(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'INTERNAL_ACCOUNT_ROLE_UNSUPPORTED',
    '这里只能启停管理员账号；合作机构账号请到「合作机构管理」里操作',
  ),
  selfDisable: () => internalAccountError(HttpStatus.CONFLICT, 'INTERNAL_ACCOUNT_SELF_DISABLE_FORBIDDEN', '不能停用自己正在使用的账号'),
  lastAdmin: () => internalAccountError(
    HttpStatus.CONFLICT,
    'INTERNAL_ACCOUNT_LAST_ADMIN',
    '这是最后一个可用的管理员账号，停用后将没有人能登录管理后台',
  ),
  unchanged: () => internalAccountError(HttpStatus.CONFLICT, 'INTERNAL_ACCOUNT_STATUS_UNCHANGED', '账号已是该状态，请刷新后查看'),
  stale: () => internalAccountError(HttpStatus.CONFLICT, 'INTERNAL_ACCOUNT_STATE_CHANGED', '账号状态刚被修改，请刷新后重试'),
  actorUnavailable: () => internalAccountError(HttpStatus.FORBIDDEN, 'INTERNAL_ACCOUNT_ACTOR_UNAVAILABLE', '当前管理员账号不可执行该操作，请重新登录'),
  actorTemporaryPassword: () => internalAccountError(
    HttpStatus.FORBIDDEN,
    'INTERNAL_ACCOUNT_ACTOR_PASSWORD_NOT_READY',
    '请先把当前账号的临时密码改成自己的密码，再做账号管理操作',
  ),
  adminCredentialInvalid: () => internalAccountError(HttpStatus.UNPROCESSABLE_ENTITY, 'ADMIN_CREDENTIAL_INVALID', '管理员本人密码不正确'),
  adminCredentialLocked: () => internalAccountError(HttpStatus.TOO_MANY_REQUESTS, 'ADMIN_CREDENTIAL_LOCKED', '管理员密码尝试次数过多，请稍后再试'),
  phoneInvalid: () => internalAccountError(HttpStatus.BAD_REQUEST, 'INTERNAL_ACCOUNT_PHONE_INVALID', '请输入正确的 11 位手机号'),
  phoneOccupied: () => internalAccountError(HttpStatus.CONFLICT, 'INTERNAL_ACCOUNT_PHONE_OCCUPIED', '该手机号已绑定其他账号，请换一个手机号'),
  backupExists: () => internalAccountError(HttpStatus.CONFLICT, 'BACKUP_ADMIN_EXISTS', '已经有一个备用管理员账号，不能再建第二个'),
  backupChallengeUnavailable: () => internalAccountError(
    HttpStatus.CONFLICT,
    'BACKUP_ADMIN_CHALLENGE_UNAVAILABLE',
    '验证已过期、已使用或不匹配，请重新开始',
  ),
  smsCodeInvalid: () => internalAccountError(HttpStatus.BAD_REQUEST, 'SMS_CODE_INVALID', '验证码不正确，请重新输入'),
  smsCodeExpired: () => internalAccountError(HttpStatus.BAD_REQUEST, 'SMS_CODE_EXPIRED', '验证码已过期，请重新获取'),
}

export function structuredErrorCode(error: unknown): string | null {
  if (!(error instanceof HttpException)) return null
  const response = error.getResponse()
  if (!response || typeof response !== 'object' || Array.isArray(response)) return null
  const nested = (response as { error?: unknown }).error
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return null
  const code = (nested as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

/** 唯一约束冲突（Prisma P2002，或适配器直接抛出的驱动错误）。返回可读的冲突目标，非冲突返回 null。 */
export function uniqueViolationTarget(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const candidate = error as { code?: unknown; meta?: Record<string, unknown>; message?: unknown }
  const message = typeof candidate.message === 'string' ? candidate.message : ''
  if (candidate.code === 'P2002') {
    return `${JSON.stringify(candidate.meta ?? {})} ${message}`
  }
  if (/UNIQUE constraint failed|duplicate key value|Unique constraint failed/i.test(message)) return message
  return null
}

/**
 * PostgreSQL Serializable 冲突的识别统一走 common/prisma/serialization-conflict（#1096 立的唯一识别点，
 * 门禁 verify:pg-serialization-conflict 静态扫描禁止各处自写）。这里转出同一个函数，调用方不用改 import。
 */
export { isSerializationConflict } from '../common/prisma/serialization-conflict'
