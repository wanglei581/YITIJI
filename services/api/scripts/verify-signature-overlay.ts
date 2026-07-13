/**
 * 签名盖章（目标文件 + 签名/印章素材合成）service 级验证。
 *
 * 用内存态 Fake Prisma / Storage / Audit / Files / Redis 直接跑通
 * PrintConversionService.composeSignatureOverlay，覆盖：
 *   1.  目标文件不存在 / 游客访问凭证不匹配 → SIGN_OVERLAY_TARGET_NOT_FOUND
 *   2.  签名素材不存在 / 游客访问凭证不匹配 → SIGN_OVERLAY_SIGNATURE_NOT_FOUND
 *   3.  会员越权访问他人目标文件 → SIGN_OVERLAY_TARGET_NOT_FOUND（不泄露"文件存在但无权限"）
 *   4.  会员越权访问他人签名素材 → SIGN_OVERLAY_SIGNATURE_NOT_FOUND
 *   5.  目标文件 purpose 不是 print_doc（如误传一个 signature_source 文件当目标）→ NOT_FOUND
 *      （verifySourceOwnership 按 expectedPurpose 精确匹配，purpose 不符按不存在处理）
 *   6.  目标文件 mime 不支持（webp）→ SIGN_OVERLAY_TARGET_TYPE_UNSUPPORTED
 *   7.  签名素材 mime 不支持（webp）→ SIGN_OVERLAY_SIGNATURE_TYPE_UNSUPPORTED
 *   8.  签名素材超过 2MB → SIGN_OVERLAY_SIGNATURE_TOO_LARGE
 *   9.  成功合成 → 输出 1 页、内部 HMAC printFileUrl、产物 purpose=print_doc、审计记录正确
 *  10.  5 个位置预设 × 3 个大小档位全矩阵成功跑通（捕获坐标计算的 NaN / 越界问题）
 *  11.  DTO 层 class-validator 校验：合法 position/size 通过；非法枚举被拒绝
 *      （service 本身不重复做枚举校验，交由 HTTP 边界的 ValidationPipe 负责，这里直接
 *      对 DTO 类做单测级验证，不依赖 Nest 应用启动）
 *  12.  signature_source 默认 sensitiveLevel 为 'sensitive'（短期即焚，非长期保存）
 *
 * 运行：pnpm --filter @ai-job-print/api verify:signature-overlay
 */
import 'reflect-metadata'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-signature-overlay-secret-0123456789-abcdef'

import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { validate } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { PrintConversionService } from '../src/print-conversion/print-conversion.service'
import { ComposeSignatureOverlayDto } from '../src/print-conversion/print-conversion.dto'
import { signFileUrl } from '../src/files/signing'
import { DEFAULT_SENSITIVE_BY_PURPOSE } from '../src/files/file-validation'

function pass(m: string) {
  console.log(`  PASS ${m}`)
}
function fail(m: string): never {
  console.error(`  FAIL ${m}`)
  process.exit(1)
}

function errCode(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown; response?: unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } }
    | undefined
  return resp?.error?.code
}

async function expectCode(fn: () => Promise<unknown>, code: string, label: string): Promise<void> {
  try {
    await fn()
    fail(`${label} — 期望抛 ${code}，但未抛`)
  } catch (e) {
    const c = errCode(e)
    if (c !== code) fail(`${label} — 期望 ${code}，实际: ${c ?? (e as Error).message}`)
    pass(label)
  }
}

// ── 真实可解码的最小 PNG fixture（与 verify-print-conversion.ts 同款生成方式）──────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii')
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(data.length, 0)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf])
}

function makePng(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(width, 0)
  ihdrData.writeUInt32BE(height, 4)
  ihdrData[8] = 8
  ihdrData[9] = 2
  ihdrData[10] = 0
  ihdrData[11] = 0
  ihdrData[12] = 0
  const ihdr = pngChunk('IHDR', ihdrData)

  const rowBytes = 1 + width * 3
  const raw = Buffer.alloc(rowBytes * height)
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowBytes
    raw[rowStart] = 0
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 3
      raw[px] = Math.floor((x * 255) / Math.max(width - 1, 1))
      raw[px + 1] = Math.floor((y * 255) / Math.max(height - 1, 1))
      raw[px + 2] = 128
    }
  }
  const idat = pngChunk('IDAT', zlib.deflateSync(raw))
  const iend = pngChunk('IEND', Buffer.alloc(0))

  return Buffer.concat([signature, ihdr, idat, iend])
}

// ── Fake 依赖（与 verify-print-conversion.ts 同款结构）──────────────────────

interface StoredFile {
  id: string
  storageKey: string
  bucket: string
  mimeType: string
  sizeBytes: number
  sha256: string
  purpose: string
  status: string
  deletedAt: Date | null
  expiresAt: Date | null
  endUserId: string | null
  ownerType: string
  ownerId: string | null
}

class FakePrisma {
  readonly files = new Map<string, StoredFile>()
  readonly fileObject = {
    findUnique: async ({ where }: { where: { id: string } }) => this.files.get(where.id) ?? null,
  }
}

class FakeStorage {
  readonly objects = new Map<string, Buffer>()
  async getObject(objectKey: string): Promise<Buffer> {
    const buf = this.objects.get(objectKey)
    if (!buf) throw new Error(`object not found: ${objectKey}`)
    return buf
  }
}

class FakeAudit {
  readonly entries: Array<{ action: string; targetId?: string | null; payload?: Record<string, unknown> }> = []
  async write(args: { action: string; targetId?: string | null; payload?: Record<string, unknown> }): Promise<string | null> {
    this.entries.push(args)
    return 'audit_1'
  }
}

class FakeFiles {
  private next = 1
  readonly uploaded: Array<{ purpose: string }> = []
  constructor(private readonly prisma: FakePrisma) {}
  async upload(args: {
    buffer: Buffer
    filename: string
    mimeType: string
    purpose: string
    uploaderId?: string | null
    endUserId?: string | null
    assetCategory?: string
    sourceFileId?: string | null
    createdBy?: string | null
  }): Promise<{
    fileId: string
    filename: string
    sizeBytes: number
    mimeType: string
    sha256: string
    signedUrl: string
    signedUrlExpiresAt: string
    fileExpiresAt: string | null
  }> {
    const id = `out_${this.next++}`
    const record: StoredFile = {
      id,
      storageKey: `key_${id}`,
      bucket: 'local-fs',
      mimeType: args.mimeType,
      sizeBytes: args.buffer.length,
      sha256: `sha_${id}`,
      purpose: args.purpose,
      status: 'active',
      deletedAt: null,
      expiresAt: null,
      endUserId: args.endUserId ?? null,
      ownerType: args.endUserId ? 'user' : 'system',
      ownerId: args.endUserId ?? null,
    }
    this.prisma.files.set(id, record)
    this.uploaded.push({ purpose: args.purpose })
    return {
      fileId: id,
      filename: args.filename,
      sizeBytes: record.sizeBytes,
      mimeType: record.mimeType,
      sha256: record.sha256,
      signedUrl: `https://files.local/${id}`,
      signedUrlExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      fileExpiresAt: null,
    }
  }
}

class FakeRedis {
  private readonly values = new Map<string, { value: string; expiresAt: number }>()
  async get(key: string): Promise<string | null> {
    const entry = this.values.get(key)
    if (!entry) return null
    if (entry.expiresAt <= Date.now()) {
      this.values.delete(key)
      return null
    }
    return entry.value
  }
  async setEx(key: string, ttlSeconds: number, value: string): Promise<void> {
    this.values.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
  }
  async setNxEx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (await this.get(key)) return false
    this.values.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
    return true
  }
  async del(key: string): Promise<number> {
    return this.values.delete(key) ? 1 : 0
  }
}

// ── 测试固定件 ────────────────────────────────────────────────────────────

function file(overrides: Partial<StoredFile> = {}): StoredFile {
  return {
    id: overrides.id ?? 'file_1',
    storageKey: 'key_1',
    bucket: 'local-fs',
    mimeType: 'image/png',
    sizeBytes: 1000,
    sha256: 'sha_1',
    purpose: 'print_doc',
    status: 'active',
    deletedAt: null,
    expiresAt: null,
    endUserId: null,
    ownerType: 'system',
    ownerId: null,
    ...overrides,
  }
}

function makeService() {
  const prisma = new FakePrisma()
  const storage = new FakeStorage()
  const audit = new FakeAudit()
  const files = new FakeFiles(prisma)
  const redis = new FakeRedis()
  const service = new PrintConversionService(prisma as never, storage as never, audit as never, files as never, redis as never)
  return { service, prisma, storage, audit, files, redis }
}

function seedFile(
  prisma: FakePrisma,
  storage: FakeStorage,
  id: string,
  dims: { width: number; height: number },
  overrides: Partial<StoredFile> = {},
): StoredFile {
  const record = file({ id, storageKey: `key_${id}`, ...overrides })
  prisma.files.set(id, record)
  storage.objects.set(record.storageKey, makePng(dims.width, dims.height))
  return record
}

function accessUrl(fileId: string): string {
  return signFileUrl(fileId, 30 * 60 * 1000).url
}

function tamperedAccessUrl(fileId: string): string {
  const farFutureMs = Date.now() + 5 * 60 * 1000
  return `/api/v1/files/${fileId}/content?expires=${farFutureMs}&sig=${'0'.repeat(64)}`
}

async function main() {
  // 1) 目标文件不存在（游客访问凭证与 fileId 不匹配）→ SIGN_OVERLAY_TARGET_NOT_FOUND
  {
    const { service, prisma, storage } = makeService()
    seedFile(prisma, storage, 't1', { width: 200, height: 300 })
    seedFile(prisma, storage, 's1', { width: 40, height: 20 }, { purpose: 'signature_source' })
    await expectCode(
      () =>
        service.composeSignatureOverlay({
          target: { fileId: 't1', fileAccessUrl: accessUrl('does-not-exist') },
          signature: { fileId: 's1', fileAccessUrl: accessUrl('s1') },
          position: 'bottom-right',
          size: 'medium',
          endUserId: null,
        }),
      'SIGN_OVERLAY_TARGET_NOT_FOUND',
      '目标文件访问凭证不匹配拒绝',
    )
  }

  // 2) 签名素材不存在（游客访问凭证不匹配）→ SIGN_OVERLAY_SIGNATURE_NOT_FOUND
  {
    const { service, prisma, storage } = makeService()
    seedFile(prisma, storage, 't2', { width: 200, height: 300 })
    seedFile(prisma, storage, 's2', { width: 40, height: 20 }, { purpose: 'signature_source' })
    await expectCode(
      () =>
        service.composeSignatureOverlay({
          target: { fileId: 't2', fileAccessUrl: accessUrl('t2') },
          signature: { fileId: 's2', fileAccessUrl: accessUrl('does-not-exist') },
          position: 'bottom-right',
          size: 'medium',
          endUserId: null,
        }),
      'SIGN_OVERLAY_SIGNATURE_NOT_FOUND',
      '签名素材访问凭证不匹配拒绝',
    )
  }

  // 3) 会员越权访问他人目标文件 → SIGN_OVERLAY_TARGET_NOT_FOUND
  {
    const { service, prisma, storage } = makeService()
    seedFile(prisma, storage, 't3', { width: 200, height: 300 }, { endUserId: 'other', ownerType: 'user', ownerId: 'other' })
    seedFile(prisma, storage, 's3', { width: 40, height: 20 }, { purpose: 'signature_source', endUserId: 'me', ownerType: 'user', ownerId: 'me' })
    await expectCode(
      () =>
        service.composeSignatureOverlay({
          target: { fileId: 't3', fileAccessUrl: '' },
          signature: { fileId: 's3', fileAccessUrl: '' },
          position: 'bottom-right',
          size: 'medium',
          endUserId: 'me',
        }),
      'SIGN_OVERLAY_TARGET_NOT_FOUND',
      '会员越权访问他人目标文件拒绝',
    )
  }

  // 4) 会员越权访问他人签名素材 → SIGN_OVERLAY_SIGNATURE_NOT_FOUND
  {
    const { service, prisma, storage } = makeService()
    seedFile(prisma, storage, 't4', { width: 200, height: 300 }, { endUserId: 'me', ownerType: 'user', ownerId: 'me' })
    seedFile(prisma, storage, 's4', { width: 40, height: 20 }, { purpose: 'signature_source', endUserId: 'other', ownerType: 'user', ownerId: 'other' })
    await expectCode(
      () =>
        service.composeSignatureOverlay({
          target: { fileId: 't4', fileAccessUrl: '' },
          signature: { fileId: 's4', fileAccessUrl: '' },
          position: 'bottom-right',
          size: 'medium',
          endUserId: 'me',
        }),
      'SIGN_OVERLAY_SIGNATURE_NOT_FOUND',
      '会员越权访问他人签名素材拒绝',
    )
  }

  // 5) purpose 不符（把 signature_source 文件当目标传入）→ 按不存在处理，不泄露 purpose 不符
  {
    const { service, prisma, storage } = makeService()
    seedFile(prisma, storage, 't5', { width: 40, height: 20 }, { purpose: 'signature_source' })
    seedFile(prisma, storage, 's5', { width: 40, height: 20 }, { purpose: 'signature_source' })
    await expectCode(
      () =>
        service.composeSignatureOverlay({
          target: { fileId: 't5', fileAccessUrl: accessUrl('t5') },
          signature: { fileId: 's5', fileAccessUrl: accessUrl('s5') },
          position: 'bottom-right',
          size: 'medium',
          endUserId: null,
        }),
      'SIGN_OVERLAY_TARGET_NOT_FOUND',
      'purpose 不符的目标文件（signature_source 冒充 print_doc）拒绝',
    )
  }

  // 6) 目标文件 mime 不支持 → SIGN_OVERLAY_TARGET_TYPE_UNSUPPORTED
  {
    const { service, prisma, storage } = makeService()
    seedFile(prisma, storage, 't6', { width: 200, height: 300 }, { mimeType: 'image/webp' })
    seedFile(prisma, storage, 's6', { width: 40, height: 20 }, { purpose: 'signature_source' })
    await expectCode(
      () =>
        service.composeSignatureOverlay({
          target: { fileId: 't6', fileAccessUrl: accessUrl('t6') },
          signature: { fileId: 's6', fileAccessUrl: accessUrl('s6') },
          position: 'bottom-right',
          size: 'medium',
          endUserId: null,
        }),
      'SIGN_OVERLAY_TARGET_TYPE_UNSUPPORTED',
      '目标文件不支持的 mime 类型拒绝',
    )
  }

  // 7) 签名素材 mime 不支持 → SIGN_OVERLAY_SIGNATURE_TYPE_UNSUPPORTED
  {
    const { service, prisma, storage } = makeService()
    seedFile(prisma, storage, 't7', { width: 200, height: 300 })
    seedFile(prisma, storage, 's7', { width: 40, height: 20 }, { purpose: 'signature_source', mimeType: 'image/webp' })
    await expectCode(
      () =>
        service.composeSignatureOverlay({
          target: { fileId: 't7', fileAccessUrl: accessUrl('t7') },
          signature: { fileId: 's7', fileAccessUrl: accessUrl('s7') },
          position: 'bottom-right',
          size: 'medium',
          endUserId: null,
        }),
      'SIGN_OVERLAY_SIGNATURE_TYPE_UNSUPPORTED',
      '签名素材不支持的 mime 类型拒绝',
    )
  }

  // 8) 签名素材超过 2MB → SIGN_OVERLAY_SIGNATURE_TOO_LARGE（早于任何存储读取）
  {
    const { service, prisma, storage } = makeService()
    seedFile(prisma, storage, 't8', { width: 200, height: 300 })
    seedFile(prisma, storage, 's8', { width: 40, height: 20 }, { purpose: 'signature_source', sizeBytes: 2 * 1024 * 1024 + 1 })
    await expectCode(
      () =>
        service.composeSignatureOverlay({
          target: { fileId: 't8', fileAccessUrl: accessUrl('t8') },
          signature: { fileId: 's8', fileAccessUrl: accessUrl('s8') },
          position: 'bottom-right',
          size: 'medium',
          endUserId: null,
        }),
      'SIGN_OVERLAY_SIGNATURE_TOO_LARGE',
      '签名素材超过 2MB 拒绝',
    )
  }

  // 9) 成功合成：1 页、内部 HMAC printFileUrl、产物 purpose=print_doc、审计正确
  {
    const { service, prisma, storage, audit, files } = makeService()
    seedFile(prisma, storage, 't9', { width: 400, height: 600 })
    seedFile(prisma, storage, 's9', { width: 80, height: 40 }, { purpose: 'signature_source' })
    const result = await service.composeSignatureOverlay({
      target: { fileId: 't9', fileAccessUrl: accessUrl('t9') },
      signature: { fileId: 's9', fileAccessUrl: accessUrl('s9') },
      position: 'bottom-right',
      size: 'medium',
      endUserId: null,
    })
    assert.equal(result.pages, 1, 'output should have exactly 1 page')
    assert.match(result.printFileUrl, /^\/api\/v1\/files\//, 'must return internal HMAC url, not COS url')
    assert.equal(audit.entries.length, 1)
    assert.equal(audit.entries[0]!.action, 'print_conversion.signature_overlay')
    assert.equal(audit.entries[0]!.payload?.['targetFileId'], 't9')
    assert.equal(audit.entries[0]!.payload?.['signatureFileId'], 's9')
    assert.equal(audit.entries[0]!.payload?.['position'], 'bottom-right')
    assert.equal(audit.entries[0]!.payload?.['size'], 'medium')
    assert.equal(files.uploaded[0]?.purpose, 'print_doc', '合成产物必须仍走 print_doc 打印链路')
    pass('成功合成签名叠加，1 页 + 内部 URL + 产物 purpose 正确 + audit 正确')
  }

  // 10) 5 个位置预设 × 3 个大小档位全矩阵成功跑通（不同宽高比目标图，捕获坐标计算问题）
  {
    const positions = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'] as const
    const sizes = ['small', 'medium', 'large'] as const
    const dimsMatrix = [
      { width: 400, height: 600 }, // 竖版
      { width: 600, height: 400 }, // 横版
      { width: 500, height: 500 }, // 正方形
    ]
    let n = 0
    for (const dims of dimsMatrix) {
      for (const position of positions) {
        for (const size of sizes) {
          n += 1
          const { service, prisma, storage } = makeService()
          const tId = `mt${n}`
          const sId = `ms${n}`
          seedFile(prisma, storage, tId, dims)
          seedFile(prisma, storage, sId, { width: 80, height: 40 }, { purpose: 'signature_source' })
          const result = await service.composeSignatureOverlay({
            target: { fileId: tId, fileAccessUrl: accessUrl(tId) },
            signature: { fileId: sId, fileAccessUrl: accessUrl(sId) },
            position,
            size,
            endUserId: null,
          })
          assert.equal(result.pages, 1, `${dims.width}x${dims.height} / ${position} / ${size} 应输出 1 页`)
        }
      }
    }
    pass(`位置×大小×宽高比全矩阵（${n} 组合）均成功合成 1 页`)
  }

  // 11) DTO 层校验：合法 position/size 通过；非法枚举被拒绝
  {
    const valid = plainToInstance(ComposeSignatureOverlayDto, {
      target: { fileId: 't', fileAccessUrl: 'u' },
      signature: { fileId: 's', fileAccessUrl: 'u' },
      position: 'center',
      size: 'medium',
    })
    const validErrors = await validate(valid)
    assert.equal(validErrors.length, 0, '合法 position/size 不应产生校验错误')

    const invalid = plainToInstance(ComposeSignatureOverlayDto, {
      target: { fileId: 't', fileAccessUrl: 'u' },
      signature: { fileId: 's', fileAccessUrl: 'u' },
      position: 'top-middle', // 非法枚举
      size: 'huge', // 非法枚举
    })
    const invalidErrors = await validate(invalid)
    const invalidProps = invalidErrors.map((e) => e.property)
    assert.ok(invalidProps.includes('position'), 'DTO 必须拒绝非法 position 枚举')
    assert.ok(invalidProps.includes('size'), 'DTO 必须拒绝非法 size 枚举')
    pass('DTO 层校验：合法枚举通过，非法枚举被拒绝')
  }

  // 12) signature_source 默认 sensitiveLevel 为 'sensitive'（短期即焚）
  {
    assert.equal(
      DEFAULT_SENSITIVE_BY_PURPOSE['signature_source'],
      'sensitive',
      'signature_source 必须默认 sensitive（短 TTL，非长期保存）',
    )
    pass('signature_source 默认 sensitiveLevel 为 sensitive')
  }

  console.log('PASS signature-overlay verification')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
