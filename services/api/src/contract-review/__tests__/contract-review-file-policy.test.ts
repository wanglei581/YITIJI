import 'reflect-metadata'
process.env['FILE_SIGNING_SECRET'] ||= 'contract-file-policy-secret-0123456789-abcdef'

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { KioskUploadOptionsDto } from '../../files/dto/kiosk-upload-options.dto'
import { validateUpload } from '../../files/file-validation'
import { FilesService } from '../../files/files.service'
import {
  CONTRACT_REVIEW_TTL_MS,
  allowedPoliciesForFile,
  defaultRetentionForUpload,
} from '../../files/retention-policy'
import { MemberAssetsService } from '../../member-assets/member-assets.service'
import { CreateScanTaskDto } from '../../scan-tasks/dto/create-scan-task.dto'
import { SCAN_TYPE_TO_PURPOSE } from '../../scan-tasks/scan-tasks.service'
import { generateObjectKey } from '../../storage/object-key'
import { CreateUploadSessionDto } from '../../upload-sessions/upload-sessions.dto'

const FIXED_NOW = new Date('2026-08-01T00:00:00.000Z')

interface FileHarnessRecord {
  id: string
  uploaderId: string | null
  endUserId: string | null
  ownerType: string | null
  ownerId: string | null
  purpose: string
  sensitiveLevel: string
  visibility: string
  status: string
  assetCategory: string
  sourceFileId: string | null
  retentionPolicy: string | null
  retentionSetBy: string | null
  retentionConsentAt: Date | null
  retentionConsentVersion: string | null
  retentionLockedReason: string | null
  deletedAt: Date | null
  deletedBy: string | null
  deleteReason: string | null
  expiresAt: Date | null
  bucket: string
  region: string
  storageKey: string
  filename: string
  mimeType: string
  sizeBytes: number
  sha256: string
  createdBy: string | null
  createdAt: Date
}

function makeFileAccessHarness(
  initialExpiresAt: Date | null,
  overrides: Partial<FileHarnessRecord> = {}
) {
  const record: FileHarnessRecord = {
    id: 'contract-file-1',
    uploaderId: null,
    endUserId: 'member-1',
    ownerType: 'user',
    ownerId: 'member-1',
    purpose: 'contract_upload',
    sensitiveLevel: 'highly_sensitive',
    visibility: 'private',
    status: 'active',
    assetCategory: 'original',
    sourceFileId: null,
    retentionPolicy: 'system_short',
    retentionSetBy: 'system',
    retentionConsentAt: null,
    retentionConsentVersion: null,
    retentionLockedReason: 'contract_review_session_only',
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    expiresAt: initialExpiresAt,
    bucket: 'private-files',
    region: 'local',
    storageKey: 'users/member-1/contract-reviews/contract-file-1.pdf',
    filename: 'contract.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 100,
    sha256: 'a'.repeat(64),
    createdBy: null,
    createdAt: FIXED_NOW,
    ...overrides,
  }
  let signedUrlCalls = 0
  let contentReadCalls = 0
  let deleteObjectCalls = 0
  const signedTtlSeconds: number[] = []
  const prisma = {
    fileObject: {
      findUnique: async () => record,
      update: async ({ data }: { data: Partial<FileHarnessRecord> }) => {
        Object.assign(record, data)
        return record
      },
    },
  }
  const storage = {
    signTtlSeconds: 1800,
    getDownloadUrl: (args: { ttlSeconds: number }) => {
      signedUrlCalls += 1
      signedTtlSeconds.push(args.ttlSeconds)
      return {
        url: 'https://files.local/contract-file-1',
        expiresAt: new Date(Date.now() + args.ttlSeconds * 1000),
      }
    },
    getObject: async () => {
      contentReadCalls += 1
      return Buffer.from('%PDF-1.4 contract')
    },
    deleteObject: async () => {
      deleteObjectCalls += 1
    },
  }

  return {
    record,
    service: new FilesService(prisma as never, {} as never, storage as never),
    calls: () => ({ signedUrlCalls, contentReadCalls, deleteObjectCalls, signedTtlSeconds }),
  }
}

async function expectFileNotFound(action: () => Promise<unknown>): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof NotFoundException)
    assert.equal(
      (error.getResponse() as { error?: { code?: string } }).error?.code,
      'FILE_NOT_FOUND'
    )
    assert.doesNotMatch(JSON.stringify(error.getResponse()), /expired|contract/i)
    return true
  })
}

test('contract upload is locked to an exact two-hour system session', () => {
  const decision = defaultRetentionForUpload({
    purpose: 'contract_upload',
    sensitiveLevel: 'highly_sensitive',
    ownerType: 'user',
    endUserId: 'member-1',
    now: FIXED_NOW,
  })

  assert.equal(CONTRACT_REVIEW_TTL_MS, 2 * 60 * 60 * 1000)
  assert.equal(decision.expiresAt?.toISOString(), '2026-08-01T02:00:00.000Z')
  assert.equal(decision.retentionPolicy, 'system_short')
  assert.equal(decision.retentionSetBy, 'system')
  assert.equal(decision.retentionConsentAt, null)
  assert.equal(decision.retentionConsentVersion, null)
  assert.deepEqual(
    allowedPoliciesForFile({ purpose: 'contract_upload', assetCategory: 'original' }),
    ['system_short']
  )
})

test('FilesService ignores weaker or longer client policy attempts for contract uploads', async () => {
  let createData: Record<string, unknown> | undefined
  const prisma = {
    fileObject: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        createData = data
        return {
          ...data,
          id: data.id as string,
          storageKey: data.storageKey as string,
          bucket: data.bucket as string,
          region: data.region as string,
          filename: data.filename as string,
          mimeType: data.mimeType as string,
          sizeBytes: data.sizeBytes as number,
          sha256: data.sha256 as string,
          expiresAt: data.expiresAt as Date,
        }
      },
    },
  }
  const storage = {
    defaultBucket: 'private-files',
    defaultRegion: 'local',
    signTtlSeconds: 60,
    putObject: async () => ({ sizeBytes: 15, sha256: 'a'.repeat(64) }),
    deleteObject: async () => undefined,
    getDownloadUrl: () => ({
      url: 'https://files.local/download',
      expiresAt: new Date(FIXED_NOW.getTime() + 60_000),
    }),
  }
  const service = new FilesService(prisma as never, {} as never, storage as never)
  const startedAt = Date.now()
  const clientAttempt = {
    buffer: Buffer.from('%PDF-1.4\n%%EOF\n', 'latin1'),
    filename: 'employment-contract.pdf',
    mimeType: 'application/pdf',
    purpose: 'contract_upload' as const,
    sensitiveLevel: 'normal' as const,
    uploaderId: null,
    endUserId: 'member-1',
    visibility: 'public',
    retentionPolicy: 'long_term',
    expiresAtOverride: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  }

  await service.upload(clientAttempt)
  const finishedAt = Date.now()

  assert.ok(createData)
  assert.equal(createData.sensitiveLevel, 'highly_sensitive')
  assert.equal(createData.visibility, 'private')
  assert.equal(createData.retentionPolicy, 'system_short')
  assert.equal(createData.retentionSetBy, 'system')
  assert.equal(createData.retentionConsentAt, null)
  assert.equal(createData.retentionConsentVersion, null)
  assert.equal(createData.retentionLockedReason, 'contract_review_session_only')
  const expiresAt = createData.expiresAt as Date
  assert.ok(
    expiresAt.getTime() >= startedAt + CONTRACT_REVIEW_TTL_MS &&
      expiresAt.getTime() <= finishedAt + CONTRACT_REVIEW_TTL_MS,
    'contract upload must ignore expiresAtOverride and expire exactly two hours from server upload time'
  )
})

test('FilesService blocks every access path once a contract file reaches expiresAt', async () => {
  const harness = makeFileAccessHarness(new Date(Date.now() + 60_900))
  const requester = { kind: 'member' as const, endUserId: 'member-1' }

  const signed = await harness.service.getAccessUrl('contract-file-1', requester, 'attachment')
  assert.match(signed.response.url, /^https:\/\/files\.local\//)
  assert.deepEqual(await harness.service.readContent('contract-file-1'), {
    buffer: Buffer.from('%PDF-1.4 contract'),
    mimeType: 'application/pdf',
    filename: 'contract.pdf',
    purpose: 'contract_upload',
  })
  const issuedTtlSeconds = harness.calls().signedTtlSeconds[0]
  assert.ok(issuedTtlSeconds && issuedTtlSeconds <= 60)
  assert.equal(harness.calls().contentReadCalls, 1)
  assert.equal(harness.calls().deleteObjectCalls, 0)

  assert.match(signed.response.printFileUrl ?? '', /^\/api\/v1\/files\//)
  // printFileUrl 即使在文件有效时签出，/content 也必须在逻辑过期后二次拒绝。
  harness.record.expiresAt = new Date(Date.now() - 1)
  await expectFileNotFound(() =>
    harness.service.getAccessUrl('contract-file-1', requester, 'attachment')
  )
  await expectFileNotFound(() =>
    harness.service.getAccessUrl('contract-file-1', requester, 'inline')
  )
  await expectFileNotFound(() =>
    harness.service.getSignedUrl('contract-file-1', {
      userId: 'admin-1',
      role: 'admin',
      orgId: null,
    })
  )
  await expectFileNotFound(() => harness.service.readContent('contract-file-1'))
  await expectFileNotFound(() =>
    harness.service.updateRetention('contract-file-1', requester, {
      retentionPolicy: 'months_3',
      consentVersion: 'file-retention-v1',
    })
  )
  assert.deepEqual(
    harness.calls(),
    {
      signedUrlCalls: 1,
      contentReadCalls: 1,
      deleteObjectCalls: 0,
      signedTtlSeconds: [issuedTtlSeconds],
    },
    'expired records must be rejected before signing or storage reads'
  )
})

test('download URL TTL never crosses file expiry and fails closed below one second', async () => {
  const nearExpiry = makeFileAccessHarness(new Date(Date.now() + 10_900))
  const requester = { kind: 'member' as const, endUserId: 'member-1' }

  const access = await nearExpiry.service.getAccessUrl('contract-file-1', requester, 'attachment')
  const legacy = await nearExpiry.service.getSignedUrl('contract-file-1', {
    userId: 'admin-1',
    role: 'admin',
    orgId: null,
  })
  assert.deepEqual(nearExpiry.calls().signedTtlSeconds, [10, 10])
  assert.ok(new Date(access.response.expiresAt).getTime() <= nearExpiry.record.expiresAt!.getTime())
  assert.ok(new Date(legacy.expiresAt).getTime() <= nearExpiry.record.expiresAt!.getTime())

  const longLived = makeFileAccessHarness(new Date(Date.now() + 24 * 60 * 60 * 1000), {
    purpose: 'print_doc',
    retentionLockedReason: null,
  })
  await longLived.service.getAccessUrl('contract-file-1', requester, 'inline')
  await longLived.service.getSignedUrl('contract-file-1', {
    userId: 'admin-1',
    role: 'admin',
    orgId: null,
  })
  assert.deepEqual(longLived.calls().signedTtlSeconds, [1800, 1800])

  const noExpiry = makeFileAccessHarness(null)
  await noExpiry.service.getAccessUrl('contract-file-1', requester, 'inline')
  assert.deepEqual(noExpiry.calls().signedTtlSeconds, [1800])

  const subsecond = makeFileAccessHarness(new Date(Date.now() + 500))
  await expectFileNotFound(() =>
    subsecond.service.getAccessUrl('contract-file-1', requester, 'inline')
  )
  assert.equal(subsecond.calls().signedUrlCalls, 0)
})

test('expired files remain deletable through system, owner, and admin privacy paths', async () => {
  const expiredAt = new Date(Date.now() - 60_000)

  const system = makeFileAccessHarness(expiredAt, {
    purpose: 'member_data_export',
    endUserId: 'member-system',
    ownerId: 'member-system',
  })
  const systemDeleted = await system.service.systemDelete('contract-file-1', 'privacy cleanup')
  assert.equal(systemDeleted.status, 'deleted')
  assert.equal(system.calls().deleteObjectCalls, 1)
  assert.ok(system.record.deletedAt)

  const owner = makeFileAccessHarness(expiredAt)
  const ownerDeleted = await owner.service.ownerDelete(
    'contract-file-1',
    { kind: 'member', endUserId: 'member-1' },
    'owner privacy deletion'
  )
  assert.equal(ownerDeleted.status, 'deleted')
  assert.equal(owner.calls().deleteObjectCalls, 1)

  const admin = makeFileAccessHarness(expiredAt)
  const adminDeleted = await admin.service.forceDelete(
    'contract-file-1',
    'admin-1',
    'admin privacy deletion'
  )
  assert.equal(adminDeleted.status, 'deleted')
  assert.equal(admin.calls().deleteObjectCalls, 1)

  const unauthorized = makeFileAccessHarness(expiredAt)
  await assert.rejects(
    () =>
      unauthorized.service.ownerDelete(
        'contract-file-1',
        { kind: 'member', endUserId: 'member-2' },
        'unauthorized deletion'
      ),
    ForbiddenException
  )
  assert.equal(unauthorized.calls().deleteObjectCalls, 0)
  assert.equal(unauthorized.record.deletedAt, null)
  await expectFileNotFound(() => unauthorized.service.readContent('contract-file-1'))
})

test('contract object keys use a user folder and anonymous keys never include session tokens', () => {
  assert.equal(
    generateObjectKey({
      purpose: 'contract_upload',
      ownerType: 'user',
      ownerId: 'member_1',
      fileId: 'fileabc123',
      ext: 'PDF',
    }),
    'users/member_1/contract-reviews/fileabc123.pdf'
  )

  const anonymousKey = generateObjectKey({
    purpose: 'contract_upload',
    ownerType: 'system',
    ownerId: null,
    fileId: 'filexyz789',
    ext: 'pdf',
    uploadSessionId: 'secretContractUploadToken',
  })
  assert.equal(anonymousKey, 'tmp/uploads/filexyz789/filexyz789.pdf')
  assert.doesNotMatch(anonymousKey, /secretContractUploadToken|employment-contract/i)
})

test('kiosk, upload-session, and scan DTOs accept only the new allowlisted values', async () => {
  const kioskValid = await validate(
    plainToInstance(KioskUploadOptionsDto, { purpose: 'contract_upload' })
  )
  const uploadSessionValid = await validate(
    plainToInstance(CreateUploadSessionDto, {
      purpose: 'contract_upload',
      mode: 'temporary',
      channel: 'phone_h5',
    })
  )
  const scanValid = await validate(
    plainToInstance(CreateScanTaskDto, { scanType: 'contract', terminalId: 'terminal-1' })
  )
  assert.equal(kioskValid.length, 0)
  assert.equal(uploadSessionValid.length, 0)
  assert.equal(scanValid.length, 0)

  assert.ok(
    (await validate(plainToInstance(KioskUploadOptionsDto, { purpose: 'contract_secret' })))
      .length > 0
  )
  assert.ok(
    (
      await validate(
        plainToInstance(CreateUploadSessionDto, {
          purpose: 'contract_secret',
          mode: 'temporary',
          channel: 'phone_h5',
        })
      )
    ).length > 0
  )
  assert.ok(
    (
      await validate(
        plainToInstance(CreateScanTaskDto, {
          scanType: 'contract_secret',
          terminalId: 'terminal-1',
        })
      )
    ).length > 0
  )
})

test('contract scans map to contract_upload', () => {
  assert.equal(SCAN_TYPE_TO_PURPOSE.contract, 'contract_upload')
  assert.equal(SCAN_TYPE_TO_PURPOSE.resume, 'resume_scan')
  assert.equal(SCAN_TYPE_TO_PURPOSE.document, 'print_doc')
})

test('member document queries exclude both contract purpose and locked session derivatives', async () => {
  const whereClauses: Array<Record<string, unknown>> = []
  const prisma = {
    fileObject: {
      count: async ({ where }: { where: Record<string, unknown> }) => {
        whereClauses.push(where)
        return 0
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        whereClauses.push(where)
        return []
      },
    },
  }
  const service = new MemberAssetsService(prisma as never)

  await service.listDocuments('member-1', { cursor: null, pageSize: 20 })

  assert.equal(whereClauses.length, 2)
  for (const where of whereClauses) {
    assert.deepEqual(where.purpose, { notIn: ['signature_image', 'contract_upload'] })
    assert.match(JSON.stringify(where), /contract_review_session_only/)
  }
})

test('invalid purpose validation fails closed without echoing contract text or tokens', () => {
  const secret = 'TOKEN-and-original-contract-text-must-not-be-reflected'
  const result = validateUpload({
    purpose: secret,
    mimeType: 'application/pdf',
    filename: 'contract.pdf',
    sizeBytes: 10,
    mode: 'proxy',
  })

  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.code, 'FILE_PURPOSE_INVALID')
    assert.doesNotMatch(result.message, /TOKEN|original-contract-text/)
  }
})

test('resume, print, and signature retention regressions remain unchanged', () => {
  const resume = defaultRetentionForUpload({
    purpose: 'resume_upload',
    sensitiveLevel: 'highly_sensitive',
    ownerType: 'user',
    endUserId: 'member-1',
    now: FIXED_NOW,
  })
  assert.equal(resume.retentionPolicy, 'months_3')
  assert.equal(resume.expiresAt?.toISOString(), '2026-10-30T00:00:00.000Z')
  assert.deepEqual(
    allowedPoliciesForFile({ purpose: 'signature_image', assetCategory: 'original' }),
    ['system_short']
  )
  assert.equal(
    validateUpload({
      purpose: 'print_doc',
      mimeType: 'application/pdf',
      filename: 'print.pdf',
      sizeBytes: 10,
      mode: 'proxy',
    }).ok,
    true
  )
})
