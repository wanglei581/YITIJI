import {
  FILE_DEFAULT_TTL_HOURS,
  FILE_RETENTION_CONSENT_VERSION,
  type FileAssetCategory,
  type FileOwnerType,
  type FilePurpose,
  type FileRetentionPolicy,
  type FileRetentionSetBy,
  type FileSensitiveLevel,
} from './file.types'

const DAY_MS = 24 * 60 * 60 * 1000

const MEMBER_DEFAULT_PURPOSES = new Set<FilePurpose>(['resume_upload', 'resume_scan', 'cover_letter'])

export const CURRENT_RETENTION_CONSENT_VERSION = FILE_RETENTION_CONSENT_VERSION

export class RetentionPolicyError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export interface RetentionDecision {
  expiresAt: Date | null
  retentionPolicy: FileRetentionPolicy
  retentionSetBy: FileRetentionSetBy
  retentionConsentAt: Date | null
  retentionConsentVersion: string | null
}

export interface RetentionUploadInput {
  purpose: FilePurpose
  sensitiveLevel: FileSensitiveLevel
  ownerType: FileOwnerType | null
  endUserId: string | null
  now?: Date
}

export interface RetentionUpdateInput extends RetentionUploadInput {
  policy: FileRetentionPolicy
  assetCategory: FileAssetCategory
  requesterKind: 'member' | 'user'
  requesterEndUserId?: string | null
  consentVersion?: string
  retentionLockedReason?: string | null
}

export function defaultRetentionForUpload(input: RetentionUploadInput): RetentionDecision {
  const now = input.now ?? new Date()
  // 会员账号内简历类文件默认保存 90 天；证件、匿名、系统和机构素材保持短 TTL。
  const policy =
    input.ownerType === 'user' && input.endUserId && MEMBER_DEFAULT_PURPOSES.has(input.purpose)
      ? 'months_3'
      : 'system_short'
  return buildDecision({
    policy,
    sensitiveLevel: input.sensitiveLevel,
    now,
    setBy: 'system',
    consentVersion: null,
  })
}

export function computeRetentionDecision(input: RetentionUpdateInput): RetentionDecision {
  const now = input.now ?? new Date()
  assertCanSetRetention(input)
  return buildDecision({
    policy: input.policy,
    sensitiveLevel: input.sensitiveLevel,
    now,
    setBy: 'user',
    consentVersion: requiresConsent(input.policy) ? input.consentVersion ?? null : null,
  })
}

export function allowedPoliciesForFile(input: {
  purpose: FilePurpose | string
  assetCategory: FileAssetCategory | string
}): FileRetentionPolicy[] {
  if (input.purpose === 'id_scan' || input.purpose === 'id_photo_print') return ['system_short']
  if (input.assetCategory === 'optimized' || input.assetCategory === 'derived') {
    return ['months_3', 'months_6', 'long_term']
  }
  return ['months_3', 'months_6']
}

export function isVisibleMemberFileWhere(endUserId: string, now: Date) {
  return {
    endUserId,
    status: 'active',
    deletedAt: null,
    OR: [{ expiresAt: { gt: now } }, { expiresAt: null }],
  }
}

function assertCanSetRetention(input: RetentionUpdateInput): void {
  if (input.requesterKind !== 'member') {
    throw new RetentionPolicyError('RETENTION_MEMBER_REQUIRED', '仅允许会员本人修改文件保存期限')
  }
  if (!input.endUserId || input.ownerType !== 'user') {
    throw new RetentionPolicyError('RETENTION_MEMBER_FILE_REQUIRED', '仅会员账号内文件可修改保存期限')
  }
  if (input.requesterEndUserId !== input.endUserId) {
    throw new RetentionPolicyError('RETENTION_ACCESS_DENIED', '无权修改他人文件保存期限')
  }
  if (input.retentionLockedReason) {
    throw new RetentionPolicyError('RETENTION_LOCKED', '该文件保存策略已被锁定')
  }
  if ((input.purpose === 'id_scan' || input.purpose === 'id_photo_print') && input.policy !== 'system_short') {
    throw new RetentionPolicyError('RETENTION_ID_SCAN_LOCKED', '证件类文件只能使用系统短期保存')
  }
  if (!allowedPoliciesForFile(input).includes(input.policy)) {
    if (input.assetCategory === 'original' && input.policy === 'long_term') {
      throw new RetentionPolicyError('RETENTION_LONG_TERM_ORIGINAL_FORBIDDEN', '原始文件首批不支持长期保存')
    }
    throw new RetentionPolicyError('RETENTION_POLICY_NOT_ALLOWED', '该文件不支持所选保存期限')
  }
  if (requiresConsent(input.policy) && !input.consentVersion?.trim()) {
    throw new RetentionPolicyError('RETENTION_CONSENT_REQUIRED', '延长保存期限需要用户确认保存条款')
  }
  if (requiresConsent(input.policy) && input.consentVersion !== CURRENT_RETENTION_CONSENT_VERSION) {
    throw new RetentionPolicyError('RETENTION_CONSENT_INVALID', '保存条款版本无效或已过期')
  }
}

function buildDecision(args: {
  policy: FileRetentionPolicy
  sensitiveLevel: FileSensitiveLevel
  now: Date
  setBy: FileRetentionSetBy
  consentVersion: string | null
}): RetentionDecision {
  return {
    expiresAt: expiresAtForPolicy(args.policy, args.sensitiveLevel, args.now),
    retentionPolicy: args.policy,
    retentionSetBy: args.setBy,
    retentionConsentAt: requiresConsent(args.policy) ? args.now : null,
    retentionConsentVersion: requiresConsent(args.policy) ? args.consentVersion : null,
  }
}

function expiresAtForPolicy(
  policy: FileRetentionPolicy,
  sensitiveLevel: FileSensitiveLevel,
  now: Date,
): Date | null {
  if (policy === 'months_3') return new Date(now.getTime() + 90 * DAY_MS)
  if (policy === 'months_6') return new Date(now.getTime() + 180 * DAY_MS)
  if (policy === 'long_term') return null
  const ttlHours = FILE_DEFAULT_TTL_HOURS[sensitiveLevel]
  return new Date(now.getTime() + ttlHours * 60 * 60 * 1000)
}

function requiresConsent(policy: FileRetentionPolicy): boolean {
  return policy === 'months_6' || policy === 'long_term'
}
