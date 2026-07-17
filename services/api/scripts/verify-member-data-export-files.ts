/**
 * 会员数据导出文件原语验证：内部生成、短期私有存储、通用读删禁止、专用读取与 orphan 补偿。
 * Run: pnpm --filter @ai-job-print/api exec tsx scripts/verify-member-data-export-files.ts
 */
import assert from 'node:assert/strict'

import type { AuthedUser } from '../src/common/decorators/current-user.decorator'
import { FilesController } from '../src/files/files.controller'
import { DEFAULT_SENSITIVE_BY_PURPOSE, validateUpload } from '../src/files/file-validation'
import { FilesService, type FileRequester } from '../src/files/files.service'
import { MemberDataExportFileService } from '../src/files/member-data-export-file.service'
import type { FilePurpose, FileUploadResponse } from '../src/files/file.types'
import { generateObjectKey } from '../src/storage/object-key'

const HOUR_MS = 60 * 60 * 1000
const EXPORT_PURPOSE: FilePurpose = 'member_data_export'
const MEMBER_MARKER = 'member-private-marker'
const FILE_ID = 'exportfileid'

type Upload = (args: Record<string, unknown>) => Promise<FileUploadResponse>
type FileRow = ReturnType<typeof makeFileRow>

interface HarnessOptions {
  createError?: Error
  deleteError?: Error
  putError?: Error
  headError?: Error
  getError?: Error
  headResult?: { sizeBytes: number; contentType: string | null; etag: string | null } | null
  readBuffer?: Buffer
  initialRecord?: FileRow
}

function responseCode(error: unknown): string | undefined {
  const response = (error as { getResponse?: () => unknown })?.getResponse?.() as
    | { error?: { code?: string } }
    | undefined
  return response?.error?.code
}

async function expectCode(action: () => Promise<unknown>, expectedCode: string): Promise<void> {
  try {
    await action()
    assert.fail(`expected ${expectedCode}`)
  } catch (error) {
    assert.equal(responseCode(error), expectedCode)
  }
}

function makeFileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FILE_ID,
    storageKey: 'exports/member-data/randomfileid.json',
    bucket: 'verify-private-bucket',
    region: 'verify-region',
    filename: 'member-data-export.json',
    mimeType: 'application/json',
    sizeBytes: 64,
    sha256: 'verify-sha256',
    uploaderId: null,
    endUserId: MEMBER_MARKER,
    ownerType: 'user',
    ownerId: MEMBER_MARKER,
    purpose: EXPORT_PURPOSE,
    sensitiveLevel: 'highly_sensitive',
    visibility: 'private',
    status: 'active',
    createdBy: 'system:member-data-export',
    assetCategory: 'derived',
    sourceFileId: null,
    expiresAt: new Date(Date.now() + HOUR_MS),
    retentionPolicy: 'system_short',
    retentionSetBy: 'system',
    retentionLockedReason: 'member_data_export',
    retentionConsentAt: null,
    retentionConsentVersion: null,
    deletedAt: null,
    deletedBy: null,
    deleteReason: null,
    createdAt: new Date(),
    ...overrides,
  }
}

function createHarness(options: HarnessOptions = {}) {
  let record: FileRow | null = options.initialRecord ?? null
  let createdData: Record<string, unknown> | null = null
  const deletedObjects: Array<{ objectKey: string; bucket: string | null | undefined }> = []
  const warnings: string[] = []
  let putCount = 0
  let getDownloadUrlCount = 0
  let headObjectCount = 0
  let getObjectCount = 0
  let cleanupWhere: Record<string, unknown> | null = null

  const prisma = {
    fileObject: {
      async create(input: { data: Record<string, unknown> }) {
        createdData = input.data
        if (options.createError) throw options.createError
        record = makeFileRow(input.data)
        return record
      },
      async findUnique() {
        return record
      },
      async findMany(input?: { where?: Record<string, unknown> }) {
        if (input?.where && Object.hasOwn(input.where, 'expiresAt')) {
          cleanupWhere = input.where
          return []
        }
        return record ? [record] : []
      },
      async update(input: { data: Record<string, unknown> }) {
        assert.ok(record)
        record = makeFileRow({ ...record, ...input.data })
        return record
      },
      async updateMany(input: { data: Record<string, unknown> }) {
        if (!record) return { count: 0 }
        record = makeFileRow({ ...record, ...input.data })
        return { count: 1 }
      },
    },
  }
  const storage = {
    defaultBucket: 'verify-private-bucket',
    defaultRegion: 'verify-region',
    signTtlSeconds: 60,
    async putObject(_objectKey: string, buffer: Buffer) {
      putCount += 1
      if (options.putError) throw options.putError
      return { sizeBytes: buffer.length, sha256: 'verify-sha256' }
    },
    async headObject() {
      headObjectCount += 1
      if (options.headError) throw options.headError
      if (Object.hasOwn(options, 'headResult')) return options.headResult
      const readable = options.readBuffer ?? Buffer.from('{"schemaVersion":"member-data-export-v1"}', 'utf8')
      return { sizeBytes: readable.length, contentType: 'application/json', etag: null }
    },
    async getObject() {
      getObjectCount += 1
      if (options.getError) throw options.getError
      return options.readBuffer ?? Buffer.from('{"schemaVersion":"member-data-export-v1"}', 'utf8')
    },
    async deleteObject(objectKey: string, bucket?: string | null) {
      deletedObjects.push({ objectKey, bucket })
      if (options.deleteError) throw options.deleteError
    },
    getDownloadUrl() {
      getDownloadUrlCount += 1
      return {
        url: 'https://invalid.example/ordinary-signed-url',
        expiresAt: new Date(Date.now() + 60_000),
      }
    },
  }

  const files = new FilesService(prisma as never, {} as never, storage as never)
  const exportFiles = new MemberDataExportFileService(prisma as never, storage as never)
  const safeLogger = {
    warn(message: string) {
      warnings.push(message)
    },
    log() {},
  }
  ;(files as unknown as { logger: typeof safeLogger }).logger = safeLogger
  ;(exportFiles as unknown as { logger: typeof safeLogger }).logger = safeLogger

  return {
    files,
    exportFiles,
    upload: files.upload.bind(files) as unknown as Upload,
    get record() {
      return record
    },
    get createdData() {
      return createdData
    },
    deletedObjects,
    warnings,
    get putCount() {
      return putCount
    },
    get getDownloadUrlCount() {
      return getDownloadUrlCount
    },
    get getObjectCount() {
      return getObjectCount
    },
    get headObjectCount() {
      return headObjectCount
    },
    get cleanupWhere() {
      return cleanupWhere
    },
  }
}

function externalExportUploadArgs(expiresAtOverride: Date): Record<string, unknown> {
  return {
    buffer: Buffer.from('{"schemaVersion":"member-data-export-v1"}', 'utf8'),
    filename: 'member-data-export.json',
    mimeType: 'application/json',
    purpose: EXPORT_PURPOSE,
    sensitiveLevel: 'highly_sensitive',
    uploaderId: null,
    endUserId: MEMBER_MARKER,
    assetCategory: 'derived',
    createdBy: 'system:member-data-export',
    serverGenerated: true,
    expiresAtOverride,
  }
}

const memberRequester: FileRequester = { kind: 'member', endUserId: MEMBER_MARKER }
const adminRequester: FileRequester = { kind: 'user', userId: 'admin-marker', role: 'admin', orgId: null }
const adminUser: AuthedUser = { userId: 'admin-marker', username: 'verify-admin', role: 'admin', orgId: null }

const checks: Array<{ name: string; run: () => void | Promise<void> }> = [
  {
    name: 'purpose 只允许 JSON 且默认 highly_sensitive',
    run() {
      const json = validateUpload({ purpose: EXPORT_PURPOSE, mimeType: 'application/json', filename: 'export.json', sizeBytes: 64, mode: 'proxy' })
      const pdf = validateUpload({ purpose: EXPORT_PURPOSE, mimeType: 'application/pdf', filename: 'export.pdf', sizeBytes: 64, mode: 'proxy' })
      assert.equal(json.ok, true)
      assert.equal(pdf.ok, false)
      assert.equal(DEFAULT_SENSITIVE_BY_PURPOSE[EXPORT_PURPOSE], 'highly_sensitive')
    },
  },
  {
    name: '对象 key 使用专用前缀且不含会员/请求标识',
    run() {
      const key = generateObjectKey({
        purpose: EXPORT_PURPOSE,
        ownerType: 'user',
        ownerId: MEMBER_MARKER,
        fileId: 'randomfileid',
        ext: 'json',
        uploadSessionId: 'request-private-marker',
      })
      assert.equal(key.startsWith('exports/member-data/'), true)
      assert.equal(key.includes(MEMBER_MARKER), false)
      assert.equal(key.includes('request-private-marker'), false)
    },
  },
  {
    name: '外部 multipart 与 upload-intent 不能伪造导出文件',
    async run() {
      const harness = createHarness()
      await expectCode(
        () => harness.upload({ ...externalExportUploadArgs(new Date(Date.now() + HOUR_MS)), serverGenerated: true }),
        'FILE_PURPOSE_SERVER_GENERATED_ONLY',
      )
      await expectCode(
        () => harness.files.createUploadIntent({
          body: { purpose: EXPORT_PURPOSE, filename: 'export.json', mimeType: 'application/json', sizeBytes: 64 },
          uploaderId: null,
          endUserId: MEMBER_MARKER,
        }),
        'FILE_PURPOSE_SERVER_GENERATED_ONLY',
      )
      assert.equal(harness.putCount, 0)
    },
  },
  {
    name: '真实 FilesController 不从外部 body 透传内部上传参数',
    async run() {
      let captured: Record<string, unknown> | null = null
      const filesStub = {
        async upload(args: Record<string, unknown>) {
          captured = args
          return {
            fileId: FILE_ID,
            filename: 'export.json',
            sizeBytes: 64,
            mimeType: 'application/json',
            sha256: 'verify-sha256',
            signedUrl: '',
            signedUrlExpiresAt: '',
            fileExpiresAt: null,
          }
        },
      }
      const controller = new FilesController(filesStub as never, {} as never, {} as never, {} as never, {} as never)
      await controller.upload(
        { buffer: Buffer.from('{}'), originalname: 'export.json', mimetype: 'application/json' } as Express.Multer.File,
        {
          purpose: EXPORT_PURPOSE,
          serverGenerated: true,
          createdBy: 'system:member-data-export',
          expiresAtOverride: new Date(Date.now() + HOUR_MS),
        } as never,
        adminUser,
      )
      assert.ok(captured)
      assert.equal(Object.hasOwn(captured, 'serverGenerated'), false)
      assert.equal(Object.hasOwn(captured, 'expiresAtOverride'), false)
      assert.equal(captured['createdBy'], adminUser.userId)
    },
  },
  {
    name: '服务端导出一次 create 落库且不生成/返回普通签名 URL',
    async run() {
      const harness = createHarness()
      const expiresAt = new Date(Date.now() + 23 * HOUR_MS)
      const uploaded = await harness.exportFiles.create({
        buffer: Buffer.from('{"schemaVersion":"member-data-export-v1"}', 'utf8'),
        endUserId: MEMBER_MARKER,
        expiresAt,
      })
      const data = harness.createdData
      assert.ok(data)
      assert.equal(data['visibility'], 'private')
      assert.equal(data['sensitiveLevel'], 'highly_sensitive')
      assert.equal(data['retentionPolicy'], 'system_short')
      assert.equal(data['retentionSetBy'], 'system')
      assert.equal(data['retentionLockedReason'], 'member_data_export')
      assert.equal((data['expiresAt'] as Date).getTime(), expiresAt.getTime())
      assert.equal(harness.getDownloadUrlCount, 0)
      assert.equal(Object.hasOwn(uploaded, 'signedUrl'), false)
      assert.equal(Object.hasOwn(uploaded, 'signedUrlExpiresAt'), false)
    },
  },
  {
    name: '到期时间必须 > now 且 <= now+24h，只接受合法 JSON',
    async run() {
      await expectCode(
        () => createHarness().exportFiles.create({ buffer: Buffer.from('{}'), endUserId: MEMBER_MARKER, expiresAt: new Date(Date.now() - HOUR_MS) }),
        'FILE_EXPORT_RETENTION_INVALID',
      )
      await expectCode(
        () => createHarness().exportFiles.create({ buffer: Buffer.from('{}'), endUserId: MEMBER_MARKER, expiresAt: new Date(Date.now() + 25 * HOUR_MS) }),
        'FILE_EXPORT_RETENTION_INVALID',
      )
      await expectCode(
        () => createHarness().exportFiles.create({ buffer: Buffer.from('not-json'), endUserId: MEMBER_MARKER, expiresAt: new Date(Date.now() + HOUR_MS) }),
        'FILE_EXPORT_CONTENT_INVALID',
      )
    },
  },
  {
    name: '所有普通签名/读取/删除路径都拒绝导出文件',
    async run() {
      const harness = createHarness({ initialRecord: makeFileRow() })
      await expectCode(() => harness.files.getAccessUrl(FILE_ID, memberRequester, 'attachment'), 'FILE_NOT_FOUND')
      await expectCode(() => harness.files.getSignedUrl(FILE_ID, adminUser), 'FILE_NOT_FOUND')
      await expectCode(() => harness.files.readContent(FILE_ID), 'FILE_NOT_FOUND')
      await expectCode(() => harness.files.readContentForEndUser(FILE_ID, MEMBER_MARKER), 'FILE_NOT_FOUND')
      await expectCode(() => harness.files.completeUpload(FILE_ID, memberRequester), 'FILE_NOT_FOUND')
      await expectCode(() => harness.files.writeRawUpload(FILE_ID, Buffer.from('{}')), 'FILE_NOT_FOUND')
      await expectCode(
        () => harness.files.updateRetention(FILE_ID, memberRequester, { retentionPolicy: 'months_3' }),
        'FILE_NOT_FOUND',
      )
      await expectCode(() => harness.files.ownerDelete(FILE_ID, memberRequester, 'verify'), 'FILE_NOT_FOUND')
      await expectCode(() => harness.files.ownerDelete(FILE_ID, adminRequester, 'verify'), 'FILE_NOT_FOUND')
      await expectCode(() => harness.files.forceDelete(FILE_ID, adminUser.userId, 'verify'), 'FILE_NOT_FOUND')
      assert.equal(harness.getDownloadUrlCount, 0)
      assert.equal(harness.getObjectCount, 0)
      assert.equal(harness.deletedObjects.length, 0)
    },
  },
  {
    name: '专用读取只返回当前 owner 的有效私有导出',
    async run() {
      const harness = createHarness({ initialRecord: makeFileRow() })
      const result = await harness.exportFiles.read(FILE_ID, MEMBER_MARKER, 1024)
      assert.equal(result.mimeType, 'application/json')
      assert.equal(result.sizeBytes <= 1024, true)
      assert.equal(result.buffer.length <= 1024, true)
      await expectCode(
        () => harness.exportFiles.read(FILE_ID, 'other-member-marker', 1024),
        'FILE_NOT_FOUND',
      )
      await expectCode(
        () => createHarness({ initialRecord: makeFileRow({ expiresAt: new Date(Date.now() - 1) }) }).exportFiles.read(FILE_ID, MEMBER_MARKER, 1024),
        'FILE_NOT_FOUND',
      )
      await expectCode(
        () => createHarness({ initialRecord: makeFileRow({ visibility: 'internal' }) }).exportFiles.read(FILE_ID, MEMBER_MARKER, 1024),
        'FILE_NOT_FOUND',
      )
      const storageFailure = createHarness({
        initialRecord: makeFileRow(),
        getError: new Error('storage failure at exports/member-data/private.json'),
      })
      try {
        await storageFailure.exportFiles.read(FILE_ID, MEMBER_MARKER, 1024)
        assert.fail('expected FILE_EXPORT_STORAGE_UNAVAILABLE')
      } catch (error) {
        assert.equal(responseCode(error), 'FILE_EXPORT_STORAGE_UNAVAILABLE')
        const response = (error as { getResponse?: () => unknown }).getResponse?.()
        assert.equal(JSON.stringify(response).includes('exports/member-data'), false)
      }
    },
  },
  {
    name: '专用读取在查询前/读取后都强制字节上限',
    async run() {
      const metadataTooLarge = createHarness({ initialRecord: makeFileRow({ sizeBytes: 2048 }) })
      await expectCode(
        () => metadataTooLarge.exportFiles.read(FILE_ID, MEMBER_MARKER, 1024),
        'FILE_EXPORT_TOO_LARGE',
      )
      assert.equal(metadataTooLarge.getObjectCount, 0)

      const bytesTooLarge = createHarness({
        initialRecord: makeFileRow({ sizeBytes: 32 }),
        headResult: { sizeBytes: 32, contentType: 'application/json', etag: null },
        readBuffer: Buffer.alloc(2048, 1),
      })
      await expectCode(
        () => bytesTooLarge.exportFiles.read(FILE_ID, MEMBER_MARKER, 1024),
        'FILE_EXPORT_TOO_LARGE',
      )

      const headTooLarge = createHarness({
        initialRecord: makeFileRow({ sizeBytes: 32 }),
        headResult: { sizeBytes: 2048, contentType: 'application/json', etag: null },
      })
      await expectCode(
        () => headTooLarge.exportFiles.read(FILE_ID, MEMBER_MARKER, 1024),
        'FILE_EXPORT_TOO_LARGE',
      )
      assert.equal(headTooLarge.headObjectCount, 1)
      assert.equal(headTooLarge.getObjectCount, 0)

      const missing = createHarness({ initialRecord: makeFileRow(), headResult: null })
      await expectCode(() => missing.exportFiles.read(FILE_ID, MEMBER_MARKER, 1024), 'FILE_NOT_FOUND')
      assert.equal(missing.getObjectCount, 0)

      const wrongMime = createHarness({
        initialRecord: makeFileRow(),
        headResult: { sizeBytes: 64, contentType: 'application/octet-stream', etag: null },
      })
      await expectCode(() => wrongMime.exportFiles.read(FILE_ID, MEMBER_MARKER, 1024), 'FILE_NOT_FOUND')
      assert.equal(wrongMime.getObjectCount, 0)
    },
  },
  {
    name: 'put/head/get 瞬时异常返回稳定可重试码且日志脱敏',
    async run() {
      const secretLikeMessage = 'transient failure at exports/member-data/private.json'
      const putFailed = createHarness({ putError: new TypeError(secretLikeMessage) })
      await expectCode(
        () => putFailed.exportFiles.create({
          buffer: Buffer.from('{}'),
          endUserId: MEMBER_MARKER,
          expiresAt: new Date(Date.now() + HOUR_MS),
        }),
        'FILE_EXPORT_STORAGE_UNAVAILABLE',
      )
      assert.equal(putFailed.warnings.length, 1)

      const headFailed = createHarness({ initialRecord: makeFileRow(), headError: new RangeError(secretLikeMessage) })
      await expectCode(
        () => headFailed.exportFiles.read(FILE_ID, MEMBER_MARKER, 1024),
        'FILE_EXPORT_STORAGE_UNAVAILABLE',
      )
      assert.equal(headFailed.getObjectCount, 0)

      const getFailed = createHarness({ initialRecord: makeFileRow(), getError: new SyntaxError(secretLikeMessage) })
      await expectCode(
        () => getFailed.exportFiles.read(FILE_ID, MEMBER_MARKER, 1024),
        'FILE_EXPORT_STORAGE_UNAVAILABLE',
      )

      const warnings = [...putFailed.warnings, ...headFailed.warnings, ...getFailed.warnings]
      assert.equal(warnings.length, 3)
      assert.equal(warnings.every((warning) => /stage=(put|head|get)/.test(warning)), true)
      assert.equal(warnings.every((warning) => /errorType=(TypeError|RangeError|SyntaxError)/.test(warning)), true)
      assert.equal(warnings.some((warning) => /exports\/member-data|private\.json|member-private-marker/.test(warning)), false)
    },
  },
  {
    name: '通用 list 对导出文件不返回 bucket/region/key/hash',
    async run() {
      const harness = createHarness({ initialRecord: makeFileRow() })
      const [item] = await harness.files.list({ purpose: EXPORT_PURPOSE })
      assert.ok(item)
      assert.equal(Boolean(item.bucket), false)
      assert.equal(Boolean(item.region), false)
      assert.equal(Boolean(item.objectKey), false)
      assert.equal(Boolean(item.sha256), false)
    },
  },
  {
    name: '只有 systemDelete 能清理导出文件，通用过期 cron 必须排除',
    async run() {
      const harness = createHarness({ initialRecord: makeFileRow() })
      const deleted = await harness.files.systemDelete(FILE_ID, 'member export reconciliation')
      assert.equal(deleted.status, 'deleted')
      assert.equal(harness.deletedObjects.length, 1)

      const cleanupHarness = createHarness({ initialRecord: makeFileRow() })
      await cleanupHarness.files.cleanupExpired('manual')
      const purposeFilter = cleanupHarness.cleanupWhere?.['purpose'] as { not?: string } | undefined
      assert.equal(purposeFilter?.not, EXPORT_PURPOSE)
    },
  },
  {
    name: '先持久化元数据再写对象，任何存储孤儿都保留可扫描记录',
    async run() {
      const createError = new Error('metadata persistence failed')
      const cleaned = createHarness({ createError })
      let thrown: unknown
      try {
        await cleaned.exportFiles.create({
          buffer: Buffer.from('{}'),
          endUserId: MEMBER_MARKER,
          expiresAt: new Date(Date.now() + HOUR_MS),
        })
      } catch (error) {
        thrown = error
      }
      assert.equal(thrown === createError, true)
      assert.equal(cleaned.putCount, 0, '元数据失败前不得产生无账本对象')
      assert.equal(cleaned.deletedObjects.length, 0)

      const cleanupFailed = createHarness({ putError: new Error('storage put failed'), deleteError: new Error('storage cleanup failed') })
      try {
        await cleanupFailed.exportFiles.create({
          buffer: Buffer.from('{}'),
          endUserId: MEMBER_MARKER,
          expiresAt: new Date(Date.now() + HOUR_MS),
        })
      } catch (error) {
        assert.equal(responseCode(error), 'FILE_EXPORT_STORAGE_UNAVAILABLE')
      }
      assert.ok(cleanupFailed.record, '补偿删除失败后必须保留 FileObject 供 reconciler 扫描')
      assert.equal(cleanupFailed.record?.deletedAt, null)
      assert.equal(cleanupFailed.warnings.length, 2)
      assert.equal(/member-private-marker|member-data-export\.json|exports\/member-data/i.test(cleanupFailed.warnings[0] ?? ''), false)

      const genericCreateError = new Error('generic metadata persistence failed')
      const generic = createHarness({ createError: genericCreateError })
      try {
        await generic.upload({
          buffer: Buffer.from('%PDF-1.4 verify'),
          filename: 'resume.pdf',
          mimeType: 'application/pdf',
          purpose: 'resume_upload',
          uploaderId: null,
        })
      } catch (error) {
        assert.equal(error === genericCreateError, true)
      }
      assert.equal(generic.deletedObjects.length, 1)
    },
  },
  {
    name: '既有 purpose 的校验和 object key 保持不变',
    run() {
      const validation = validateUpload({ purpose: 'resume_upload', mimeType: 'application/pdf', filename: 'resume.pdf', sizeBytes: 128, mode: 'proxy' })
      assert.equal(validation.ok, true)
      const key = generateObjectKey({ purpose: 'resume_upload', ownerType: 'user', ownerId: 'existing-owner', fileId: 'existingfile', ext: 'pdf' })
      assert.equal(key === 'users/existing-owner/resumes/existingfile.pdf', true)
    },
  },
]

async function main(): Promise<void> {
  let failed = 0
  for (const check of checks) {
    try {
      await check.run()
      console.log(`PASS ${check.name}`)
    } catch (error) {
      failed += 1
      console.error(`FAIL ${check.name}: ${error instanceof Error ? error.message : 'unknown verification error'}`)
    }
  }
  if (failed > 0) throw new Error(`member data export file verification failed (${failed})`)
  console.log(`member data export file verification passed (${checks.length} checks)`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
