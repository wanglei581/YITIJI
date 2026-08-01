import 'reflect-metadata'

import assert from 'node:assert/strict'
import { test } from 'node:test'
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
