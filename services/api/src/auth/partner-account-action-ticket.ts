import { createHash, randomBytes } from 'node:crypto'
import { HttpException, HttpStatus } from '@nestjs/common'
import { decryptPhone, hashPhone } from '../common/crypto/phone-identity'
import type {
  ActionChallengeBinding,
  ActionTicketBinding,
  RebindTicketBinding,
  PartnerAccountVerificationMethod,
} from '../common/redis/partner-account-action-redis.types'
import { PASSWORD_PROOF_STATE } from './password-proof-state'

export type CurrentAdmin = {
  id: string
  role: string
  enabled: boolean
  deletedAt: Date | null
  tokenVersion: number
  passwordHash: string
}

export type CurrentPartner = {
  id: string
  enabled: boolean
  tokenVersion: number
  passwordHash: string
  passwordProofState: string
  phoneHash: string | null
  phoneEnc: string | null
  phoneVerifiedAt: Date | null
}

export type CurrentAccountActionState = { admin: CurrentAdmin; partner: CurrentPartner }

export interface OpaqueTicket {
  ticket: string
  digest: string
}

export function createOpaqueTicket(): OpaqueTicket {
  const ticket = randomBytes(32).toString('base64url')
  return { ticket, digest: digestOpaqueTicket(ticket) }
}

export function createChallengeId(): string {
  return randomBytes(32).toString('base64url')
}

export function digestOpaqueTicket(ticket: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw new Error('Invalid opaque ticket')
  return createHash('sha256').update(ticket).digest('hex')
}

export function partnerAccountActionRedisKey(
  kind: 'challenge' | 'verified' | 'rebind',
  id: string,
): string {
  if (!id || id.length > 256 || !/^[A-Za-z0-9:_-]+$/.test(id)) throw new Error('Invalid state identifier')
  const ns = partnerAccountActionNamespace()
  return `${ns}:${kind}:${id}`
}

export function parseChallengeBinding(raw: string): ActionChallengeBinding | null {
  const value = parseRecord(raw)
  if (!value || !isBaseBinding(value) || typeof value.challengeId !== 'string'
    || (value.verifyMethod !== 'sms' && value.verifyMethod !== 'password')) return null
  if (value.verifyMethod === 'sms') {
    if (typeof value.phoneHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.phoneHash)) return null
    const expectedPurpose = value.action === 'delete_account'
      ? 'partner_account_delete'
      : 'partner_phone_rebind_authorize'
    if (value.otpPurpose !== expectedPurpose) return null
  }
  return value as unknown as ActionChallengeBinding
}

export function parseActionTicketBinding(raw: string): ActionTicketBinding | null {
  const value = parseRecord(raw)
  return value && isBaseBinding(value) ? value as unknown as ActionTicketBinding : null
}

export function parseRebindTicketBinding(raw: string): RebindTicketBinding | null {
  const value = parseRecord(raw)
  if (!value || !isBaseBinding(value) || value.action !== 'rebind_phone'
    || typeof value.newPhoneHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.newPhoneHash)
    || typeof value.newPhoneEnc !== 'string' || !value.newPhoneEnc
    || typeof value.phoneMasked !== 'string' || !value.phoneMasked) return null
  return value as unknown as RebindTicketBinding
}

export function availablePartnerVerificationMethods(partner: CurrentPartner): PartnerAccountVerificationMethod[] {
  const methods: PartnerAccountVerificationMethod[] = []
  if (partner.phoneHash && partner.phoneEnc && partner.phoneVerifiedAt) methods.push('sms')
  if (partner.passwordProofState === PASSWORD_PROOF_STATE.OWNER_MANAGED) methods.push('password')
  return methods
}

export function trustedPartnerPhone(partner: CurrentPartner): string {
  if (!partner.phoneEnc || !partner.phoneHash || !partner.phoneVerifiedAt) {
    throw accountActionError(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'ACCOUNT_ACTION_METHOD_UNAVAILABLE',
      '目标账号没有可用的已验证手机号',
    )
  }
  let phone: string
  try {
    phone = decryptPhone(partner.phoneEnc)
  } catch {
    throw accountActionTicketStale()
  }
  if (hashPhone(phone) !== partner.phoneHash) throw accountActionTicketStale()
  return phone
}

export function accountActionError(
  status: HttpStatus,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): HttpException {
  return new HttpException({ error: { code, message, ...(details ? { details } : {}) } }, status)
}

export function accountActionChallengeUnavailable(): HttpException {
  return accountActionError(HttpStatus.CONFLICT, 'ACCOUNT_ACTION_CHALLENGE_UNAVAILABLE', '安全验证已过期、已使用或不匹配，请重新开始')
}

export function accountActionStepUpRequired(): HttpException {
  return accountActionError(HttpStatus.FORBIDDEN, 'ACCOUNT_ACTION_STEP_UP_REQUIRED', '请先完成目标账号验证')
}

export function accountActionTicketStale(): HttpException {
  return accountActionError(HttpStatus.CONFLICT, 'ACCOUNT_ACTION_TICKET_STALE', '账号状态已变化，请刷新后重新验证')
}

export function accountCredentialLocked(): HttpException {
  return accountActionError(HttpStatus.TOO_MANY_REQUESTS, 'ACCOUNT_CREDENTIAL_LOCKED', '目标账号凭据尝试次数过多，请稍后重新开始')
}

function partnerAccountActionNamespace(): string {
  const value = process.env['PARTNER_ACCOUNT_ACTION_REDIS_NAMESPACE']?.trim() || 'internal:partner-account-action'
  if (!/^[A-Za-z0-9:_-]{1,160}$/.test(value)) throw new Error('Invalid partner account action namespace')
  return value
}

function parseRecord(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function isBaseBinding(value: Record<string, unknown>): boolean {
  return typeof value.adminId === 'string' && value.adminId.length > 0
    && Number.isSafeInteger(value.adminTokenVersion) && Number(value.adminTokenVersion) >= 0
    && typeof value.orgId === 'string' && value.orgId.length > 0
    && typeof value.partnerId === 'string' && value.partnerId.length > 0
    && Number.isSafeInteger(value.partnerTokenVersion) && Number(value.partnerTokenVersion) >= 0
    && (value.action === 'delete_account' || value.action === 'rebind_phone')
}
