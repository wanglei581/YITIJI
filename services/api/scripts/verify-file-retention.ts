import { strict as assert } from 'assert'
import {
  allowedPoliciesForFile,
  CURRENT_RETENTION_CONSENT_VERSION,
  computeRetentionDecision,
  defaultRetentionForUpload,
  isVisibleMemberFileWhere,
} from '../src/files/retention-policy'
import { FilesService } from '../src/files/files.service'

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

interface CleanupRecord {
  id: string
  storageKey: string
  bucket: string
  purpose: string
  sensitiveLevel: string
  expiresAt: Date | null
  deletedAt: Date | null
  status: string
}

async function verifyMalformedContractCleanup(): Promise<void> {
  const records = new Map<string, CleanupRecord>([
    [
      'contract-null-expiry',
      {
        id: 'contract-null-expiry',
        storageKey: 'contracts/malformed.pdf',
        bucket: 'private-files',
        purpose: 'contract_upload',
        sensitiveLevel: 'highly_sensitive',
        expiresAt: null,
        deletedAt: null,
        status: 'active',
      },
    ],
    [
      'resume-null-expiry',
      {
        id: 'resume-null-expiry',
        storageKey: 'resumes/long-term.pdf',
        bucket: 'private-files',
        purpose: 'resume_upload',
        sensitiveLevel: 'highly_sensitive',
        expiresAt: null,
        deletedAt: null,
        status: 'active',
      },
    ],
    [
      'expired-print',
      {
        id: 'expired-print',
        storageKey: 'prints/expired.pdf',
        bucket: 'private-files',
        purpose: 'print_doc',
        sensitiveLevel: 'normal',
        expiresAt: new Date(Date.now() - 60_000),
        deletedAt: null,
        status: 'active',
      },
    ],
  ])
  const deletedObjects: string[] = []
  let cleanupWhere: Record<string, unknown> | undefined
  const prisma = {
    fileObject: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        cleanupWhere = where
        const clauses = Array.isArray(where['OR']) ? (where['OR'] as Record<string, unknown>[]) : []
        const expiryClause = clauses.find((clause) => 'expiresAt' in clause && clause['expiresAt'])
        const fallbackExpiry = where['expiresAt'] as { lt?: Date } | undefined
        const cutoff =
          ((expiryClause?.['expiresAt'] as { lt?: Date } | undefined)?.lt ?? fallbackExpiry?.lt) ||
          new Date(0)
        const includesMissingContractExpiry = clauses.some(
          (clause) =>
            clause['purpose'] === 'contract_upload' &&
            Object.hasOwn(clause, 'expiresAt') &&
            clause['expiresAt'] === null
        )
        return Array.from(records.values()).filter(
          (record) =>
            !record.deletedAt &&
            record.purpose !== 'member_data_export' &&
            (Boolean(record.expiresAt && record.expiresAt < cutoff) ||
              (includesMissingContractExpiry &&
                record.purpose === 'contract_upload' &&
                record.expiresAt === null))
        )
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<CleanupRecord> }) => {
        const current = records.get(where.id)
        if (!current) throw new Error(`missing cleanup record ${where.id}`)
        const updated = { ...current, ...data }
        records.set(where.id, updated)
        return updated
      },
    },
    fairMaterialPrintBridge: {
      findFirst: async () => null,
    },
  }
  const storage = {
    deleteObject: async (storageKey: string) => {
      deletedObjects.push(storageKey)
    },
  }
  const service = FilesService.create(prisma, {}, storage)

  const result = await service.cleanupExpired('manual')

  assert.ok(cleanupWhere)
  assert.deepEqual(
    new Set(result.deletedFileIds),
    new Set(['contract-null-expiry', 'expired-print'])
  )
  assert.deepEqual(
    new Set(deletedObjects),
    new Set(['contracts/malformed.pdf', 'prints/expired.pdf'])
  )
  assert.ok(records.get('contract-null-expiry')?.deletedAt)
  assert.equal(records.get('contract-null-expiry')?.status, 'deleted')
  assert.equal(records.get('resume-null-expiry')?.deletedAt, null)
  assert.equal(records.get('resume-null-expiry')?.status, 'active')
}

async function main(): Promise<void> {
  assert.equal(
    defaultRetentionForUpload({
      purpose: 'resume_upload',
      sensitiveLevel: 'highly_sensitive',
      ownerType: 'user',
      endUserId: 'end-user-1',
      now,
    }).retentionPolicy,
    'months_3',
    '会员原始简历默认保存 3 个月'
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
    '证件文件必须保持系统短期保存'
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
    '匿名/系统打印文件不能被拉长到账号保存期'
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
    })
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
    })
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
    })
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
    })
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

  assert.deepEqual(allowedPoliciesForFile({ purpose: 'id_scan', assetCategory: 'original' }), [
    'system_short',
  ])
  assert.deepEqual(
    allowedPoliciesForFile({ purpose: 'resume_upload', assetCategory: 'original' }),
    ['months_3', 'months_6']
  )
  assert.deepEqual(
    allowedPoliciesForFile({ purpose: 'resume_upload', assetCategory: 'optimized' }),
    ['months_3', 'months_6', 'long_term']
  )

  assert.deepEqual(
    isVisibleMemberFileWhere('end-user-1', now),
    {
      endUserId: 'end-user-1',
      status: 'active',
      deletedAt: null,
      OR: [{ expiresAt: { gt: now } }, { expiresAt: null }],
    },
    '会员文档列表必须显式包含 expiresAt=null 的长期文件'
  )

  await verifyMalformedContractCleanup()
}

void main().then(() => console.log('verify:file-retention passed'))
