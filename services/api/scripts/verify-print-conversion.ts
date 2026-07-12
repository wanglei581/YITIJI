/**
 * 格式转换（图片 → PDF）service 级验证。
 *
 * 用内存态 Fake Prisma / Storage / Audit / Files / Redis 直接跑通
 * PrintConversionService.convertImagesToPdf，覆盖：
 *   1-6. 入参校验（空列表 / 超过 20 张 / 重复 fileId / 游客签名不匹配 / 会员越权 / 非 JPEG-PNG）
 *   7.   成功合并多张图片 → 输出页数正确、返回内部 HMAC URL、审计记录正确
 *   8.   相同 Idempotency-Key 重复请求 → 复用同一输出，不重复生成、不重复审计
 *   9.   相同 key、不同图片列表 → 409 冲突（IDEMPOTENCY_KEY_REUSED）
 *  10.   单张图片超过 10MB → 拒绝（早于任何存储读取）
 *  11.   单张图片像素超限 → 拒绝，且断言具体是"像素超限"文案而不是"解析失败"文案
 *        （CONVERT_IMAGE_DIMENSIONS_INVALID 这个错误码同时对应两种不同失败原因，
 *        只断言错误码会在尺寸解析逻辑坏掉时产生假阳性；IHDR 声明尺寸即可触发，
 *        无需真实生成超大像素数据）
 *  12.   幂等锁仍被持有（并发中）→ 409（CONVERSION_IN_PROGRESS）
 *  13.   幂等缓存命中路径下，伪造/失效的游客访问凭证必须被拒绝而不是白嫖缓存结果
 *        （对应 print-conversion.service.ts 里 claimIdempotency() 命中 completed 状态后
 *        重新调用 verifySourceOwnership() 的安全修复）
 *  14.   幂等缓存值损坏（JSON.parse 失败）→ 必须走"重新抢锁"兜底放行，正常成功返回
 *        （同时覆盖 claimIdempotency() 里 setNxEx 抢锁失败后针对占位过期/损坏值的
 *        重新抢锁逻辑，以及 parseIdempotencyState() 的 JSON 解析防护）
 *  15.   转换失败后必须释放幂等锁 —— 同一个 idempotencyKey 换合法输入紧接着重试
 *        必须能立刻成功（对应 convertImagesToPdf() catch 块里的 redis.del(idemKey)）
 *
 * 关键实现说明：
 *   - NestJS 的 HttpException.message 在 response 是 `{ error: { code, message } }`
 *     这种形状时不会被赋值为 code 本身（isObject(response) 的分支要求顶层就有
 *     字符串 message 字段），而是退化成 "Bad Request Exception" 这类通用文案。
 *     所以不能用 assert.rejects(fn, /CODE/) 去匹配 message —— 已实测验证会失败。
 *     必须像 verify-print-jobs.ts / verify-scan-tasks.ts 一样，用 getResponse().error.code
 *     做精确匹配（见下方 errCode / expectCode）。
 *   - PNG fixture 用 zlib.deflateSync + 手算 CRC32 现场生成真实、可被 pdfkit（png-js）
 *     正常内嵌的最小 PNG（8-bit RGB truecolor，无 alpha，无隔行扫描，单个 IDAT），
 *     不是手写伪造字节。已核实 png-js（pdfkit 的 PNG 解码依赖）本身不校验 CRC，
 *     只解析 chunk 结构；因此对于"像素超限"这类会在 mergeImagesToPdf 之前就被拒绝的
 *     用例，可以只改 IHDR 里的宽高字段（不重算 CRC）来断言 readImageDimensions 的
 *     解析结果，这类用例不会真的走到 pdfkit 内嵌路径。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:print-conversion
 */
import 'reflect-metadata'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-print-conversion-secret-0123456789-abcdef'

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import zlib from 'node:zlib'
import { PrintConversionService } from '../src/print-conversion/print-conversion.service'
import { signFileUrl } from '../src/files/signing'

function pass(m: string) {
  console.log(`  PASS ${m}`)
}
function fail(m: string): never {
  console.error(`  FAIL ${m}`)
  process.exit(1)
}

/** 提取 NestJS HttpException 的业务错误码；兼容 getResponse() 与直接 .response 两种形态。 */
function errCode(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown; response?: unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } }
    | undefined
  return resp?.error?.code
}

/** 提取 NestJS HttpException 的业务错误 message（区分同一错误码下不同失败原因用）。 */
function errMessage(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown; response?: unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { message?: string } }
    | undefined
  return resp?.error?.message
}

/**
 * expectedMessage 可选：当同一个 code 对应多种失败原因时（例如
 * CONVERT_IMAGE_DIMENSIONS_INVALID 既可能是"解析失败"也可能是"像素超限"），
 * 传入具体文案把两种原因区分开，避免只断言错误码产生假阳性。
 */
async function expectCode(fn: () => Promise<unknown>, code: string, label: string, expectedMessage?: string): Promise<void> {
  try {
    await fn()
    fail(`${label} — 期望抛 ${code}，但未抛`)
  } catch (e) {
    const c = errCode(e)
    if (c !== code) fail(`${label} — 期望 ${code}，实际: ${c ?? (e as Error).message}`)
    if (expectedMessage !== undefined) {
      const m = errMessage(e)
      if (m !== expectedMessage) fail(`${label} — 期望 message "${expectedMessage}"，实际: "${m}"`)
    }
    pass(label)
  }
}

// ── 真实可解码的最小 PNG fixture（8-bit RGB truecolor，无 alpha，无隔行，单 IDAT）──────

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

/**
 * 生成真实、可被 pdfkit（依赖 png-js）正常内嵌的最小 PNG：
 * colorType=2（RGB truecolor）、bitDepth=8、无 alpha、无隔行扫描、
 * 每行 filter byte=0（None），像素数据经 zlib deflate 压缩进单个 IDAT，
 * CRC32 现算现填 —— 不是凭空手写的伪造字节。
 */
function makePng(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(width, 0)
  ihdrData.writeUInt32BE(height, 4)
  ihdrData[8] = 8 // bit depth
  ihdrData[9] = 2 // color type: truecolor RGB
  ihdrData[10] = 0 // compression method
  ihdrData[11] = 0 // filter method
  ihdrData[12] = 0 // interlace method: none
  const ihdr = pngChunk('IHDR', ihdrData)

  const rowBytes = 1 + width * 3 // filter byte + RGB
  const raw = Buffer.alloc(rowBytes * height)
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowBytes
    raw[rowStart] = 0 // filter type: None
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

/** 克隆一份 PNG 并篡改 IHDR 里的宽高字段（偏移 16 / 20，大端 uint32），用于测试像素上限类断言。
 * 不重算 CRC —— 用于会在 readImageDimensions 解析后、mergeImagesToPdf 之前就被拒绝的用例，
 * 不会真的走到 pdfkit 内嵌路径（已核实 png-js 本身不校验 CRC，但这里的用例本就不依赖它）。 */
function withLyingDimensions(png: Buffer, width: number, height: number): Buffer {
  const patched = Buffer.from(png)
  patched.writeUInt32BE(width, 16)
  patched.writeUInt32BE(height, 20)
  return patched
}

// ── Fake 依赖 ──────────────────────────────────────────────────────────────

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
  // 真实构造函数参数顺序：(prisma, storage, audit, files, redis) —— 已对照
  // print-conversion.service.ts 当前源码确认，非凭空假设。
  const service = new PrintConversionService(prisma as never, storage as never, audit as never, files as never, redis as never)
  return { service, prisma, storage, audit, redis }
}

function seedImage(prisma: FakePrisma, storage: FakeStorage, id: string, overrides: Partial<StoredFile> = {}): StoredFile {
  const record = file({ id, storageKey: `key_${id}`, ...overrides })
  prisma.files.set(id, record)
  storage.objects.set(record.storageKey, makePng(100, 100))
  return record
}

function guestAccessUrl(fileId: string): string {
  return signFileUrl(fileId, 30 * 60 * 1000).url
}

/** 结构合法（能被 parseFileAccessUrl 解析出 fileId/expires/sig）但签名对不上的访问凭证，
 * 用于验证幂等缓存命中路径重新做 ownership 校验时会真的拒绝伪造凭证。 */
function tamperedAccessUrl(fileId: string): string {
  const farFutureMs = Date.now() + 5 * 60 * 1000
  return `/api/v1/files/${fileId}/content?expires=${farFutureMs}&sig=${'0'.repeat(64)}`
}

/** 与 service 私有方法 fingerprintSources() 算法一致（sha256 of fileId 用 '|' 拼接），
 * 供 CONVERSION_IN_PROGRESS 用例手工构造一条"仍在进行中"的幂等锁记录。 */
function fingerprintFileIds(fileIds: string[]): string {
  return createHash('sha256').update(fileIds.join('|')).digest('hex')
}

/** 与 service 私有方法 idempotencyRedisKey() 格式一致。 */
function idemRedisKey(endUserId: string | null, idempotencyKey: string): string {
  return `print-conversion:idem:${endUserId ?? 'guest'}:${idempotencyKey}`
}

async function main() {
  // 1) 空列表拒绝
  {
    const { service } = makeService()
    await expectCode(
      () => service.convertImagesToPdf({ sources: [], endUserId: null }),
      'CONVERT_INPUT_INVALID',
      '空列表拒绝',
    )
  }

  // 2) 超过 20 张拒绝（纯长度校验，早于任何 DB 访问，无需真实造 21 条记录）
  {
    const { service } = makeService()
    const sources = Array.from({ length: 21 }, (_, i) => ({ fileId: `f${i}`, fileAccessUrl: '' }))
    await expectCode(
      () => service.convertImagesToPdf({ sources, endUserId: null }),
      'CONVERT_TOO_MANY_IMAGES',
      '超过 20 张图片拒绝',
    )
  }

  // 3) 重复 fileId 拒绝（早于 DB 访问）
  {
    const { service } = makeService()
    await expectCode(
      () =>
        service.convertImagesToPdf({
          sources: [
            { fileId: 'dup1', fileAccessUrl: '' },
            { fileId: 'dup1', fileAccessUrl: '' },
          ],
          endUserId: null,
        }),
      'CONVERT_INPUT_INVALID',
      '重复 fileId 拒绝',
    )
  }

  // 4) 游客 fileAccessUrl 与 fileId 不匹配 → 拒绝
  {
    const { service, prisma, storage } = makeService()
    seedImage(prisma, storage, 'g1')
    seedImage(prisma, storage, 'g2')
    await expectCode(
      () => service.convertImagesToPdf({ sources: [{ fileId: 'g1', fileAccessUrl: guestAccessUrl('g2') }], endUserId: null }),
      'CONVERT_SOURCE_NOT_FOUND',
      '游客访问凭证与 fileId 不匹配拒绝',
    )
  }

  // 5) 会员访问他人文件 → 拒绝
  {
    const { service, prisma, storage } = makeService()
    seedImage(prisma, storage, 'm1', { endUserId: 'other_member', ownerType: 'user', ownerId: 'other_member' })
    await expectCode(
      () => service.convertImagesToPdf({ sources: [{ fileId: 'm1', fileAccessUrl: '' }], endUserId: 'me' }),
      'CONVERT_SOURCE_NOT_FOUND',
      '会员访问他人文件拒绝',
    )
  }

  // 6) 非 JPEG/PNG → 拒绝
  {
    const { service, prisma, storage } = makeService()
    seedImage(prisma, storage, 'w1', { mimeType: 'image/webp' })
    await expectCode(
      () => service.convertImagesToPdf({ sources: [{ fileId: 'w1', fileAccessUrl: guestAccessUrl('w1') }], endUserId: null }),
      'CONVERT_SOURCE_TYPE_UNSUPPORTED',
      '不支持的图片类型拒绝',
    )
  }

  // 7) 成功合并 3 张图片 → 输出 3 页，返回内部 HMAC URL，audit 记录正确
  {
    const { service, prisma, storage, audit } = makeService()
    const sources = ['a1', 'a2', 'a3'].map((id) => {
      seedImage(prisma, storage, id)
      return { fileId: id, fileAccessUrl: guestAccessUrl(id) }
    })
    const result = await service.convertImagesToPdf({ sources, endUserId: null })
    assert.equal(result.pages, 3, 'output should have 3 pages')
    assert.match(result.printFileUrl, /^\/api\/v1\/files\//, 'must return internal HMAC url, not COS url')
    assert.equal(audit.entries.length, 1)
    assert.equal(audit.entries[0]!.action, 'print_conversion.images_to_pdf')
    assert.deepEqual(audit.entries[0]!.payload?.['sourceFileIds'], ['a1', 'a2', 'a3'])
    pass('成功合并 3 张图片，3 页 + 内部 URL + audit 正确')
  }

  // 8) 相同 Idempotency-Key 重复请求 → 返回同一输出，不重复生成、不重复审计
  {
    const { service, prisma, storage, audit } = makeService()
    const sources = ['b1', 'b2'].map((id) => {
      seedImage(prisma, storage, id)
      return { fileId: id, fileAccessUrl: guestAccessUrl(id) }
    })
    const first = await service.convertImagesToPdf({ sources, endUserId: null, idempotencyKey: 'k1' })
    const second = await service.convertImagesToPdf({ sources, endUserId: null, idempotencyKey: 'k1' })
    assert.equal(first.fileId, second.fileId, 'same idempotency key must reuse output')
    assert.equal(audit.entries.length, 1, 'must not audit-log twice for the same idempotency key')
    pass('相同 idempotencyKey 复用同一输出，且不重复审计')
  }

  // 9) 相同 key、不同图片列表 → 冲突拒绝
  {
    const { service, prisma, storage } = makeService()
    seedImage(prisma, storage, 'c1')
    seedImage(prisma, storage, 'c2')
    await service.convertImagesToPdf({ sources: [{ fileId: 'c1', fileAccessUrl: guestAccessUrl('c1') }], endUserId: null, idempotencyKey: 'k2' })
    await expectCode(
      () =>
        service.convertImagesToPdf({
          sources: [{ fileId: 'c2', fileAccessUrl: guestAccessUrl('c2') }],
          endUserId: null,
          idempotencyKey: 'k2',
        }),
      'IDEMPOTENCY_KEY_REUSED',
      '同一 idempotencyKey 用于不同图片列表拒绝',
    )
  }

  // 10) 单张图片超过 10MB → 拒绝（早于任何存储读取，buffer 本身可以很小）
  {
    const { service, prisma, storage } = makeService()
    seedImage(prisma, storage, 'big1', { sizeBytes: 10 * 1024 * 1024 + 1 })
    await expectCode(
      () => service.convertImagesToPdf({ sources: [{ fileId: 'big1', fileAccessUrl: guestAccessUrl('big1') }], endUserId: null }),
      'CONVERT_SOURCE_TOO_LARGE',
      '单张图片超过 10MB 拒绝',
    )
  }

  // 11) 单张图片像素超限 → 拒绝（IHDR 声明 6000x6000 = 36,000,000 > 25,000,000 上限；
  //     readImageDimensions 只读 IHDR 字段，不校验解压后实际像素数，无需真的生成超大图）。
  //     同时断言具体 message 是"像素超出限制"而不是"文件已损坏"——
  //     CONVERT_IMAGE_DIMENSIONS_INVALID 这个错误码同时覆盖两种完全不同的失败原因，
  //     只断言错误码在尺寸解析逻辑坏掉、导致所有图片都解析不出尺寸时会产生假阳性。
  {
    const { service, prisma, storage } = makeService()
    seedImage(prisma, storage, 'huge1')
    storage.objects.set('key_huge1', withLyingDimensions(makePng(4, 4), 6000, 6000))
    await expectCode(
      () => service.convertImagesToPdf({ sources: [{ fileId: 'huge1', fileAccessUrl: guestAccessUrl('huge1') }], endUserId: null }),
      'CONVERT_IMAGE_DIMENSIONS_INVALID',
      '单张图片像素超限拒绝（而非误判为解析失败）',
      '单张图片像素超出限制',
    )
  }

  // 12) 幂等锁仍被持有（并发中）→ 409 CONVERSION_IN_PROGRESS
  {
    const { service, prisma, storage, redis } = makeService()
    seedImage(prisma, storage, 'i1')
    const key = idemRedisKey(null, 'k3')
    await redis.setNxEx(key, JSON.stringify({ status: 'in_progress', fingerprint: fingerprintFileIds(['i1']) }), 120)
    await expectCode(
      () =>
        service.convertImagesToPdf({
          sources: [{ fileId: 'i1', fileAccessUrl: guestAccessUrl('i1') }],
          endUserId: null,
          idempotencyKey: 'k3',
        }),
      'CONVERSION_IN_PROGRESS',
      '幂等锁仍被持有时并发请求拒绝',
    )
  }

  // 13) 幂等缓存命中路径下必须重新校验 ownership：伪造/失效的游客访问凭证不能白嫖缓存结果
  //     （对应 claimIdempotency() 命中 completed 状态后调用 verifySourceOwnership() 的安全修复）
  {
    const { service, prisma, storage, audit } = makeService()
    seedImage(prisma, storage, 'sec1')
    const first = await service.convertImagesToPdf({
      sources: [{ fileId: 'sec1', fileAccessUrl: guestAccessUrl('sec1') }],
      endUserId: null,
      idempotencyKey: 'sec-k1',
    })
    assert.ok(first.fileId, 'first call must succeed and populate the idempotency cache')

    await expectCode(
      () =>
        service.convertImagesToPdf({
          sources: [{ fileId: 'sec1', fileAccessUrl: tamperedAccessUrl('sec1') }],
          endUserId: null,
          idempotencyKey: 'sec-k1',
        }),
      'CONVERT_SOURCE_NOT_FOUND',
      '幂等缓存命中但访问凭证伪造/失效时仍被拒绝',
    )
    assert.equal(audit.entries.length, 1, 'rejected cache-hit replay must not add a new audit entry')
  }

  // 14) 幂等缓存值损坏（JSON.parse 失败）→ 必须走"重新抢锁"兜底放行，正常成功返回。
  //     覆盖两个此前没测到的分支：claimIdempotency() 里 setNxEx 抢锁失败后针对
  //     占位过期/损坏值的重新抢锁逻辑，以及 parseIdempotencyState() 的 JSON 解析防护
  //     （解析失败一律当"未命中缓存"处理，而不是抛错或卡住）。
  {
    const { service, prisma, storage, redis } = makeService()
    seedImage(prisma, storage, 'corrupt1')
    const key = idemRedisKey(null, 'k-corrupt')
    await redis.setEx(key, 120, '{not valid json')

    const result = await service.convertImagesToPdf({
      sources: [{ fileId: 'corrupt1', fileAccessUrl: guestAccessUrl('corrupt1') }],
      endUserId: null,
      idempotencyKey: 'k-corrupt',
    })
    assert.ok(result.fileId, 'corrupted idempotency cache value must not block or crash a fresh conversion')
    assert.equal(result.pages, 1)

    const after = await redis.get(key)
    assert.ok(after?.includes('"completed"'), 'the corrupted key must be overwritten with a valid completed state after success')
    pass('幂等缓存值损坏时仍能正常完成转换（重新抢锁 + JSON 解析防护兜底放行）')
  }

  // 15) 转换失败后必须释放幂等锁 —— 同一个 idempotencyKey 换合法输入紧接着重试必须能
  //     立刻成功（对应 convertImagesToPdf() catch 块里的 redis.del(idemKey)）。
  //     若这条释放锁的逻辑被删掉或改坏，同一个 key 会被卡住最多 120 秒无法重试。
  {
    const { service, prisma, storage } = makeService()
    seedImage(prisma, storage, 'fail1', { mimeType: 'image/webp' })
    await expectCode(
      () =>
        service.convertImagesToPdf({
          sources: [{ fileId: 'fail1', fileAccessUrl: guestAccessUrl('fail1') }],
          endUserId: null,
          idempotencyKey: 'k-retry',
        }),
      'CONVERT_SOURCE_TYPE_UNSUPPORTED',
      '第一次调用故意失败（不支持的图片类型）',
    )

    seedImage(prisma, storage, 'fail2')
    const retry = await service.convertImagesToPdf({
      sources: [{ fileId: 'fail2', fileAccessUrl: guestAccessUrl('fail2') }],
      endUserId: null,
      idempotencyKey: 'k-retry',
    })
    assert.ok(retry.fileId, 'lock must be released after failure so the same idempotencyKey can retry immediately')
    pass('失败后释放幂等锁，同一 key 立即重试成功')
  }

  console.log('PASS print-conversion verification')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
