/**
 * 证件照排版（IdPhotoService）service 级验证。
 *
 * 用内存态 Fake Prisma / Storage / Audit / Files / Redis / Capabilities 直接跑通
 * IdPhotoService.generateLayout / deleteSource，覆盖：
 *   1.  未知规格 specId → IDPHOTO_SPEC_UNKNOWN
 *   2.  终端不存在 → IDPHOTO_INPUT_INVALID
 *   3.  源文件 purpose 非 id_scan → 404 IDPHOTO_SOURCE_NOT_FOUND
 *   4.  会员访问他人文件 → 404
 *   5.  游客 fileAccessUrl 与 fileId 不匹配 → 404
 *   6.  尺寸不匹配规格（差 1px）→ IDPHOTO_DIMENSIONS_MISMATCH
 *   7.  损坏图片 → IDPHOTO_INPUT_INVALID（且不依赖任何原生图像解码/不崩溃进程）
 *   8.  成功生成一寸整版 PDF → 1 页 / layoutCount=42 / 正确元数据 / 内部签名 URL / 审计记录
 *   9.  XObject 复用体积断言（输出体积远小于 42 倍单图体积）
 *  10.  游客生成结果含 sourceDeleteToken；会员生成结果不含
 *  11.  相同 idempotencyKey 重复调用 → 复用同一 fileId，只生成一次
 *  12.  幂等命中但输出文件已失效（手动标记删除）→ 清缓存重新生成，返回新 fileId
 *  13.  幂等命中路径下能力门禁复验：缓存不能绕过门禁
 *  14.  同一 idempotencyKey 用于不同规格（不同 fingerprint）→ 409 IDPHOTO_IDEMPOTENCY_KEY_REUSED
 *  15.  审计写失败 → IDPHOTO_FAILED，且已上传的输出文件被 systemDelete 回滚
 *  16.  删除端点：会员本人删除成功（ownerDelete + 审计）；重复删除幂等，不重复调用/审计
 *  17.  删除端点：游客凭 deleteToken 删除成功；访问凭证不能当删除 token 互换用；会员删除
 *       游客文件被拒绝
 *  18.  并发生成槽位占满 → IDPHOTO_BUSY
 *  19.  【新增，非原计划】三维频控（本文件只测 terminal 维度）：同一终端连续 4 次全新生成
 *       请求，第 4 次触发 IDPHOTO_RATE_LIMITED（每终端 3 次/分钟）
 *
 * ── 关于限流对用例隔离的处理（Task 4 code review 后新增 checkLayoutRateLimit）──────
 *
 * generateLayout() 的真实调用顺序是：
 *   spec 校验 → resolveTerminalDbId → capabilities 门禁 → （幂等缓存命中提前返回）→
 *   checkLayoutRateLimit → acquireSlot → doGenerate（源文件归属/类型/尺寸校验都在这里面）
 *
 * 也就是说 checkLayoutRateLimit 在 doGenerate 之前执行，而 doGenerate 内部才做
 * purpose 校验 / 归属校验 / URL 校验 / 尺寸校验 / 损坏图片校验——这些校验失败的用例
 * （3/4/5/6/7）和成功用例（8/11 首次调用/12 重新生成/15）全部会先经过一次限流计数，
 * 并不是只有"真正生成成功"的用例才消耗配额。若所有用例共用同一个终端 ID（如计划里
 * 示例代码写的 'term_ok'），第 4 个到达限流检查的用例开始就会被误判为
 * IDPHOTO_RATE_LIMITED，而不是该用例本来要验证的错误码——这是假失败,不是真缺陷。
 *
 * 处理方式：本文件里每个独立用例都各自调用一次 makeService()，拿到全新的
 * FakePrisma/FakeRedis/FakeAudit/FakeFiles/FakeCapabilities 实例（与 verify-print-conversion.ts
 * 同一约定）——这才是不同用例之间互不干扰的根本原因，限流计数器本身也活在这套
 * per-case 的 FakeRedis 里，天然不会跨用例累积。
 * 在此基础上，本文件仍然给每个用例分配独立的终端 ID（FakePrisma.registerTerminal
 * 按用例注册），而不是像计划里示例代码那样全用 'term_ok'：这是防御性 + 语义清晰的
 * 双重考虑——(a) 万一未来有人把多个用例合并到同一个 makeService() 作用域里复用夹具
 * （例如为了少写几行样板代码），不同终端 ID 能继续兜底防止限流串扰；(b) 更贴近真实
 * 语义，不同用例本来就代表不同一体机终端在发起请求。真正"刻意共享同一份 Fake 状态"
 * 的只有两处：11-14（同一终端 + 同一 idempotencyKey 的连续幂等场景）和 19（限流本身，
 * 故意在同一终端连续调用 4 次）——这两处的限流配额消耗已经手工核算过（11-14 合计消耗
 * 2/3，19 精确消耗到第 4 次触发拒绝），不依赖执行顺序之外的隐藏假设。
 *
 * PNG fixture 生成器（makePng / withLyingDimensions / CRC32 相关函数）直接复制自
 * verify-print-conversion.ts，生成真实、可被 pdfkit（png-js）正常内嵌的最小 PNG，
 * 不是手写伪造字节；已核实 png-js 本身不校验 CRC，只解析 chunk 结构。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:id-photo
 */
import 'reflect-metadata'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-id-photo-secret-0123456789-abcdef'

import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { ForbiddenException } from '@nestjs/common'
import { IdPhotoService, computeGrid } from '../src/id-photo/id-photo.service'
import { ID_PHOTO_SPECS, type IdPhotoLayoutResponse } from '../src/id-photo/id-photo.types'
import { signFileUrl, signIdPhotoDeleteToken } from '../src/files/signing'

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

// ── 真实可解码的最小 PNG fixture（复制自 verify-print-conversion.ts）──────────────

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

/** 克隆一份 PNG 并篡改 IHDR 里的宽高字段（偏移 16 / 20，大端 uint32），用于测试尺寸不匹配断言。
 * 不重算 CRC —— 该用例会在 readImageDimensions 解析后、pdfkit 内嵌之前就被拒绝，
 * 不会真的走到内嵌路径（已核实 png-js 本身不校验 CRC，但这里的用例本就不依赖它）。 */
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
  assetCategory?: string
  sourceFileId?: string | null
}

class FakePrisma {
  readonly files = new Map<string, StoredFile>()
  private readonly knownTerminals = new Set<string>()

  /** 测试用：注册一个"存在"的终端引用（id 或 terminalCode，本 fake 里两者同值）。 */
  registerTerminal(ref: string): void {
    this.knownTerminals.add(ref)
  }

  readonly fileObject = {
    findUnique: async ({ where }: { where: { id: string } }) => this.files.get(where.id) ?? null,
  }

  // 真实调用：this.prisma.terminal.findFirst({ where: { OR: [{ id }, { terminalCode }] } })
  readonly terminal = {
    findFirst: async (args: { where: { OR: Array<{ id?: string; terminalCode?: string }> } }) => {
      const ref = args.where.OR[0]?.id ?? args.where.OR[1]?.terminalCode
      return ref && this.knownTerminals.has(ref) ? { id: ref } : null
    },
  }
}

class FakeStorage {
  readonly objects = new Map<string, Buffer>()
  async getObject(objectKey: string, _bucket?: string | null): Promise<Buffer> {
    const buf = this.objects.get(objectKey)
    if (!buf) throw new Error(`object not found: ${objectKey}`)
    return buf
  }
}

/** 可编程审计 fake：failNext=true 时下一次 write() 返回 null（模拟审计写失败），
 * 用于断言"高敏文件生成成功但审计失败"必须触发回滚（设计 §4.5 审计强一致）。 */
class FakeAudit {
  failNext = false
  readonly entries: Array<{ action: string; targetId?: string | null; payload?: Record<string, unknown> }> = []
  async write(args: { action: string; targetId?: string | null; payload?: Record<string, unknown> }): Promise<string | null> {
    if (this.failNext) {
      this.failNext = false
      return null
    }
    this.entries.push(args)
    return `audit_${this.entries.length}`
  }
}

class FakeFiles {
  private next = 1
  uploadCallCount = 0
  readonly systemDeleteCalls: Array<{ fileId: string; reason: string }> = []
  readonly ownerDeleteCalls: Array<{ fileId: string; requester: unknown; reason: string }> = []

  constructor(
    private readonly prisma: FakePrisma,
    private readonly storage: FakeStorage,
  ) {}

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
    this.uploadCallCount += 1
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
      assetCategory: args.assetCategory ?? 'original',
      sourceFileId: args.sourceFileId ?? null,
    }
    this.prisma.files.set(id, record)
    this.storage.objects.set(record.storageKey, args.buffer)
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

  async systemDelete(fileId: string, reason: string): Promise<void> {
    this.systemDeleteCalls.push({ fileId, reason })
    const record = this.prisma.files.get(fileId)
    if (record) {
      record.status = 'deleted'
      record.deletedAt = new Date()
    }
  }

  async ownerDelete(fileId: string, requester: unknown, reason: string): Promise<void> {
    this.ownerDeleteCalls.push({ fileId, requester, reason })
    const record = this.prisma.files.get(fileId)
    if (record) {
      record.status = 'deleted'
      record.deletedAt = new Date()
    }
  }
}

/** 可编程能力门禁 fake：rejectNext=true 时下一次调用抛 Forbidden（用一次即复位），
 * 用于断言幂等缓存命中路径下门禁复验真的会拒绝（缓存不能绕过门禁）。 */
class FakeCapabilities {
  rejectNext = false
  async assertUserTaskAllowed(_terminalId: string, _key: string): Promise<void> {
    if (this.rejectNext) {
      this.rejectNext = false
      throw new ForbiddenException({ error: { code: 'CAPABILITY_UNAVAILABLE', message: 'gate' } })
    }
  }
}

/** 与真实 RedisService 的 get/setEx/setNxEx/del/incrWithTtl 签名对齐（services/api/src/common/redis/redis.service.ts）。
 * TTL 会真实过期（用 Date.now() 计算），但本文件所有用例都在同一个同步时间窗口内跑完，不依赖真实到期。 */
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
  /** INCR 并在首次出现时设置过期，返回自增后的值 —— 对齐 RedisService.incrWithTtl。 */
  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const current = await this.get(key)
    const n = current ? Number(current) + 1 : 1
    const existing = this.values.get(key)
    const expiresAt = n === 1 || !existing ? Date.now() + ttlSeconds * 1000 : existing.expiresAt
    this.values.set(key, { value: String(n), expiresAt })
    return n
  }
}

// ── 测试固定件 ────────────────────────────────────────────────────────────

const ONE_INCH_SPEC = ID_PHOTO_SPECS.find((s) => s.specId === 'one_inch')!

function makeService(terminalIds: string[] = []) {
  const prisma = new FakePrisma()
  for (const id of terminalIds) prisma.registerTerminal(id)
  const storage = new FakeStorage()
  const audit = new FakeAudit()
  const files = new FakeFiles(prisma, storage)
  const redis = new FakeRedis()
  const capabilities = new FakeCapabilities()
  // 真实构造函数参数顺序：(prisma, storage, audit, files, redis, capabilities) —— 已对照
  // id-photo.service.ts 当前源码确认。
  const service = new IdPhotoService(
    prisma as never,
    storage as never,
    audit as never,
    files as never,
    redis as never,
    capabilities as never,
  )
  return { service, prisma, storage, audit, files, redis, capabilities }
}

/** 源文件夹具：purpose 固定 'id_scan'；默认内容是尺寸精确等于一寸规格（295×413）的真实 PNG。 */
function seedIdScan(
  prisma: FakePrisma,
  storage: FakeStorage,
  id: string,
  overrides: Partial<StoredFile> = {},
  buffer: Buffer = makePng(ONE_INCH_SPEC.widthPx, ONE_INCH_SPEC.heightPx),
): StoredFile {
  const record: StoredFile = {
    id,
    storageKey: `key_${id}`,
    bucket: 'local-fs',
    mimeType: 'image/png',
    sizeBytes: buffer.length,
    sha256: `sha_${id}`,
    purpose: 'id_scan',
    status: 'active',
    deletedAt: null,
    expiresAt: null,
    endUserId: null,
    ownerType: 'system',
    ownerId: null,
    ...overrides,
  }
  prisma.files.set(id, record)
  storage.objects.set(record.storageKey, buffer)
  return record
}

function guestAccessUrl(fileId: string): string {
  return signFileUrl(fileId, 30 * 60 * 1000).url
}

async function main() {
  // 1) 未知规格 specId 拒绝（早于任何终端/文件访问）
  {
    const { service } = makeService()
    await expectCode(
      () =>
        service.generateLayout({
          source: { fileId: 'whatever', fileAccessUrl: '' },
          specId: 'unknown_spec',
          terminalId: 'term_ok',
          endUserId: null,
        }),
      'IDPHOTO_SPEC_UNKNOWN',
      '1) 未知规格 specId 拒绝',
    )
  }

  // 2) 终端不存在拒绝（'term_missing' 未注册到 FakePrisma）
  {
    const { service } = makeService()
    await expectCode(
      () =>
        service.generateLayout({
          source: { fileId: 'whatever', fileAccessUrl: '' },
          specId: 'one_inch',
          terminalId: 'term_missing',
          endUserId: null,
        }),
      'IDPHOTO_INPUT_INVALID',
      '2) 终端不存在拒绝',
    )
  }

  // 3) 源文件 purpose 非 id_scan（seed 一个 print_doc 文件）→ 404
  {
    const { service, prisma, storage } = makeService(['term_c3'])
    seedIdScan(prisma, storage, 'wrong_purpose', { purpose: 'print_doc' })
    await expectCode(
      () =>
        service.generateLayout({
          source: { fileId: 'wrong_purpose', fileAccessUrl: guestAccessUrl('wrong_purpose') },
          specId: 'one_inch',
          terminalId: 'term_c3',
          endUserId: null,
        }),
      'IDPHOTO_SOURCE_NOT_FOUND',
      '3) 源文件 purpose 非 id_scan 拒绝（404）',
    )
  }

  // 4) 会员访问他人文件 → 404
  {
    const { service, prisma, storage } = makeService(['term_c4'])
    seedIdScan(prisma, storage, 'others_photo', { endUserId: 'other_member', ownerType: 'user', ownerId: 'other_member' })
    await expectCode(
      () =>
        service.generateLayout({
          source: { fileId: 'others_photo', fileAccessUrl: '' },
          specId: 'one_inch',
          terminalId: 'term_c4',
          endUserId: 'me',
        }),
      'IDPHOTO_SOURCE_NOT_FOUND',
      '4) 会员访问他人文件拒绝（404）',
    )
  }

  // 5) 游客 fileAccessUrl 与 fileId 不匹配（签名指向另一个 fileId）→ 404
  {
    const { service, prisma, storage } = makeService(['term_c5'])
    seedIdScan(prisma, storage, 'url_mismatch_src')
    await expectCode(
      () =>
        service.generateLayout({
          source: { fileId: 'url_mismatch_src', fileAccessUrl: guestAccessUrl('some_other_file_id') },
          specId: 'one_inch',
          terminalId: 'term_c5',
          endUserId: null,
        }),
      'IDPHOTO_SOURCE_NOT_FOUND',
      '5) 游客访问凭证与 fileId 不匹配拒绝（404）',
    )
  }

  // 6) 尺寸不匹配规格（一寸需 295×413，这里高度差 1px）→ IDPHOTO_DIMENSIONS_MISMATCH
  {
    const { service, prisma, storage } = makeService(['term_c6'])
    seedIdScan(prisma, storage, 'dims_bad_src', {}, withLyingDimensions(makePng(4, 4), 295, 412))
    await expectCode(
      () =>
        service.generateLayout({
          source: { fileId: 'dims_bad_src', fileAccessUrl: guestAccessUrl('dims_bad_src') },
          specId: 'one_inch',
          terminalId: 'term_c6',
          endUserId: null,
        }),
      'IDPHOTO_DIMENSIONS_MISMATCH',
      '6) 图片尺寸与规格不匹配拒绝',
    )
  }

  // 7) 损坏图片 → IDPHOTO_INPUT_INVALID。readImageDimensions 对 < 24 字节的 buffer
  //    直接返回 null（见 image-dimensions.util.ts），不触碰任何原生解码器；
  //    这条断言天然成立（能跑到 pass() 就证明没有崩溃/挂起），防未来引入原生解码回归。
  {
    const { service, prisma, storage } = makeService(['term_c7'])
    seedIdScan(prisma, storage, 'corrupt_src', {}, Buffer.from('not an image'))
    await expectCode(
      () =>
        service.generateLayout({
          source: { fileId: 'corrupt_src', fileAccessUrl: guestAccessUrl('corrupt_src') },
          specId: 'one_inch',
          terminalId: 'term_c7',
          endUserId: null,
        }),
      'IDPHOTO_INPUT_INVALID',
      '7) 损坏图片拒绝（零原生解码，进程不退出/不挂起）',
    )
  }

  // 8) 成功生成一寸整版 PDF（游客）→ 1 页 / layoutCount=42 / 正确元数据 / 内部签名 URL / 审计记录
  //    结果与源 PNG 供 9)/10) 复用，避免额外消耗 term_c8 的限流配额。
  let case8Result!: IdPhotoLayoutResponse
  let case8SourceBuffer!: Buffer
  {
    const { service, prisma, storage, audit } = makeService(['term_c8'])
    case8SourceBuffer = makePng(ONE_INCH_SPEC.widthPx, ONE_INCH_SPEC.heightPx)
    seedIdScan(prisma, storage, 'ok_src', {}, case8SourceBuffer)

    case8Result = await service.generateLayout({
      source: { fileId: 'ok_src', fileAccessUrl: guestAccessUrl('ok_src') },
      specId: 'one_inch',
      terminalId: 'term_c8',
      endUserId: null,
    })

    assert.equal(case8Result.pages, 1, 'output PDF must be exactly 1 page')
    const grid = computeGrid(ONE_INCH_SPEC)
    assert.equal(grid.count, 42, '一寸 A4 整版应排 42 张（若此断言失败说明排版常量已变，需重新核实）')
    assert.equal(case8Result.layoutCount, grid.count, 'layoutCount 必须与 computeGrid(spec).count 一致')

    const outputRecord = prisma.files.get(case8Result.fileId)
    assert.ok(outputRecord, 'output file record must exist')
    assert.equal(outputRecord!.purpose, 'id_photo_print')
    assert.equal(outputRecord!.assetCategory, 'derived')
    assert.equal(outputRecord!.sourceFileId, 'ok_src')
    assert.equal(case8Result.specId, 'one_inch')

    assert.match(
      case8Result.printFileUrl,
      /^\/api\/v1\/files\/[^/]+\/content\?expires=\d+&sig=[0-9a-f]{64}$/,
      'printFileUrl must be an internal HMAC-signed URL, not a COS url',
    )

    assert.equal(audit.entries.length, 1)
    assert.equal(audit.entries[0]!.action, 'id_photo.layout_generated')
    assert.equal(audit.entries[0]!.payload?.['sourceFileId'], 'ok_src')
    assert.equal(audit.entries[0]!.payload?.['specId'], 'one_inch')

    pass('8) 成功生成一寸整版 PDF：1 页 + layoutCount=42 + 正确元数据 + 内部签名 URL + 审计记录')
  }

  // 9) XObject 复用体积断言：42 格若逐格内嵌会是源图 ~42 倍体积，复用 XObject 只多结构开销。
  {
    const maxExpectedBytes = case8SourceBuffer.length * 3 + 200 * 1024
    assert.ok(
      case8Result.sizeBytes < maxExpectedBytes,
      `output PDF size (${case8Result.sizeBytes}B) too large for XObject reuse — ` +
        `source PNG=${case8SourceBuffer.length}B, threshold=${maxExpectedBytes}B (若图片被逐格内嵌 42 次会远超此阈值)`,
    )
    pass('9) 输出 PDF 复用单个 XObject，体积远小于逐格内嵌 42 次的理论体积')
  }

  // 10) 游客生成结果含 sourceDeleteToken；会员生成结果不含
  {
    assert.equal(
      typeof case8Result.sourceDeleteToken,
      'string',
      '游客生成结果必须携带 sourceDeleteToken',
    )
    assert.ok(case8Result.sourceDeleteToken!.length > 0)

    const { service, prisma, storage } = makeService(['term_c10'])
    seedIdScan(prisma, storage, 'member_src', { endUserId: 'mem_10', ownerType: 'user', ownerId: 'mem_10' })
    const memberResult = await service.generateLayout({
      source: { fileId: 'member_src', fileAccessUrl: '' },
      specId: 'one_inch',
      terminalId: 'term_c10',
      endUserId: 'mem_10',
    })
    assert.equal(memberResult.sourceDeleteToken, undefined, '会员生成结果不应携带 sourceDeleteToken')
    pass('10) 游客生成结果含 sourceDeleteToken；会员生成结果不含')
  }

  // 11-14) 幂等序列：同一终端 + 同一 idempotencyKey 的连续场景（刻意共享状态，设计如此）。
  {
    const { service, prisma, storage, capabilities } = makeService(['term_idem'])
    seedIdScan(prisma, storage, 'idem_src')

    const callArgs = (specId: string) => ({
      source: { fileId: 'idem_src', fileAccessUrl: guestAccessUrl('idem_src') },
      specId,
      terminalId: 'term_idem',
      endUserId: null,
      idempotencyKey: 'k-idem',
    })

    // 11) 同 key 同请求重复调用 → 复用同一 fileId，只生成一次
    const first = await service.generateLayout(callArgs('one_inch'))
    const second = await service.generateLayout(callArgs('one_inch'))
    assert.equal(second.fileId, first.fileId, 'same idempotency key must reuse output fileId')
    pass('11) 相同 idempotencyKey 重复调用复用同一 fileId')

    // 12) 幂等命中但输出文件已失效（手动标记删除）→ 清缓存重新生成，返回新 fileId
    const outputRecord = prisma.files.get(first.fileId)!
    outputRecord.status = 'deleted'
    outputRecord.deletedAt = new Date()
    const regenerated = await service.generateLayout(callArgs('one_inch'))
    assert.notEqual(regenerated.fileId, first.fileId, '输出文件失效必须触发重新生成，返回新 fileId')
    pass('12) 幂等命中但输出文件已失效时重新生成，返回新 fileId')

    // 13) 幂等命中路径下能力门禁复验：缓存不能绕过门禁
    capabilities.rejectNext = true
    await expectCode(
      () => service.generateLayout(callArgs('one_inch')),
      'CAPABILITY_UNAVAILABLE',
      '13) 幂等缓存命中路径下能力门禁复验拒绝（缓存不能绕过门禁）',
    )

    // 14) 同一 idempotencyKey 用于不同规格（不同 fingerprint）→ 409 冲突
    await expectCode(
      () => service.generateLayout(callArgs('small_one_inch')),
      'IDPHOTO_IDEMPOTENCY_KEY_REUSED',
      '14) 同一 idempotencyKey 用于不同规格拒绝',
    )
  }

  // 15) 审计写失败 → IDPHOTO_FAILED，且已上传的输出文件被 systemDelete 回滚
  {
    const { service, prisma, storage, audit, files } = makeService(['term_c15'])
    seedIdScan(prisma, storage, 'audit_fail_src')
    audit.failNext = true

    await expectCode(
      () =>
        service.generateLayout({
          source: { fileId: 'audit_fail_src', fileAccessUrl: guestAccessUrl('audit_fail_src') },
          specId: 'one_inch',
          terminalId: 'term_c15',
          endUserId: null,
        }),
      'IDPHOTO_FAILED',
      '15a) 审计写失败时生成失败',
    )

    assert.equal(files.systemDeleteCalls.length, 1, '已上传的输出文件必须被 systemDelete 回滚')
    const rolledBackId = files.systemDeleteCalls[0]!.fileId
    const rolledBackRecord = prisma.files.get(rolledBackId)
    assert.ok(rolledBackRecord, '回滚记录必须仍存在（软删）')
    assert.equal(rolledBackRecord!.status, 'deleted')
    pass('15b) 审计写失败导致已上传的输出文件被回滚删除')
  }

  // 16) 删除端点：会员本人删除成功（ownerDelete + 审计）；重复删除幂等，不重复调用/审计
  {
    const { service, prisma, storage, audit, files } = makeService()
    seedIdScan(prisma, storage, 'del_member_1', { endUserId: 'mem_del', ownerType: 'user', ownerId: 'mem_del' })

    const r1 = await service.deleteSource({ fileId: 'del_member_1', endUserId: 'mem_del' })
    assert.equal(r1.deleted, true)
    assert.equal(files.ownerDeleteCalls.length, 1)
    const auditCountAfterFirst = audit.entries.filter((e) => e.action === 'id_photo.source_deleted').length
    assert.equal(auditCountAfterFirst, 1)
    pass('16a) 会员本人删除源文件成功（ownerDelete + 审计）')

    const r2 = await service.deleteSource({ fileId: 'del_member_1', endUserId: 'mem_del' })
    assert.equal(r2.deleted, true)
    assert.equal(files.ownerDeleteCalls.length, 1, '重复删除必须幂等，不能再次调用 ownerDelete')
    const auditCountAfterSecond = audit.entries.filter((e) => e.action === 'id_photo.source_deleted').length
    assert.equal(auditCountAfterSecond, 1, '重复删除不能再写一条审计')
    pass('16b) 重复删除幂等返回成功，不重复调用 ownerDelete / 不重复审计')
  }

  // 17) 删除端点：游客凭 deleteToken 删除成功；访问凭证不能当删除 token 互换；
  //     会员删除游客文件被拒绝
  {
    const { service, prisma, storage, files } = makeService()
    seedIdScan(prisma, storage, 'del_guest_1')
    const token = signIdPhotoDeleteToken('del_guest_1', 60_000).token
    const r = await service.deleteSource({ fileId: 'del_guest_1', endUserId: null, deleteToken: token })
    assert.equal(r.deleted, true)
    assert.ok(files.systemDeleteCalls.some((c) => c.fileId === 'del_guest_1'))
    pass('17a) 游客凭 deleteToken 删除源文件成功')
  }
  {
    const { service, prisma, storage } = makeService()
    seedIdScan(prisma, storage, 'del_guest_2')
    // 用读取用的 fileAccessUrl（signFileUrl）冒充删除 token —— 两者命名空间不同，必须验签失败。
    const bogusToken = guestAccessUrl('del_guest_2')
    await expectCode(
      () => service.deleteSource({ fileId: 'del_guest_2', endUserId: null, deleteToken: bogusToken }),
      'IDPHOTO_SOURCE_NOT_FOUND',
      '17b) 拿访问凭证当删除 token 不可互换，返回 404',
    )
  }
  {
    const { service, prisma, storage } = makeService()
    seedIdScan(prisma, storage, 'del_guest_3') // ownerType='system'，endUserId=null（游客文件）
    await expectCode(
      () => service.deleteSource({ fileId: 'del_guest_3', endUserId: 'someone_else' }),
      'IDPHOTO_SOURCE_NOT_FOUND',
      '17c) 会员删除游客文件返回 404',
    )
  }

  // 18) 并发生成槽位占满 → IDPHOTO_BUSY（两个全局槽位都手动占满）
  {
    const { service, prisma, storage, redis } = makeService(['term_c18'])
    await redis.setNxEx('id-photo:gen-slot:0', '1', 120)
    await redis.setNxEx('id-photo:gen-slot:1', '1', 120)
    seedIdScan(prisma, storage, 'busy_src')
    await expectCode(
      () =>
        service.generateLayout({
          source: { fileId: 'busy_src', fileAccessUrl: guestAccessUrl('busy_src') },
          specId: 'one_inch',
          terminalId: 'term_c18',
          endUserId: null,
        }),
      'IDPHOTO_BUSY',
      '18) 并发生成槽位占满时拒绝新生成请求',
    )
    // 释放槽位：这两个 key 是全局槽位命名（不是按终端隔离的），必须清理，
    // 否则会误伤后面用例（19 需要能正常抢到生成槽位）。
    await redis.del('id-photo:gen-slot:0')
    await redis.del('id-photo:gen-slot:1')
  }

  // 19)【新增，非原计划】限流本身：同一终端连续 4 次全新生成请求（各用不同源文件、
  //     不带 idempotencyKey，确保每次都真正到达 checkLayoutRateLimit），
  //     前 3 次应成功，第 4 次应被 IDPHOTO_RATE_LIMITED 拒绝（每终端 3 次/分钟）。
  {
    const { service, prisma, storage } = makeService(['term_rl'])
    for (let i = 0; i < 3; i++) {
      const fileId = `rl_src_${i}`
      seedIdScan(prisma, storage, fileId)
      const r = await service.generateLayout({
        source: { fileId, fileAccessUrl: guestAccessUrl(fileId) },
        specId: 'one_inch',
        terminalId: 'term_rl',
        endUserId: null,
      })
      assert.ok(r.fileId, `第 ${i + 1} 次全新生成请求应成功`)
    }
    seedIdScan(prisma, storage, 'rl_src_3')
    await expectCode(
      () =>
        service.generateLayout({
          source: { fileId: 'rl_src_3', fileAccessUrl: guestAccessUrl('rl_src_3') },
          specId: 'one_inch',
          terminalId: 'term_rl',
          endUserId: null,
        }),
      'IDPHOTO_RATE_LIMITED',
      '19) 同终端第 4 次全新生成请求触发限流（每终端 3 次/分钟）',
    )
  }

  console.log('PASS id-photo verification')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
