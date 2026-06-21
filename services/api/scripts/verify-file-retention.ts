import { strict as assert } from 'assert'
import {
  allowedPoliciesForFile,
  CURRENT_RETENTION_CONSENT_VERSION,
  computeRetentionDecision,
  defaultRetentionForUpload,
  isVisibleMemberFileWhere,
} from '../src/files/retention-policy'

const now = new Date('2026-06-21T00:00:00.000Z')

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

function assertDecisionDays(policy: 'months_3' | 'months_6', expectedDays: number): void {
  const decision = computeRetentionDecision({
    now,
    policy,
    purpose: 'resume_upload',
    sensitiveLevel: 'highly_sensitive',
    assetCategory: 'original',
    ownerType: 'user',
    endUserId: 'end-user-1',
    requesterKind: 'member',
    requesterEndUserId: 'end-user-1',
    consentVersion: policy === 'months_6' ? CURRENT_RETENTION_CONSENT_VERSION : undefined,
  })
  assert.equal(decision.retentionPolicy, policy)
  assert.ok(decision.expiresAt)
  assert.equal(daysBetween(now, decision.expiresAt), expectedDays)
}

function assertThrowsCode(code: string, fn: () => unknown): void {
  assert.throws(fn, (err) => {
    return err instanceof Error && 'code' in err && (err as { code: string }).code === code
  })
}

function main(): void {
  assert.equal(
    defaultRetentionForUpload({
      purpose: 'resume_upload',
      sensitiveLevel: 'highly_sensitive',
      ownerType: 'user',
      endUserId: 'end-user-1',
      now,
    }).retentionPolicy,
    'months_3',
    '会员原始简历默认保存 3 个月',
  )
  assert.equal(
    defaultRetentionForUpload({
      purpose: 'id_scan',
      sensitiveLevel: 'highly_sensitive',
      ownerType: 'user',
      endUserId: 'end-user-1',
      now,
    }).retentionPolicy,
    'system_short',
    '证件文件必须保持系统短期保存',
  )
  assert.equal(
    defaultRetentionForUpload({
      purpose: 'print_doc',
      sensitiveLevel: 'normal',
      ownerType: 'system',
      endUserId: null,
      now,
    }).retentionPolicy,
    'system_short',
    '匿名/系统打印文件不能被拉长到账号保存期',
  )

  assertDecisionDays('months_3', 90)
  assertDecisionDays('months_6', 180)

  assertThrowsCode('RETENTION_LONG_TERM_ORIGINAL_FORBIDDEN', () =>
    computeRetentionDecision({
      now,
      policy: 'long_term',
      purpose: 'resume_upload',
      sensitiveLevel: 'highly_sensitive',
      assetCategory: 'original',
      ownerType: 'user',
      endUserId: 'end-user-1',
      requesterKind: 'member',
      requesterEndUserId: 'end-user-1',
      consentVersion: CURRENT_RETENTION_CONSENT_VERSION,
    }),
  )
  assertThrowsCode('RETENTION_ID_SCAN_LOCKED', () =>
    computeRetentionDecision({
      now,
      policy: 'months_6',
      purpose: 'id_scan',
      sensitiveLevel: 'highly_sensitive',
      assetCategory: 'original',
      ownerType: 'user',
      endUserId: 'end-user-1',
      requesterKind: 'member',
      requesterEndUserId: 'end-user-1',
      consentVersion: 'privacy-v1',
    }),
  )
  assertThrowsCode('RETENTION_CONSENT_REQUIRED', () =>
    computeRetentionDecision({
      now,
      policy: 'long_term',
      purpose: 'resume_upload',
      sensitiveLevel: 'sensitive',
      assetCategory: 'optimized',
      ownerType: 'user',
      endUserId: 'end-user-1',
      requesterKind: 'member',
      requesterEndUserId: 'end-user-1',
    }),
  )
  assertThrowsCode('RETENTION_CONSENT_INVALID', () =>
    computeRetentionDecision({
      now,
      policy: 'months_6',
      purpose: 'resume_upload',
      sensitiveLevel: 'highly_sensitive',
      assetCategory: 'original',
      ownerType: 'user',
      endUserId: 'end-user-1',
      requesterKind: 'member',
      requesterEndUserId: 'end-user-1',
      consentVersion: 'invalid-version',
    }),
  )

  const longTerm = computeRetentionDecision({
    now,
    policy: 'long_term',
    purpose: 'resume_upload',
    sensitiveLevel: 'sensitive',
    assetCategory: 'optimized',
    ownerType: 'user',
    endUserId: 'end-user-1',
    requesterKind: 'member',
    requesterEndUserId: 'end-user-1',
    consentVersion: CURRENT_RETENTION_CONSENT_VERSION,
  })
  assert.equal(longTerm.expiresAt, null, '长期保存用 expiresAt=null 表达')
  assert.equal(longTerm.retentionSetBy, 'user')
  assert.equal(longTerm.retentionConsentVersion, CURRENT_RETENTION_CONSENT_VERSION)
  assert.ok(longTerm.retentionConsentAt)

  assert.deepEqual(allowedPoliciesForFile({ purpose: 'id_scan', assetCategory: 'original' }), ['system_short'])
  assert.deepEqual(allowedPoliciesForFile({ purpose: 'resume_upload', assetCategory: 'original' }), ['months_3', 'months_6'])
  assert.deepEqual(allowedPoliciesForFile({ purpose: 'resume_upload', assetCategory: 'optimized' }), ['months_3', 'months_6', 'long_term'])

  assert.deepEqual(
    isVisibleMemberFileWhere('end-user-1', now),
    {
      endUserId: 'end-user-1',
      status: 'active',
      deletedAt: null,
      OR: [{ expiresAt: { gt: now } }, { expiresAt: null }],
    },
    '会员文档列表必须显式包含 expiresAt=null 的长期文件',
  )
}

main()
console.log('verify:file-retention passed')
