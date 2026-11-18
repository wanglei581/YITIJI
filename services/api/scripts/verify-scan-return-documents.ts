/**
 * 面板扫描回传与「我的文档」。
 *
 * 已登录会员的普通文档、简历、证件，回传成功后只出现在本人列表，文件名和时间照实，
 * 保存期限仍是现有扫描件口径。合同审查原件继续被用途和锁排除。
 * 游客不进任何人的列表。回传失败不落文件。到期清理留删除日志。
 *
 * 传 `--postgres` 时，DATABASE_URL 不是 PostgreSQL 就失败，避免在 SQLite 上变绿。
 */
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

process.env['FILE_SIGNING_SECRET'] ||= 'ci-only-test-signing-secret-0123456789abcdef'
process.env['TERMINAL_ADMIN_SECRET'] ||= 'ci-only-terminal-admin-secret'
process.env['TERMINAL_ACTION_TOKEN_SECRET'] ||= 'ci-only-terminal-action-secret'
process.env['JWT_SECRET'] ||= 'ci-only-jwt-secret-0123456789abcdef'
process.env['SECRET_ENCRYPTION_KEY'] ||= 'ci-only-encryption-key-0123456789abcdef'
process.env['SCAN_TERMINAL_QUIET_PERIOD_SECONDS'] = '0'
process.env['FILE_STORAGE_DRIVER'] = 'local'
// 本用例不碰招聘内容，取值与 CI 作业环境一致；托管声明门禁逐个文件查，要显式写出。
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const PAGE = { cursor: null, pageSize: 50 } as const

/** 1x1 JPEG，魔数 ff d8 ff。面板证件只收图片。 */
const TINY_JPEG = Buffer.from(
  'ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffc40014000100000000000000000000000000000000ffda0008010100003f007fff d9'.replace(
    / /g,
    ''
  ),
  'hex'
)

function tinyPdf(tag: string): Buffer {
  return Buffer.from(
    `%PDF-1.4\nscan-return ${tag} ${randomBytes(4).toString('hex')}\n%%EOF\n`,
    'latin1'
  )
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('getResponse' in error)) return undefined
  const response = (error as { getResponse: () => unknown }).getResponse()
  if (!response || typeof response !== 'object' || !('error' in response)) return undefined
  return (response as { error?: { code?: string } }).error?.code
}

function assertTtl(expiresAt: Date | null, expectedMs: number, label: string): void {
  assert.ok(expiresAt, `${label} 必须写上到期时间，不能因为进了「我的文档」就长期保存`)
  const delta = expiresAt.getTime() - Date.now()
  assert.ok(
    Math.abs(delta - expectedMs) < 2 * 60 * 1000,
    `${label} 到期时间应落在现有窗口 ${expectedMs}ms 附近，实际还剩 ${delta}ms`
  )
}

async function main(): Promise<void> {
  const postgresOnly = process.argv.includes('--postgres')
  const databaseUrl = process.env['DATABASE_URL'] ?? ''
  if (
    postgresOnly &&
    !databaseUrl.startsWith('postgresql://') &&
    !databaseUrl.startsWith('postgres://')
  ) {
    throw new Error(
      'SCAN_RETURN_DOCUMENTS_VERIFY_POSTGRES_REQUIRED: DATABASE_URL must be PostgreSQL'
    )
  }
  assertIsolatedVerificationDatabase()
  if (!process.env['FILE_STORAGE_DIR']) {
    const dir = join(tmpdir(), 's15b-scan-return-docs')
    mkdirSync(dir, { recursive: true })
    process.env['FILE_STORAGE_DIR'] = dir
  }

  const [
    { createPrismaClient },
    { AuditService },
    { FilesService },
    { MemberAssetsService },
    { ScanTasksService },
    { StorageService },
  ] = await Promise.all([
    import('../src/prisma/create-client'),
    import('../src/audit/audit.service'),
    import('../src/files/files.service'),
    import('../src/member-assets/member-assets.service'),
    import('../src/scan-tasks/scan-tasks.service'),
    import('../src/storage/storage.service'),
  ])

  const { client } = createPrismaClient(databaseUrl)
  await client.$connect()
  const suffix = randomBytes(4).toString('hex')
  const terminalId = `s15b_ret_${suffix}`
  const memberId = `s15b_owner_${suffix}`
  const otherId = `s15b_other_${suffix}`
  const caps = {
    assertUserTaskAllowed: async () => undefined,
    assertScanDeviceAllowed: async () => undefined,
  }
  const files = new FilesService(
    client as never,
    new AuditService(client as never),
    new StorageService()
  )
  const scan = new ScanTasksService(client as never, files, caps as never)
  const assets = new MemberAssetsService(client as never)

  async function deliver(
    scanType: 'document' | 'resume' | 'id' | 'contract',
    endUserId: string | null,
    filename: string,
    buffer: Buffer,
    mimeType: string
  ) {
    const created = await scan.create({ scanType, terminalId }, endUserId)
    await scan.ack(created.scanTaskId, endUserId, created.controlToken, terminalId)
    const lease = await scan.getScanDeliveryLease(terminalId)
    const delivered = await scan.deliverScanFile({
      terminalId,
      scanTaskId: created.scanTaskId,
      deliveryLease: lease.deliveryLease,
      buffer,
      filename,
      mimeType,
      observedAt: new Date().toISOString(),
      origin: 'watcher',
    })
    return delivered.fileId
  }

  try {
    await client.terminal.create({
      data: {
        id: terminalId,
        terminalCode: `S15B-${suffix}`,
        agentToken: randomBytes(16).toString('hex'),
        deviceFingerprint: `s15b-return-${suffix}`,
        enabled: true,
      },
    })
    await client.endUser.create({
      data: { id: memberId, phoneHash: `h_${memberId}`, phoneEnc: 'enc' },
    })
    await client.endUser.create({
      data: { id: otherId, phoneHash: `h_${otherId}`, phoneEnc: 'enc2' },
    })

    const documentName = `面板扫描-${suffix}.pdf`
    const resumeName = `面板简历-${suffix}.pdf`
    const idName = `面板证件-${suffix}.jpg`
    const contractName = `面板合同-${suffix}.pdf`
    const guestName = `游客扫描-${suffix}.pdf`
    const failedName = `失败扫描-${suffix}.txt`

    const documentId = await deliver(
      'document',
      memberId,
      documentName,
      tinyPdf('document'),
      'application/pdf'
    )
    const resumeId = await deliver(
      'resume',
      memberId,
      resumeName,
      tinyPdf('resume'),
      'application/pdf'
    )
    const idFileId = await deliver('id', memberId, idName, TINY_JPEG, 'image/jpeg')
    const contractId = await deliver(
      'contract',
      memberId,
      contractName,
      tinyPdf('contract'),
      'application/pdf'
    )
    const guestId = await deliver('document', null, guestName, tinyPdf('guest'), 'application/pdf')

    const ownerPage = await assets.listDocuments(memberId, PAGE)
    const otherPage = await assets.listDocuments(otherId, PAGE)
    const ownerIds = new Set(ownerPage.items.map((item) => item.id))
    const otherIds = new Set(otherPage.items.map((item) => item.id))

    const documentRow = await client.fileObject.findUniqueOrThrow({ where: { id: documentId } })
    const resumeRow = await client.fileObject.findUniqueOrThrow({ where: { id: resumeId } })
    const idRow = await client.fileObject.findUniqueOrThrow({ where: { id: idFileId } })
    const contractRow = await client.fileObject.findUniqueOrThrow({ where: { id: contractId } })
    const guestRow = await client.fileObject.findUniqueOrThrow({ where: { id: guestId } })

    const documentItem = ownerPage.items.find((item) => item.id === documentId)
    assert.ok(documentItem, '会员普通文档回传后必须出现在本人「我的文档」')
    assert.equal(documentItem.filename, documentName)
    assert.equal(documentItem.createdAt, documentRow.createdAt.toISOString())
    assert.equal(documentItem.downloadUrlPath, `/files/${documentId}/download-url`)
    assert.equal(documentRow.purpose, 'print_doc')
    assert.equal(documentRow.endUserId, memberId)
    assert.equal(documentRow.ownerType, 'user')
    assert.equal(documentRow.retentionPolicy, 'system_short')
    assert.equal(documentRow.retentionLockedReason, null)
    assertTtl(documentRow.expiresAt, 24 * HOUR_MS, '普通文档')
    assert.equal(otherIds.has(documentId), false, '普通文档不能出现在别人的「我的文档」')

    const resumeItem = ownerPage.items.find((item) => item.id === resumeId)
    assert.ok(resumeItem, '会员简历扫描回传后必须出现在本人「我的文档」')
    assert.equal(resumeItem.filename, resumeName)
    assert.equal(resumeItem.createdAt, resumeRow.createdAt.toISOString())
    assert.equal(resumeRow.purpose, 'resume_scan')
    assert.equal(resumeRow.retentionPolicy, 'months_3')
    assertTtl(resumeRow.expiresAt, 90 * DAY_MS, '简历扫描')
    assert.equal(otherIds.has(resumeId), false)

    const idItem = ownerPage.items.find((item) => item.id === idFileId)
    assert.ok(idItem, '会员证件扫描回传后必须出现在本人「我的文档」')
    assert.equal(idItem.filename, idName)
    assert.equal(idItem.createdAt, idRow.createdAt.toISOString())
    assert.equal(idRow.purpose, 'id_scan')
    assert.equal(idRow.retentionPolicy, 'system_short')
    assert.equal(idRow.sensitiveLevel, 'highly_sensitive')
    assertTtl(idRow.expiresAt, HOUR_MS, '证件扫描')
    assert.equal(otherIds.has(idFileId), false)

    assert.equal(contractRow.purpose, 'contract_upload')
    assert.equal(contractRow.endUserId, memberId)
    assert.equal(contractRow.retentionLockedReason, 'contract_review_session_only')
    assert.equal(contractRow.retentionPolicy, 'system_short')
    assertTtl(contractRow.expiresAt, 2 * HOUR_MS, '合同扫描')
    assert.equal(ownerIds.has(contractId), false, '合同审查原件仍不进「我的文档」')
    assert.equal(otherIds.has(contractId), false)

    assert.equal(guestRow.endUserId, null)
    assert.equal(guestRow.ownerType, 'system')
    assert.equal(guestRow.retentionLockedReason, null)
    assert.equal(guestRow.purpose, 'print_doc')
    assertTtl(guestRow.expiresAt, 24 * HOUR_MS, '游客扫描')
    assert.equal(ownerIds.has(guestId), false, '游客扫描不能进会员的「我的文档」')
    assert.equal(otherIds.has(guestId), false, '游客扫描不能进另一个会员的「我的文档」')

    const failed = await scan.create({ scanType: 'document', terminalId }, memberId)
    await scan.ack(failed.scanTaskId, memberId, failed.controlToken, terminalId)
    const failedLease = await scan.getScanDeliveryLease(terminalId)
    await assert.rejects(
      () =>
        scan.deliverScanFile({
          terminalId,
          scanTaskId: failed.scanTaskId,
          deliveryLease: failedLease.deliveryLease,
          buffer: Buffer.from('this is not a scan file'),
          filename: failedName,
          mimeType: 'text/plain',
          observedAt: new Date().toISOString(),
          origin: 'watcher',
        }),
      (error: unknown) => errorCode(error) === 'FILE_MIME_NOT_ALLOWED'
    )
    const failedTask = await client.scanTask.findUniqueOrThrow({ where: { id: failed.scanTaskId } })
    assert.equal(failedTask.status, 'failed')
    assert.equal(failedTask.fileId, null)
    assert.equal(await client.fileObject.count({ where: { filename: failedName } }), 0)
    const afterFailure = await assets.listDocuments(memberId, PAGE)
    assert.equal(
      afterFailure.items.some((item) => item.filename === failedName),
      false,
      '回传失败不能出现在「我的文档」'
    )

    await client.fileObject.update({
      where: { id: documentId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    })
    const cleaned = await files.cleanupExpired('cron')
    assert.equal(cleaned.deletedFileIds.includes(documentId), true)
    const tombstone = await client.fileObject.findUniqueOrThrow({ where: { id: documentId } })
    assert.equal(tombstone.status, 'deleted')
    assert.ok(tombstone.deletedAt)
    assert.equal(tombstone.deletedBy, 'auto')
    assert.equal(tombstone.deleteReason, 'cron cleanup of expired')
    const live = await assets.listDocuments(memberId, PAGE)
    assert.equal(
      live.items.some((item) => item.id === documentId),
      false,
      '过期扫描件必须从「我的文档」消失'
    )
    const deletedPage = await assets.listDeletedDocuments(memberId, PAGE)
    const deletedItem = deletedPage.items.find((item) => item.id === documentId)
    assert.ok(deletedItem, '过期清理必须留在本人的删除记录里')
    assert.equal(deletedItem.filename, documentName)
    assert.equal(deletedItem.deleteReason, 'cron cleanup of expired')
    assert.equal(deletedItem.deletedByKind, 'system')

    console.log(`scan-return-documents ok (${postgresOnly ? 'postgres' : 'sqlite'})`)
  } finally {
    await client.scanTask.deleteMany({ where: { terminalId } }).catch(() => undefined)
    await client.fileObject
      .deleteMany({
        where: {
          OR: [{ endUserId: memberId }, { endUserId: otherId }, { filename: { contains: suffix } }],
        },
      })
      .catch(() => undefined)
    await client.endUser
      .deleteMany({ where: { id: { in: [memberId, otherId] } } })
      .catch(() => undefined)
    await client.terminal.deleteMany({ where: { id: terminalId } }).catch(() => undefined)
    await client.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
