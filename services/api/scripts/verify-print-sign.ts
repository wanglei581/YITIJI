/**
 * 签名盖章（PrintSignService）service 级验证。
 *
 * 用内存态 Fake Prisma / Storage / Audit / Files / Redis / Capabilities 直接跑通
 * PrintSignService.inspect / compose，覆盖：
 *   G. 九宫格几何单元断言（直接调 computeStampDrawParams / normalizeRotation）
 *   A. 归属 / 类型校验（经 compose 全链路）
 *   B. 文档形态（加密 / 损坏 / 数字签名域 / 超页数 / 越界页码 / 超限体积）
 *   C. inspect（页数识别 + 能力维护态门禁）
 *   D. 成功合成（页数 / 内部 URL / 审计 / 敏感级别提升 / 文件名净化 / 输出可再入）
 *   E. 幂等（复用 / 输出失效重生成 / key 冲突 / 并发中 / 失败释放锁 / 并发覆盖不误删他人锁 / key 格式校验）
 *   F. 防御（service 层二次拦截 authorizationConfirmed / 会员频控）
 *
 * 关键实现说明（与 verify-print-conversion.ts 一致，勿改动结论）：
 *   - NestJS 的 HttpException.message 在 response 是 `{ error: { code, message } }`
 *     这种形状时不会被赋值为 code 本身，必须用 getResponse().error.code 精确匹配
 *     （见下方 errCode / expectCode）。
 *   - PNG fixture 用 zlib.deflateSync + 手算 CRC32 现场生成真实、可被 pdf-lib
 *     正常 embedPng 的最小 PNG；像素上限类用例只篡改 IHDR 宽高（不重算 CRC），
 *     因为 readImageDimensions 只读 IHDR 字段，不校验解压后实际像素。
 *   - PDF fixture 手写最小 PDF（含正确 xref 偏移），已在 scratch 脚本核实：
 *     pdf-lib 能正常 load 普通 fixture 且 getPageCount 正确；encrypted fixture
 *     load 抛错；withSigField fixture 的 doc.getForm().getFields() 含 PDFSignature
 *     实例；truncated fixture load 抛错；save({useObjectStreams:false}) 后仍能
 *     用 /Type /Page 正则数出正确页数。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:print-sign
 */
import 'reflect-metadata'
process.env['FILE_SIGNING_SECRET'] ||= 'verify-print-sign-secret-0123456789-abcdefgh'

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import zlib from 'node:zlib'
import { ForbiddenException } from '@nestjs/common'
import { validate } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { PrintSignService } from '../src/print-sign/print-sign.service'
import { computeStampDrawParams, normalizeRotation, type StampDrawParams } from '../src/print-sign/print-sign-geometry'
import type { SignStampPosition, SignStampSize } from '../src/print-sign/print-sign.types'
import { signFileUrl } from '../src/files/signing'
import { countPdfPages } from '../src/files/file-page-count.util'
import { KioskUploadOptionsDto } from '../src/files/dto/kiosk-upload-options.dto'

let assertionCount = 0

function pass(m: string) {
  assertionCount += 1
  console.log(`  PASS ${m}`)
}
function fail(m: string): never {
  console.error(`  FAIL ${m}`)
  process.exit(1)
}
function section(title: string) {
  console.log(`\n=== ${title} ===`)
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

/** 断言函数抛出了"某个"错误（不关心具体类型/错误码，仅用于模拟存储层失败等场景）。 */
async function expectThrowsAny(fn: () => Promise<unknown>, label: string): Promise<void> {
  try {
    await fn()
    fail(`${label} — 期望抛错，但未抛`)
  } catch {
    pass(label)
  }
}

function assertClose(actual: number, expected: number, label: string, tol = 0.001): void {
  if (Math.abs(actual - expected) > tol) {
    fail(`${label} — 期望 ${expected}，实际 ${actual}（容差 ${tol}）`)
  }
  pass(label)
}

// ── 真实可解码的最小 PNG fixture（8-bit RGB truecolor，无 alpha，无隔行，单 IDAT）──────
// 与 verify-print-conversion.ts 完全一致的生成算法（CRC32/deflate 现场计算，非伪造字节）。

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
  ihdrData[8] = 8 // bit depth
  ihdrData[9] = 2 // color type: truecolor RGB
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

/** 篡改 IHDR 宽高（偏移 16/20，大端 uint32），不重算 CRC —— 仅用于在
 * readImageDimensions 解析阶段就会被拒绝的像素上限类用例（不会真的走到
 * pdf-lib embedPng 路径）。 */
function withLyingDimensions(png: Buffer, width: number, height: number): Buffer {
  const patched = Buffer.from(png)
  patched.writeUInt32BE(width, 16)
  patched.writeUInt32BE(height, 20)
  return patched
}

// ── 手写最小 PDF fixture（正确 xref 偏移）──────────────────────────────────

interface PdfFixtureOptions {
  pages?: number
  rotate?: number
  cropBox?: [number, number, number, number]
  encrypted?: boolean
  withSigField?: boolean
}

function makePdf(opts: PdfFixtureOptions = {}): Buffer {
  const pages = opts.pages ?? 1
  const objects: string[] = []
  const pageRefs: string[] = []
  const firstPageObj = 3
  for (let i = 0; i < pages; i++) pageRefs.push(`${firstPageObj + i} 0 R`)
  const sigFieldObj = firstPageObj + pages
  const encryptObj = sigFieldObj + (opts.withSigField ? 1 : 0)

  const acroForm = opts.withSigField ? ` /AcroForm << /Fields [${sigFieldObj} 0 R] /SigFlags 3 >>` : ''
  objects.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R${acroForm} >>\nendobj\n`)
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pages} >>\nendobj\n`)
  for (let i = 0; i < pages; i++) {
    const rotate = opts.rotate ? ` /Rotate ${opts.rotate}` : ''
    const crop = opts.cropBox ? ` /CropBox [${opts.cropBox.join(' ')}]` : ''
    const annots = opts.withSigField && i === 0 ? ` /Annots [${sigFieldObj} 0 R]` : ''
    objects.push(
      `${firstPageObj + i} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842]${rotate}${crop}${annots} >>\nendobj\n`,
    )
  }
  if (opts.withSigField) {
    objects.push(
      `${sigFieldObj} 0 obj\n<< /FT /Sig /T (Sig1) /Type /Annot /Subtype /Widget /Rect [0 0 0 0] /P ${firstPageObj} 0 R >>\nendobj\n`,
    )
  }
  if (opts.encrypted) {
    objects.push(`${encryptObj} 0 obj\n<< /Filter /Standard /V 1 /R 2 /O (x) /U (x) /P -44 >>\nendobj\n`)
  }

  const header = '%PDF-1.4\n'
  let body = ''
  const offsets: number[] = []
  for (const obj of objects) {
    offsets.push(header.length + body.length)
    body += obj
  }
  const xrefStart = header.length + body.length
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`
  const encrypt = opts.encrypted ? ` /Encrypt ${encryptObj} 0 R` : ''
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encrypt} >>\nstartxref\n${xrefStart}\n%%EOF\n`
  return Buffer.from(header + body + xref + trailer, 'latin1')
}

// ── Fake 依赖 ──────────────────────────────────────────────────────────────

interface StoredFile {
  id: string
  storageKey: string
  bucket: string
  filename: string
  mimeType: string
  sizeBytes: number
  purpose: string
  status: string
  deletedAt: Date | null
  expiresAt: Date | null
  endUserId: string | null
  ownerType: string
  ownerId: string | null
  sensitiveLevel: string
}

class FakePrisma {
  readonly files = new Map<string, StoredFile>()
  readonly fileObject = {
    findUnique: async ({ where }: { where: { id: string } }) => this.files.get(where.id) ?? null,
  }
}

class FakeStorage {
  readonly objects = new Map<string, Buffer>()
  readCount = 0
  private readonly oneShotFailures = new Map<string, () => void>()

  async getObject(storageKey: string, _bucket?: string | null): Promise<Buffer> {
    this.readCount += 1
    const hook = this.oneShotFailures.get(storageKey)
    if (hook) {
      this.oneShotFailures.delete(storageKey)
      hook()
      throw new Error(`simulated storage failure for ${storageKey}`)
    }
    const buf = this.objects.get(storageKey)
    if (!buf) throw new Error(`object not found: ${storageKey}`)
    return buf
  }

  /** 下一次读取该 storageKey 时抛错；sideEffect 可选，在抛错前执行（用于模拟并发覆盖场景）。 */
  failNextRead(storageKey: string, sideEffect?: () => void): void {
    this.oneShotFailures.set(storageKey, sideEffect ?? (() => {}))
  }
}

class FakeAudit {
  readonly entries: Array<{
    actorId: string | null
    actorRole: string
    action: string
    targetType?: string
    targetId?: string | null
    payload?: Record<string, unknown>
  }> = []
  async write(args: {
    actorId: string | null
    actorRole: string
    action: string
    targetType?: string
    targetId?: string | null
    payload?: Record<string, unknown>
  }): Promise<string | null> {
    this.entries.push(args)
    return 'audit_1'
  }
}

interface FakeUploadCall {
  buffer: Buffer
  filename: string
  mimeType: string
  purpose: string
  sensitiveLevel?: string
  uploaderId?: string | null
  endUserId?: string | null
  assetCategory?: string
  sourceFileId?: string | null
  createdBy?: string | null
}

class FakeFiles {
  private next = 1
  uploadCount = 0
  readonly calls: FakeUploadCall[] = []
  constructor(
    private readonly prisma: FakePrisma,
    private readonly storage: FakeStorage,
  ) {}

  async upload(args: FakeUploadCall): Promise<{ fileId: string; sha256: string; sizeBytes: number; mimeType: string }> {
    this.uploadCount += 1
    this.calls.push(args)
    const id = `out_${this.next++}`
    const storageKey = `key_${id}`
    const record: StoredFile = {
      id,
      storageKey,
      bucket: 'local-fs',
      filename: args.filename,
      mimeType: args.mimeType,
      sizeBytes: args.buffer.length,
      purpose: args.purpose,
      status: 'active',
      deletedAt: null,
      expiresAt: null,
      endUserId: args.endUserId ?? null,
      ownerType: args.endUserId ? 'user' : 'system',
      ownerId: args.endUserId ?? null,
      sensitiveLevel: args.sensitiveLevel ?? 'normal',
    }
    this.prisma.files.set(id, record)
    this.storage.objects.set(storageKey, args.buffer)
    return { fileId: id, sha256: `sha_${id}`, sizeBytes: record.sizeBytes, mimeType: record.mimeType }
  }
}

class FakeRedis {
  private readonly values = new Map<string, { value: string; expiresAt: number }>()
  private readonly counters = new Map<string, { count: number; expiresAt: number }>()

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
  /** INCR 并在首次出现时设置过期，返回自增后的值（与真实 RedisService.incrWithTtl 语义一致）。 */
  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const existing = this.counters.get(key)
    if (existing && existing.expiresAt > Date.now()) {
      existing.count += 1
      return existing.count
    }
    this.counters.set(key, { count: 1, expiresAt: Date.now() + ttlSeconds * 1000 })
    return 1
  }
  /** 值相等才删，返回 matched/mismatched/missing（与真实 RedisService.getAndDelIfEquals 语义一致）。 */
  async getAndDelIfEquals(key: string, expectedValue: string): Promise<'missing' | 'matched' | 'mismatched'> {
    const entry = this.values.get(key)
    if (!entry || entry.expiresAt <= Date.now()) return 'missing'
    if (entry.value !== expectedValue) return 'mismatched'
    this.values.delete(key)
    return 'matched'
  }
}

class FakeCapabilities {
  status: 'available' | 'maintenance' = 'available'
  async assertUserTaskAllowed(_terminalId: string, _capabilityKey: string): Promise<void> {
    if (this.status !== 'available') {
      throw new ForbiddenException({
        error: { code: 'CAPABILITY_UNAVAILABLE', message: '该终端当前不提供此服务，请咨询现场工作人员' },
      })
    }
  }
}

// ── 测试固定件 ────────────────────────────────────────────────────────────

function makeService() {
  const prisma = new FakePrisma()
  const storage = new FakeStorage()
  const audit = new FakeAudit()
  const files = new FakeFiles(prisma, storage)
  const redis = new FakeRedis()
  const capabilities = new FakeCapabilities()
  // 真实构造函数参数顺序：(prisma, storage, audit, files, redis, capabilities) —— 已对照
  // print-sign.service.ts 当前源码确认。
  const service = new PrintSignService(
    prisma as never,
    storage as never,
    audit as never,
    files as never,
    redis as never,
    capabilities as never,
  )
  return { service, prisma, storage, audit, files, redis, capabilities }
}

function seedDoc(
  prisma: FakePrisma,
  storage: FakeStorage,
  id: string,
  buffer: Buffer,
  overrides: Partial<StoredFile> = {},
): StoredFile {
  const storageKey = overrides.storageKey ?? `key_${id}`
  const record: StoredFile = {
    id,
    storageKey,
    bucket: 'local-fs',
    filename: 'resume.pdf',
    mimeType: 'application/pdf',
    sizeBytes: buffer.length,
    purpose: 'print_doc',
    status: 'active',
    deletedAt: null,
    expiresAt: null,
    endUserId: null,
    ownerType: 'system',
    ownerId: null,
    sensitiveLevel: 'normal',
    ...overrides,
  }
  prisma.files.set(id, record)
  storage.objects.set(storageKey, buffer)
  return record
}

function seedStamp(
  prisma: FakePrisma,
  storage: FakeStorage,
  id: string,
  buffer: Buffer,
  overrides: Partial<StoredFile> = {},
): StoredFile {
  const storageKey = overrides.storageKey ?? `key_${id}`
  const record: StoredFile = {
    id,
    storageKey,
    bucket: 'local-fs',
    filename: 'stamp.png',
    mimeType: 'image/png',
    sizeBytes: buffer.length,
    purpose: 'signature_image',
    status: 'active',
    deletedAt: null,
    expiresAt: null,
    endUserId: null,
    ownerType: 'system',
    ownerId: null,
    sensitiveLevel: 'normal',
    ...overrides,
  }
  prisma.files.set(id, record)
  storage.objects.set(storageKey, buffer)
  return record
}

function guestAccessUrl(fileId: string): string {
  return signFileUrl(fileId, 60_000).url
}

function tamperedAccessUrl(fileId: string): string {
  const farFutureMs = Date.now() + 5 * 60 * 1000
  return `/api/v1/files/${fileId}/content?expires=${farFutureMs}&sig=${'0'.repeat(64)}`
}

const DEFAULT_PLACEMENT = { page: 1, position: 'bottom-right' as SignStampPosition, size: 'medium' as SignStampSize }

/** 与 service 私有方法 fingerprintRequest() 算法一致（sha256 of [documentFileId, stampFileId,
 * placement.page, placement.position, placement.size] 用 '|' 拼接）。 */
function fingerprintSignRequest(
  documentFileId: string,
  stampFileId: string,
  placement: { page: number; position: string; size: string },
): string {
  return createHash('sha256')
    .update([documentFileId, stampFileId, placement.page, placement.position, placement.size].join('|'))
    .digest('hex')
}

/** 与 service 内联表达式一致：`print-sign:idem:${endUserId ?? 'guest'}:${idempotencyKey}` */
function idemRedisKey(endUserId: string | null, idempotencyKey: string): string {
  return `print-sign:idem:${endUserId ?? 'guest'}:${idempotencyKey}`
}

/** 与 service 私有方法 sanitizeBaseName() 算法一致，供文件名净化断言用。 */
function expectedSanitizedBaseName(filename: string): string {
  const base = filename.replace(/\.[Pp][Dd][Ff]$/, '')
  // eslint-disable-next-line no-control-regex -- 与源码一致，刻意匹配控制字符
  const unsafe = new RegExp('[\\\\/\\u0000-\\u001f\\u007f]', 'g')
  const cleaned = base.replace(unsafe, '').replace(/\s+/g, ' ').trim()
  return cleaned.length > 0 ? cleaned.slice(0, 80) : 'document'
}

async function main() {
  // ══════════════════════════════════════════════════════════════════════
  section('H DTO 白名单回归（真实 kiosk-upload 端点校验层，非 Fake service）')
  // ══════════════════════════════════════════════════════════════════════
  // 2026-07-13 走查发现的真实缺口：signature_image purpose 已加入
  // FilesService/upload-sessions/retention-policy 等 Fake 直调路径全部验证过，
  // 但真实 HTTP 端点 POST /files/kiosk-upload 的 class-validator DTO
  // （KioskUploadOptionsDto）白名单当时漏改，导致 Kiosk 本机上传印章图片
  // 对真实后端稳定返回 400 VALIDATION_FAILED——这类"仅 Fake、未触达真实校验层"
  // 的缺口是 service 级测试的结构性盲区，这里直接用 class-validator 的
  // validate() 跑真实 DTO，堵住同类回归。
  {
    const dto = plainToInstance(KioskUploadOptionsDto, { purpose: 'signature_image' })
    const errors = await validate(dto)
    assert.equal(errors.length, 0, `H1 期望 signature_image 通过 KioskUploadOptionsDto 校验，实际报错: ${JSON.stringify(errors)}`)
    pass('H1 KioskUploadOptionsDto 接受 purpose=signature_image（真实 class-validator 校验，非 Fake）')
  }
  {
    const dto = plainToInstance(KioskUploadOptionsDto, { purpose: 'not_a_real_purpose' })
    const errors = await validate(dto)
    assert.ok(errors.length > 0, 'H2 期望非法 purpose 被 KioskUploadOptionsDto 拒绝')
    pass('H2 KioskUploadOptionsDto 仍拒绝白名单外的 purpose（确认断言本身有效，不是永远通过的假阳性）')
  }

  // ══════════════════════════════════════════════════════════════════════
  section('G 几何单元断言')
  // ══════════════════════════════════════════════════════════════════════

  {
    // G1：rotation 0，crop=(0,0,595,842)，图 400x200，medium，全部 9 个位置
    const crop = { cropX: 0, cropY: 0, cropWidth: 595, cropHeight: 842 }
    const visualW = 595
    const visualH = 842
    const factor = 0.25 // medium
    let w = visualW * factor
    let h = (w * 200) / 400
    if (h > visualH * factor) {
      h = visualH * factor
      w = (h * 400) / 200
    }
    const mX = visualW * 0.04
    const mY = visualH * 0.04

    const positions: Array<{ pos: SignStampPosition; vx: number; vy: number }> = [
      { pos: 'top-left', vx: mX, vy: visualH - mY - h },
      { pos: 'top-center', vx: (visualW - w) / 2, vy: visualH - mY - h },
      { pos: 'top-right', vx: visualW - mX - w, vy: visualH - mY - h },
      { pos: 'middle-left', vx: mX, vy: (visualH - h) / 2 },
      { pos: 'center', vx: (visualW - w) / 2, vy: (visualH - h) / 2 },
      { pos: 'middle-right', vx: visualW - mX - w, vy: (visualH - h) / 2 },
      { pos: 'bottom-left', vx: mX, vy: mY },
      { pos: 'bottom-center', vx: (visualW - w) / 2, vy: mY },
      { pos: 'bottom-right', vx: visualW - mX - w, vy: mY },
    ]

    for (const { pos, vx, vy } of positions) {
      const draw: StampDrawParams = computeStampDrawParams({
        ...crop,
        rotation: 0,
        imageWidth: 400,
        imageHeight: 200,
        position: pos,
        size: 'medium',
      })
      assertClose(draw.x, vx, `G1 rotation=0 position=${pos} x`)
      assertClose(draw.y, vy, `G1 rotation=0 position=${pos} y`)
      assertClose(draw.width, w, `G1 rotation=0 position=${pos} width`)
      assertClose(draw.height, h, `G1 rotation=0 position=${pos} height`)
      assert.equal(draw.rotateDegrees, 0)
      pass(`G1 rotation=0 position=${pos} rotateDegrees=0`)
    }
  }

  {
    // G2：rotation 90，bottom-right，crop 原点 (0,0)，595x842 页，图 400x200，medium
    const X0 = 0
    const Y0 = 0
    const W = 595
    const H = 842
    const visualW = H // 842（旋转后视觉宽=页高）
    const visualH = W // 595
    const factor = 0.25
    let w = visualW * factor
    let h = (w * 200) / 400
    if (h > visualH * factor) {
      h = visualH * factor
      w = (h * 400) / 200
    }
    const mX = visualW * 0.04
    const mY = visualH * 0.04
    const vx = visualW - mX - w // bottom-right: col=right
    const vy = mY // bottom-right: row=bottom

    const draw = computeStampDrawParams({
      cropX: X0,
      cropY: Y0,
      cropWidth: W,
      cropHeight: H,
      rotation: 90,
      imageWidth: 400,
      imageHeight: 200,
      position: 'bottom-right',
      size: 'medium',
    })
    assertClose(draw.x, W - vy, 'G2 rotation=90 bottom-right x = 595-vy')
    assertClose(draw.y, vx, 'G2 rotation=90 bottom-right y = vx')
    assert.equal(draw.rotateDegrees, 90)
    pass('G2 rotation=90 bottom-right rotateDegrees=90')
  }

  {
    // G3：rotation 180 与 270，各断言 bottom-right / top-left 两个位置
    const X0 = 0
    const Y0 = 0
    const W = 595
    const H = 842
    const factor = 0.25

    // rotation 180：视觉空间不旋转（同 rotation 0）
    {
      const visualW = W
      const visualH = H
      let w = visualW * factor
      let h = (w * 200) / 400
      if (h > visualH * factor) {
        h = visualH * factor
        w = (h * 400) / 200
      }
      const mX = visualW * 0.04
      const mY = visualH * 0.04

      const cases: Array<{ pos: SignStampPosition; vx: number; vy: number }> = [
        { pos: 'bottom-right', vx: visualW - mX - w, vy: mY },
        { pos: 'top-left', vx: mX, vy: visualH - mY - h },
      ]
      for (const { pos, vx, vy } of cases) {
        const draw = computeStampDrawParams({
          cropX: X0,
          cropY: Y0,
          cropWidth: W,
          cropHeight: H,
          rotation: 180,
          imageWidth: 400,
          imageHeight: 200,
          position: pos,
          size: 'medium',
        })
        assertClose(draw.x, X0 + W - vx, `G3 rotation=180 position=${pos} x`)
        assertClose(draw.y, Y0 + H - vy, `G3 rotation=180 position=${pos} y`)
        assert.equal(draw.rotateDegrees, 180)
        pass(`G3 rotation=180 position=${pos} rotateDegrees=180`)
      }
    }

    // rotation 270：视觉空间旋转（视觉宽=H，视觉高=W）
    {
      const visualW = H
      const visualH = W
      let w = visualW * factor
      let h = (w * 200) / 400
      if (h > visualH * factor) {
        h = visualH * factor
        w = (h * 400) / 200
      }
      const mX = visualW * 0.04
      const mY = visualH * 0.04

      const cases: Array<{ pos: SignStampPosition; vx: number; vy: number }> = [
        { pos: 'bottom-right', vx: visualW - mX - w, vy: mY },
        { pos: 'top-left', vx: mX, vy: visualH - mY - h },
      ]
      for (const { pos, vx, vy } of cases) {
        const draw = computeStampDrawParams({
          cropX: X0,
          cropY: Y0,
          cropWidth: W,
          cropHeight: H,
          rotation: 270,
          imageWidth: 400,
          imageHeight: 200,
          position: pos,
          size: 'medium',
        })
        assertClose(draw.x, X0 + vy, `G3 rotation=270 position=${pos} x`)
        assertClose(draw.y, Y0 + H - vx, `G3 rotation=270 position=${pos} y`)
        assert.equal(draw.rotateDegrees, 270)
        pass(`G3 rotation=270 position=${pos} rotateDegrees=270`)
      }
    }
  }

  {
    // G4：细长图 / 竖长图边界收敛（large，crop=(0,0,595,842)，rotation 0）
    const visualH = 842
    const factor = 0.35 // large

    // 细长图 2000x100：宽约束下 h 远小于上限，断言不越出档位框
    {
      const draw = computeStampDrawParams({
        cropX: 0,
        cropY: 0,
        cropWidth: 595,
        cropHeight: 842,
        rotation: 0,
        imageWidth: 2000,
        imageHeight: 100,
        position: 'center',
        size: 'large',
      })
      assert.ok(draw.height <= visualH * factor + 0.001, `G4 细长图 height=${draw.height} 应 <= ${visualH * factor}`)
      pass('G4 细长图（2000x100,large）h <= visualH*0.35')
    }

    // 竖长图 100x2000：高约束触发反算，w = h * (100/2000)
    {
      const draw = computeStampDrawParams({
        cropX: 0,
        cropY: 0,
        cropWidth: 595,
        cropHeight: 842,
        rotation: 0,
        imageWidth: 100,
        imageHeight: 2000,
        position: 'center',
        size: 'large',
      })
      assertClose(draw.height, visualH * factor, 'G4 竖长图（100x2000,large）h 触顶 visualH*0.35')
      assertClose(draw.width, draw.height * (100 / 2000), 'G4 竖长图（100x2000,large）w = h*(100/2000)')
    }
  }

  {
    // G5：normalizeRotation 边界值
    assert.equal(normalizeRotation(-90), 270)
    pass('G5 normalizeRotation(-90) === 270')
    assert.equal(normalizeRotation(45), 0)
    pass('G5 normalizeRotation(45) === 0')
    assert.equal(normalizeRotation(360), 0)
    pass('G5 normalizeRotation(360) === 0')
  }

  // ══════════════════════════════════════════════════════════════════════
  section('A 归属 / 类型校验')
  // ══════════════════════════════════════════════════════════════════════

  {
    // A1：游客 document 凭证的 fileId 与请求项不一致
    const { service, prisma, storage } = makeService()
    seedDoc(prisma, storage, 'a1-doc', makePdf({ pages: 1 }))
    seedDoc(prisma, storage, 'a1-other', makePdf({ pages: 1 }))
    await expectCode(
      () =>
        service.compose({
          terminalId: 't1',
          document: { fileId: 'a1-doc', fileAccessUrl: guestAccessUrl('a1-other') },
          stamp: { fileId: 'nope', fileAccessUrl: '' },
          placement: DEFAULT_PLACEMENT,
          authorizationConfirmed: true,
          endUserId: null,
        }),
      'SIGN_SOURCE_NOT_FOUND',
      'A1 游客 document 凭证 fileId 与请求项不一致拒绝',
    )
  }

  {
    // A2：会员访问他人 document
    const { service, prisma, storage } = makeService()
    seedDoc(prisma, storage, 'a2-doc', makePdf({ pages: 1 }), {
      endUserId: 'other_member',
      ownerType: 'user',
      ownerId: 'other_member',
    })
    await expectCode(
      () =>
        service.compose({
          terminalId: 't1',
          document: { fileId: 'a2-doc', fileAccessUrl: '' },
          stamp: { fileId: 'nope', fileAccessUrl: '' },
          placement: DEFAULT_PLACEMENT,
          authorizationConfirmed: true,
          endUserId: 'me',
        }),
      'SIGN_SOURCE_NOT_FOUND',
      'A2 会员访问他人 document 拒绝',
    )
  }

  {
    // A3：会员 document purpose='temp'
    const { service, prisma, storage } = makeService()
    seedDoc(prisma, storage, 'a3-doc', makePdf({ pages: 1 }), {
      endUserId: 'member_a3',
      ownerType: 'user',
      ownerId: 'member_a3',
      purpose: 'temp',
    })
    await expectCode(
      () =>
        service.compose({
          terminalId: 't1',
          document: { fileId: 'a3-doc', fileAccessUrl: '' },
          stamp: { fileId: 'nope', fileAccessUrl: '' },
          placement: DEFAULT_PLACEMENT,
          authorizationConfirmed: true,
          endUserId: 'member_a3',
        }),
      'SIGN_DOC_TYPE_UNSUPPORTED',
      'A3 会员 document purpose=temp 拒绝',
    )
  }

  {
    // A4：document mimeType='image/png'
    const { service, prisma, storage } = makeService()
    seedDoc(prisma, storage, 'a4-doc', makePng(10, 10), { mimeType: 'image/png' })
    await expectCode(
      () =>
        service.compose({
          terminalId: 't1',
          document: { fileId: 'a4-doc', fileAccessUrl: guestAccessUrl('a4-doc') },
          stamp: { fileId: 'nope', fileAccessUrl: '' },
          placement: DEFAULT_PLACEMENT,
          authorizationConfirmed: true,
          endUserId: null,
        }),
      'SIGN_DOC_TYPE_UNSUPPORTED',
      'A4 document mimeType=image/png 拒绝',
    )
  }

  {
    // A5：stamp purpose='print_doc'
    const { service, prisma, storage } = makeService()
    seedDoc(prisma, storage, 'a5-doc', makePdf({ pages: 1 }))
    seedStamp(prisma, storage, 'a5-stamp', makePng(100, 100), { purpose: 'print_doc' })
    await expectCode(
      () =>
        service.compose({
          terminalId: 't1',
          document: { fileId: 'a5-doc', fileAccessUrl: guestAccessUrl('a5-doc') },
          stamp: { fileId: 'a5-stamp', fileAccessUrl: guestAccessUrl('a5-stamp') },
          placement: DEFAULT_PLACEMENT,
          authorizationConfirmed: true,
          endUserId: null,
        }),
      'SIGN_STAMP_TYPE_UNSUPPORTED',
      'A5 stamp purpose=print_doc 拒绝',
    )
  }

  {
    // A6：stamp mimeType='image/webp'
    const { service, prisma, storage } = makeService()
    seedDoc(prisma, storage, 'a6-doc', makePdf({ pages: 1 }))
    seedStamp(prisma, storage, 'a6-stamp', makePng(100, 100), { mimeType: 'image/webp' })
    await expectCode(
      () =>
        service.compose({
          terminalId: 't1',
          document: { fileId: 'a6-doc', fileAccessUrl: guestAccessUrl('a6-doc') },
          stamp: { fileId: 'a6-stamp', fileAccessUrl: guestAccessUrl('a6-stamp') },
          placement: DEFAULT_PLACEMENT,
          authorizationConfirmed: true,
          endUserId: null,
        }),
      'SIGN_STAMP_TYPE_UNSUPPORTED',
      'A6 stamp mimeType=image/webp 拒绝',
    )
  }

  // ══════════════════════════════════════════════════════════════════════
  section('B 文档形态')
  // ══════════════════════════════════════════════════════════════════════

  {
    // B1：加密 PDF
    const { service, prisma, storage } = makeService()
    seedDoc(prisma, storage, 'b1-doc', makePdf({ encrypted: true }))
    seedStamp(prisma, storage, 'b1-stamp', makePng(100, 100))
    await expectCode(
      () =>
        service.compose({
          terminalId: 't1',
          document: { fileId: 'b1-doc', fileAccessUrl: guestAccessUrl('b1-doc') },
          stamp: { fileId: 'b1-stamp', fileAccessUrl: guestAccessUrl('b1-stamp') },
          placement: DEFAULT_PLACEMENT,
          authorizationConfirmed: true,
          endUserId: null,
        }),
      'SIGN_DOC_UNSUPPORTED',
      'B1 加密文档拒绝',
    )
  }

  {
    // B2：损坏文档（末尾截断 40 字节）
    const { service, prisma, storage } = makeService()
    const good = makePdf({ pages: 1 })
    const damaged = good.subarray(0, good.length - 40)
    seedDoc(prisma, storage, 'b2-doc', damaged)
    seedStamp(prisma, storage, 'b2-stamp', makePng(100, 100))
    await expectCode(
      () =>
        service.compose({
          terminalId: 't1',
          document: { fileId: 'b2-doc', fileAccessUrl: guestAccessUrl('b2-doc') },
          stamp: { fileId: 'b2-stamp', fileAccessUrl: guestAccessUrl('b2-stamp') },
          placement: DEFAULT_PLACEMENT,
          authorizationConfirmed: true,
          endUserId: null,
        }),
      'SIGN_DOC_UNSUPPORTED',
      'B2 损坏文档拒绝',
    )
  }

  {
    // B3：含 AcroForm 数字签名域
    const { service, prisma, storage } = makeService()
    seedDoc(prisma, storage, 'b3-doc', makePdf({ withSigField: true }))
    seedStamp(prisma, storage, 'b3-stamp', makePng(100, 100))
    await expectCode(
      () =>
        service.compose({
          terminalId: 't1',
          document: { fileId: 'b3-doc', fileAccessUrl: guestAccessUrl('b3-doc') },
          stamp: { fileId: 'b3-stamp', fileAccessUrl: guestAccessUrl('b3-stamp') },
          placement: DEFAULT_PLACEMENT,
          authorizationConfirmed: true,
          endUserId: null,
        }),
      'SIGN_DOC_HAS_DIGITAL_SIGNATURE',
      'B3 含数字签名域文档拒绝',
    )
  }

  {
    // B4：31 页超限
    const { service, prisma, storage } = makeService()
    seedDoc(prisma, storage, 'b4-doc', makePdf({ pages: 31 }))
    seedStamp(prisma, storage, 'b4-stamp', makePng(100, 100))
    await expectCode(
      () =>
        service.compose({
          terminalId: 't1',
          document: { fileId: 'b4-doc', fileAccessUrl: guestAccessUrl('b4-doc') },
          stamp: { fileId: 'b4-stamp', fileAccessUrl: guestAccessUrl('b4-stamp') },
          placement: DEFAULT_PLACEMENT,
          authorizationConfirmed: true,
          endUserId: null,
        }),
      'SIGN_DOC_TOO_MANY_PAGES',
      'B4 31 页文档拒绝',
    )
  }

  {
    // B5：2 页文档，placement.page=3
    const { service, prisma, storage } = makeService()
    seedDoc(prisma, storage, 'b5-doc', makePdf({ pages: 2 }))
    seedStamp(prisma, storage, 'b5-stamp', makePng(100, 100))
    await expectCode(
      () =>
        service.compose({
          terminalId: 't1',
          document: { fileId: 'b5-doc', fileAccessUrl: guestAccessUrl('b5-doc') },
          stamp: { fileId: 'b5-stamp', fileAccessUrl: guestAccessUrl('b5-stamp') },
          placement: { page: 3, position: 'bottom-right', size: 'medium' },
          authorizationConfirmed: true,
          endUserId: null,
        }),
      'SIGN_PLACEMENT_INVALID',
      'B5 页码超出文档范围拒绝',
    )
  }

  {
    // B6：document 记录 sizeBytes=16MB，早于任何存储读取
    const { service, prisma, storage } = makeService()
    seedDoc(prisma, storage, 'b6-doc', makePdf({ pages: 1 }), { sizeBytes: 16 * 1024 * 1024 })
    seedStamp(prisma, storage, 'b6-stamp', makePng(100, 100))
    await expectCode(
      () =>
        service.compose({
          terminalId: 't1',
          document: { fileId: 'b6-doc', fileAccessUrl: guestAccessUrl('b6-doc') },
          stamp: { fileId: 'b6-stamp', fileAccessUrl: guestAccessUrl('b6-stamp') },
          placement: DEFAULT_PLACEMENT,
          authorizationConfirmed: true,
          endUserId: null,
        }),
      'SIGN_DOC_TOO_LARGE',
      'B6 document 超过 15MB 拒绝',
    )
    assert.equal(storage.readCount, 0, 'B6 超限文档不应发生任何存储读取')
    pass('B6 document 超限拒绝时未发生存储读取')
  }

  {
    // B7a：stamp 记录 sizeBytes=11MB，早于任何存储读取
    const { service, prisma, storage } = makeService()
    seedDoc(prisma, storage, 'b7a-doc', makePdf({ pages: 1 }))
    seedStamp(prisma, storage, 'b7a-stamp', makePng(100, 100), { sizeBytes: 11 * 1024 * 1024 })
    await expectCode(
      () =>
        service.compose({
          terminalId: 't1',
          document: { fileId: 'b7a-doc', fileAccessUrl: guestAccessUrl('b7a-doc') },
          stamp: { fileId: 'b7a-stamp', fileAccessUrl: guestAccessUrl('b7a-stamp') },
          placement: DEFAULT_PLACEMENT,
          authorizationConfirmed: true,
          endUserId: null,
        }),
      'SIGN_STAMP_TOO_LARGE',
      'B7a stamp 超过 10MB 拒绝',
    )
    assert.equal(storage.readCount, 0, 'B7a 超限图片不应发生任何存储读取')
    pass('B7a stamp 超限拒绝时未发生存储读取')
  }

  {
    // B7b：stamp PNG IHDR 声明 6000x5000（超像素上限），sizeBytes 本身正常
    const { service, prisma, storage } = makeService()
    seedDoc(prisma, storage, 'b7b-doc', makePdf({ pages: 1 }))
    seedStamp(prisma, storage, 'b7b-stamp', withLyingDimensions(makePng(4, 4), 6000, 5000))
    await expectCode(
      () =>
        service.compose({
          terminalId: 't1',
          document: { fileId: 'b7b-doc', fileAccessUrl: guestAccessUrl('b7b-doc') },
          stamp: { fileId: 'b7b-stamp', fileAccessUrl: guestAccessUrl('b7b-stamp') },
          placement: DEFAULT_PLACEMENT,
          authorizationConfirmed: true,
          endUserId: null,
        }),
      'SIGN_STAMP_TOO_LARGE',
      'B7b stamp 像素超限（6000x5000）拒绝',
    )
  }

  // ══════════════════════════════════════════════════════════════════════
  section('C inspect')
  // ══════════════════════════════════════════════════════════════════════

  {
    // C1：3 页文档 inspect
    const { service, prisma, storage } = makeService()
    seedDoc(prisma, storage, 'c1-doc', makePdf({ pages: 3 }))
    const result = await service.inspect({
      terminalId: 't1',
      document: { fileId: 'c1-doc', fileAccessUrl: guestAccessUrl('c1-doc') },
      endUserId: null,
    })
    assert.equal(result.pages, 3)
    pass('C1 3 页文档 inspect 返回 pages=3')
  }

  {
    // C2：能力维护态 → inspect 与 compose 均拒绝
    const { service, prisma, storage, capabilities } = makeService()
    capabilities.status = 'maintenance'
    seedDoc(prisma, storage, 'c2-doc', makePdf({ pages: 1 }))
    seedStamp(prisma, storage, 'c2-stamp', makePng(100, 100))

    await expectCode(
      () =>
        service.inspect({
          terminalId: 't1',
          document: { fileId: 'c2-doc', fileAccessUrl: guestAccessUrl('c2-doc') },
          endUserId: null,
        }),
      'CAPABILITY_UNAVAILABLE',
      'C2 能力维护态时 inspect 拒绝',
    )
    await expectCode(
      () =>
        service.compose({
          terminalId: 't1',
          document: { fileId: 'c2-doc', fileAccessUrl: guestAccessUrl('c2-doc') },
          stamp: { fileId: 'c2-stamp', fileAccessUrl: guestAccessUrl('c2-stamp') },
          placement: DEFAULT_PLACEMENT,
          authorizationConfirmed: true,
          endUserId: null,
          idempotencyKey: null,
        }),
      'CAPABILITY_UNAVAILABLE',
      'C2 能力维护态时 compose 拒绝',
    )
  }

  // ══════════════════════════════════════════════════════════════════════
  section('D 成功合成')
  // ══════════════════════════════════════════════════════════════════════

  {
    // D1：会员 2 页 PDF + PNG 章（bottom-right/medium/page 2）成功
    const { service, prisma, storage, files, audit } = makeService()
    const weirdFilename = `weird/name\\with${String.fromCharCode(7)}control.pdf`
    seedDoc(prisma, storage, 'd1-doc', makePdf({ pages: 2 }), {
      endUserId: 'member_d1',
      ownerType: 'user',
      ownerId: 'member_d1',
      filename: weirdFilename,
      sensitiveLevel: 'normal',
    })
    seedStamp(prisma, storage, 'd1-stamp', makePng(400, 200), {
      endUserId: 'member_d1',
      ownerType: 'user',
      ownerId: 'member_d1',
    })

    const result = await service.compose({
      terminalId: 'term-d1',
      document: { fileId: 'd1-doc', fileAccessUrl: '' },
      stamp: { fileId: 'd1-stamp', fileAccessUrl: '' },
      placement: { page: 2, position: 'bottom-right', size: 'medium' },
      authorizationConfirmed: true,
      endUserId: 'member_d1',
    })

    assert.equal(result.pages, 2, 'D1 输出应为 2 页')
    pass('D1 result.pages === 2')

    const lastCall = files.calls[files.calls.length - 1]!
    assert.equal(countPdfPages(lastCall.buffer), 2, 'D1 输出 buffer 真实页数应为 2（防 useObjectStreams 回退）')
    pass('D1 countPdfPages(输出 buffer) === 2')

    assert.equal(lastCall.assetCategory, 'derived')
    assert.equal(lastCall.sourceFileId, 'd1-doc')
    assert.equal(lastCall.purpose, 'print_doc')
    pass('D1 FakeFiles 收到 assetCategory=derived / sourceFileId=documentId / purpose=print_doc')

    assert.equal(lastCall.sensitiveLevel, 'sensitive', 'D1 document 为 normal 时输出应提升为 sensitive')
    pass('D1 document sensitiveLevel=normal → 输出 sensitiveLevel=sensitive')

    const expectedName = `${expectedSanitizedBaseName(weirdFilename)}-签章合成.pdf`
    assert.equal(lastCall.filename, expectedName)
    assert.ok(
      !lastCall.filename.includes('/') &&
        !lastCall.filename.includes('\\') &&
        !lastCall.filename.includes(String.fromCharCode(7)),
    )
    assert.ok(lastCall.filename.endsWith('-签章合成.pdf'))
    pass('D1 输出 filename 净化且以 -签章合成.pdf 结尾，不含路径分隔符/控制字符')

    assert.match(result.printFileUrl, /^\/api\/v1\/files\/.+\/content\?expires=\d+&sig=[0-9a-f]+$/)
    pass('D1 printFileUrl 匹配内部 HMAC URL 格式')

    assert.equal(audit.entries.length, 1)
    const entry = audit.entries[0]!
    assert.equal(entry.action, 'print_sign.compose')
    assert.equal(entry.payload?.['terminalId'], 'term-d1')
    assert.ok(
      typeof entry.payload?.['authorizationNoticeVersion'] === 'string' &&
        (entry.payload!['authorizationNoticeVersion'] as string).length > 0,
    )
    pass('D1 audit 恰 1 条 action=print_sign.compose，payload 含 terminalId 与 authorizationNoticeVersion')
  }

  {
    // D1b：document sensitiveLevel=highly_sensitive → 输出应保持 highly_sensitive
    const { service, prisma, storage, files } = makeService()
    seedDoc(prisma, storage, 'd1b-doc', makePdf({ pages: 1 }), { sensitiveLevel: 'highly_sensitive' })
    seedStamp(prisma, storage, 'd1b-stamp', makePng(100, 100))

    await service.compose({
      terminalId: 't1',
      document: { fileId: 'd1b-doc', fileAccessUrl: guestAccessUrl('d1b-doc') },
      stamp: { fileId: 'd1b-stamp', fileAccessUrl: guestAccessUrl('d1b-stamp') },
      placement: DEFAULT_PLACEMENT,
      authorizationConfirmed: true,
      endUserId: null,
    })
    const lastCall = files.calls[files.calls.length - 1]!
    assert.equal(lastCall.sensitiveLevel, 'highly_sensitive')
    pass('D1b document sensitiveLevel=highly_sensitive → 输出保持 highly_sensitive')
  }

  {
    // D2：rotate:90 的文档正常合成，页数不变
    const { service, prisma, storage } = makeService()
    seedDoc(prisma, storage, 'd2-doc', makePdf({ pages: 1, rotate: 90 }))
    seedStamp(prisma, storage, 'd2-stamp', makePng(400, 200))
    const result = await service.compose({
      terminalId: 't1',
      document: { fileId: 'd2-doc', fileAccessUrl: guestAccessUrl('d2-doc') },
      stamp: { fileId: 'd2-stamp', fileAccessUrl: guestAccessUrl('d2-stamp') },
      placement: DEFAULT_PLACEMENT,
      authorizationConfirmed: true,
      endUserId: null,
    })
    assert.equal(result.pages, 1)
    pass('D2 rotate=90 文档合成成功，页数不变')
  }

  {
    // D3：验证服务自己合成的 PDF 输出本身是结构合法、可重新摄入的文档
    // ——不只是"页数对"，而是这份输出能作为全新一次 compose() 调用的 document
    // 输入，完整走一遍加载/校验/再叠图流程并成功。
    //
    // 本用例在一个独立的 Fake 实例上构造等价场景（先以会员身份 compose 出一份
    // 已盖章的 2 页 PDF，再把该输出记录的归属改成 guest/system，用它自身的
    // printFileUrl 作为游客访问凭证发起第二次 compose）——这是"等价场景"，不是
    // 跨实例复用 D1 那次调用产生的同一个对象；两次调用各自在各自的 makeService()
    // 实例里独立执行。
    const { service, prisma, storage } = makeService()

    seedDoc(prisma, storage, 'd1b2-doc', makePdf({ pages: 2 }), {
      endUserId: 'member_d1',
      ownerType: 'user',
      ownerId: 'member_d1',
    })
    seedStamp(prisma, storage, 'd1b2-stamp', makePng(400, 200), {
      endUserId: 'member_d1',
      ownerType: 'user',
      ownerId: 'member_d1',
    })
    const d1Result = await service.compose({
      terminalId: 'term-d1',
      document: { fileId: 'd1b2-doc', fileAccessUrl: '' },
      stamp: { fileId: 'd1b2-stamp', fileAccessUrl: '' },
      placement: { page: 2, position: 'bottom-right', size: 'medium' },
      authorizationConfirmed: true,
      endUserId: 'member_d1',
    })

    // 把刚产出的输出记录改为 guest/system 归属，使其可以用同一个 printFileUrl 作为游客凭证访问。
    const outputRecord = prisma.files.get(d1Result.fileId)!
    outputRecord.endUserId = null
    outputRecord.ownerType = 'system'
    outputRecord.ownerId = null

    seedStamp(prisma, storage, 'd3-stamp2', makePng(300, 150), {
      endUserId: null,
      ownerType: 'system',
      ownerId: null,
    })

    const result = await service.compose({
      terminalId: 't1',
      document: { fileId: d1Result.fileId, fileAccessUrl: d1Result.printFileUrl },
      stamp: { fileId: 'd3-stamp2', fileAccessUrl: guestAccessUrl('d3-stamp2') },
      placement: { page: 1, position: 'top-left', size: 'small' },
      authorizationConfirmed: true,
      endUserId: null,
    })
    assert.equal(result.pages, 2, 'D3 二次盖章后页数仍为 2')
    pass('D3 本服务自身产出的 PDF 可作为游客文档再次合成成功（复用其 printFileUrl 作凭证）')
  }

  // ══════════════════════════════════════════════════════════════════════
  section('E 幂等')
  // ══════════════════════════════════════════════════════════════════════

  {
    // E1 + E2：同 key 同指纹重放复用结果；输出失效后重放则重新生成
    const { service, prisma, storage, files, audit } = makeService()
    seedDoc(prisma, storage, 'e1-doc', makePdf({ pages: 1 }), {
      endUserId: 'member_e1',
      ownerType: 'user',
      ownerId: 'member_e1',
    })
    seedStamp(prisma, storage, 'e1-stamp', makePng(100, 100), {
      endUserId: 'member_e1',
      ownerType: 'user',
      ownerId: 'member_e1',
    })
    const idemKey = 'verify-e1-idempotency-key-aaaa'

    const composeArgs = {
      terminalId: 't1',
      document: { fileId: 'e1-doc', fileAccessUrl: '' },
      stamp: { fileId: 'e1-stamp', fileAccessUrl: '' },
      placement: DEFAULT_PLACEMENT,
      authorizationConfirmed: true,
      endUserId: 'member_e1',
      idempotencyKey: idemKey,
    }

    const first = await service.compose(composeArgs)
    assert.equal(files.uploadCount, 1)
    assert.equal(audit.entries.length, 1)

    const second = await service.compose(composeArgs)
    assert.equal(second.fileId, first.fileId, 'E1 相同 key+指纹应复用同一输出')
    assert.equal(files.uploadCount, 1, 'E1 重放不应重复生成')
    assert.equal(audit.entries.length, 1, 'E1 重放不应重复审计')
    pass('E1 同 key 同指纹重放复用结果，不重复生成、不重复审计')

    // E2：把输出记录标记为已删除，再重放同 key → 重新生成
    const outputRecord = prisma.files.get(first.fileId)!
    outputRecord.deletedAt = new Date()

    const third = await service.compose(composeArgs)
    assert.equal(files.uploadCount, 2, 'E2 输出失效后重放应重新生成')
    assert.notEqual(third.fileId, first.fileId, 'E2 重新生成的应是新的 fileId')
    pass('E2 输出失效后重放同 key 重新生成新输出')
  }

  {
    // E1g：幂等缓存命中路径（游客身份）必须重新校验 document 归属 —— 伪造/失效的
    // 游客访问凭证不能白嫖已完成结果（对应 claimIdempotency() 命中 completed 状态后
    // 重新调用 verifyDocumentSource()/verifyStampSource() 的安全修复；与
    // print-conversion 的 case 13 同一防线）。E1/E2 都是会员场景，verifyOwnership()
    // 对会员根本不看 fileAccessUrl，完全测不到这条防线 —— 必须专门起一个游客场景。
    const { service, prisma, storage, audit } = makeService()
    seedDoc(prisma, storage, 'e1g-doc', makePdf({ pages: 1 }))
    seedStamp(prisma, storage, 'e1g-stamp', makePng(100, 100))
    const idemKey = 'verify-e1g-idempotency-key-ffff'

    const first = await service.compose({
      terminalId: 't1',
      document: { fileId: 'e1g-doc', fileAccessUrl: guestAccessUrl('e1g-doc') },
      stamp: { fileId: 'e1g-stamp', fileAccessUrl: guestAccessUrl('e1g-stamp') },
      placement: DEFAULT_PLACEMENT,
      authorizationConfirmed: true,
      endUserId: null,
      idempotencyKey: idemKey,
    })
    assert.ok(first.fileId, 'E1g 首次调用应成功并写入幂等缓存（completed 状态）')
    const auditCountAfterFirst = audit.entries.length

    // 同一个 idempotencyKey + 同一个 document.fileId（指纹不变，命中 completed 缓存），
    // 但把 fileAccessUrl 换成签名对不上的伪造凭证 —— 期望被拒绝，而不是直接返回缓存结果。
    await expectCode(
      () =>
        service.compose({
          terminalId: 't1',
          document: { fileId: 'e1g-doc', fileAccessUrl: tamperedAccessUrl('e1g-doc') },
          stamp: { fileId: 'e1g-stamp', fileAccessUrl: guestAccessUrl('e1g-stamp') },
          placement: DEFAULT_PLACEMENT,
          authorizationConfirmed: true,
          endUserId: null,
          idempotencyKey: idemKey,
        }),
      'SIGN_SOURCE_NOT_FOUND',
      'E1g 游客幂等缓存命中路径下伪造访问凭证仍被拒绝（不能白嫖缓存结果）',
    )
    assert.equal(audit.entries.length, auditCountAfterFirst, 'E1g 被拒绝的重放不应产生新的审计记录')
    pass('E1g 拒绝重放未新增审计记录')
  }

  {
    // E3：同 key、不同指纹（换 position）→ IDEMPOTENCY_KEY_REUSED
    const { service, prisma, storage } = makeService()
    seedDoc(prisma, storage, 'e3-doc', makePdf({ pages: 1 }))
    seedStamp(prisma, storage, 'e3-stamp', makePng(100, 100))
    const idemKey = 'verify-e3-idempotency-key-bbbb'

    await service.compose({
      terminalId: 't1',
      document: { fileId: 'e3-doc', fileAccessUrl: guestAccessUrl('e3-doc') },
      stamp: { fileId: 'e3-stamp', fileAccessUrl: guestAccessUrl('e3-stamp') },
      placement: { page: 1, position: 'bottom-right', size: 'medium' },
      authorizationConfirmed: true,
      endUserId: null,
      idempotencyKey: idemKey,
    })

    await expectCode(
      () =>
        service.compose({
          terminalId: 't1',
          document: { fileId: 'e3-doc', fileAccessUrl: guestAccessUrl('e3-doc') },
          stamp: { fileId: 'e3-stamp', fileAccessUrl: guestAccessUrl('e3-stamp') },
          placement: { page: 1, position: 'top-left', size: 'medium' },
          authorizationConfirmed: true,
          endUserId: null,
          idempotencyKey: idemKey,
        }),
      'IDEMPOTENCY_KEY_REUSED',
      'E3 同 key 不同指纹（换 position）拒绝',
    )
  }

  {
    // E4：手动 setNxEx 同指纹 in_progress → SIGN_IN_PROGRESS
    const { service, prisma, storage, redis } = makeService()
    seedDoc(prisma, storage, 'e4-doc', makePdf({ pages: 1 }))
    seedStamp(prisma, storage, 'e4-stamp', makePng(100, 100))
    const idemKey = 'verify-e4-idempotency-key-cccc'
    const key = idemRedisKey(null, idemKey)
    const fingerprint = fingerprintSignRequest('e4-doc', 'e4-stamp', DEFAULT_PLACEMENT)
    await redis.setNxEx(key, JSON.stringify({ status: 'in_progress', fingerprint, ownerToken: 'someone-else' }), 120)

    await expectCode(
      () =>
        service.compose({
          terminalId: 't1',
          document: { fileId: 'e4-doc', fileAccessUrl: guestAccessUrl('e4-doc') },
          stamp: { fileId: 'e4-stamp', fileAccessUrl: guestAccessUrl('e4-stamp') },
          placement: DEFAULT_PLACEMENT,
          authorizationConfirmed: true,
          endUserId: null,
          idempotencyKey: idemKey,
        }),
      'SIGN_IN_PROGRESS',
      'E4 幂等锁仍被持有时并发请求拒绝',
    )
  }

  {
    // E5：storage 对 document 抛错一次 → compose 失败；同 key 立即重试（storage 恢复）→ 成功
    const { service, prisma, storage } = makeService()
    const docRecord = seedDoc(prisma, storage, 'e5-doc', makePdf({ pages: 1 }), {
      endUserId: 'member_e5',
      ownerType: 'user',
      ownerId: 'member_e5',
    })
    seedStamp(prisma, storage, 'e5-stamp', makePng(100, 100), {
      endUserId: 'member_e5',
      ownerType: 'user',
      ownerId: 'member_e5',
    })
    const idemKey = 'verify-e5-idempotency-key-dddd'
    storage.failNextRead(docRecord.storageKey)

    await expectThrowsAny(
      () =>
        service.compose({
          terminalId: 't1',
          document: { fileId: 'e5-doc', fileAccessUrl: '' },
          stamp: { fileId: 'e5-stamp', fileAccessUrl: '' },
          placement: DEFAULT_PLACEMENT,
          authorizationConfirmed: true,
          endUserId: 'member_e5',
          idempotencyKey: idemKey,
        }),
      'E5 第一次调用因存储读取失败而失败',
    )

    const retry = await service.compose({
      terminalId: 't1',
      document: { fileId: 'e5-doc', fileAccessUrl: '' },
      stamp: { fileId: 'e5-stamp', fileAccessUrl: '' },
      placement: DEFAULT_PLACEMENT,
      authorizationConfirmed: true,
      endUserId: 'member_e5',
      idempotencyKey: idemKey,
    })
    assert.ok(retry.fileId, 'E5 失败后释放锁，同 key 立即重试应成功')
    pass('E5 storage 失败后释放幂等锁，同 key 立即重试成功')
  }

  {
    // E6：并发场景下 key 被"他人"覆盖为不同 ownerToken 的 in_progress 后，
    // 本次请求失败时的 compare-and-delete 不应误删他人的新锁。
    const { service, prisma, storage, redis } = makeService()
    const docRecord = seedDoc(prisma, storage, 'e6-doc', makePdf({ pages: 1 }), {
      endUserId: 'member_e6',
      ownerType: 'user',
      ownerId: 'member_e6',
    })
    seedStamp(prisma, storage, 'e6-stamp', makePng(100, 100), {
      endUserId: 'member_e6',
      ownerType: 'user',
      ownerId: 'member_e6',
    })
    const idemKey = 'verify-e6-idempotency-key-eeee'
    const key = idemRedisKey('member_e6', idemKey)
    const fingerprint = fingerprintSignRequest('e6-doc', 'e6-stamp', DEFAULT_PLACEMENT)
    const foreignPayload = JSON.stringify({ status: 'in_progress', fingerprint, ownerToken: 'attacker-token-xyz' })

    // 在 document 存储读取（本次 doCompose 内部第一次读取）即将失败的瞬间，
    // 模拟另一并发请求已经把 idemKey 覆写为它自己的 in_progress 锁。
    storage.failNextRead(docRecord.storageKey, () => {
      void redis.setEx(key, 120, foreignPayload)
    })

    await expectThrowsAny(
      () =>
        service.compose({
          terminalId: 't1',
          document: { fileId: 'e6-doc', fileAccessUrl: '' },
          stamp: { fileId: 'e6-stamp', fileAccessUrl: '' },
          placement: DEFAULT_PLACEMENT,
          authorizationConfirmed: true,
          endUserId: 'member_e6',
          idempotencyKey: idemKey,
        }),
      'E6 并发覆盖场景下本次请求因存储失败而失败',
    )

    const remaining = await redis.get(key)
    assert.equal(remaining, foreignPayload, 'E6 compare-and-delete 不应误删他人（不同 ownerToken）持有的新锁')
    pass('E6 并发覆盖场景下 getAndDelIfEquals mismatched，不误删他人的锁')
  }

  {
    // E7：idempotencyKey 长度 <16 → VALIDATION_FAILED
    const { service } = makeService()
    await expectCode(
      () =>
        service.compose({
          terminalId: 't1',
          document: { fileId: 'whatever', fileAccessUrl: '' },
          stamp: { fileId: 'whatever', fileAccessUrl: '' },
          placement: DEFAULT_PLACEMENT,
          authorizationConfirmed: true,
          endUserId: null,
          idempotencyKey: 'short',
        }),
      'VALIDATION_FAILED',
      'E7 idempotencyKey 过短（<16 字符）拒绝',
    )
  }

  // ══════════════════════════════════════════════════════════════════════
  section('F 防御')
  // ══════════════════════════════════════════════════════════════════════

  {
    // F1：authorizationConfirmed:false 直调 service → VALIDATION_FAILED
    const { service } = makeService()
    await expectCode(
      () =>
        service.compose({
          terminalId: 't1',
          document: { fileId: 'whatever', fileAccessUrl: '' },
          stamp: { fileId: 'whatever', fileAccessUrl: '' },
          placement: DEFAULT_PLACEMENT,
          authorizationConfirmed: false,
          endUserId: null,
        }),
      'VALIDATION_FAILED',
      'F1 authorizationConfirmed=false 直调 service 拒绝',
    )
  }

  {
    // F2：会员 1 分钟内第 4 次 compose（同 endUserId）→ SIGN_IN_PROGRESS（会员频控）
    const { service } = makeService()
    const endUserId = 'member_f2'
    const callOnce = () =>
      service.compose({
        terminalId: 't1',
        document: { fileId: 'nonexistent', fileAccessUrl: '' },
        stamp: { fileId: 'nonexistent', fileAccessUrl: '' },
        placement: DEFAULT_PLACEMENT,
        authorizationConfirmed: true,
        endUserId,
      })

    for (let i = 0; i < 3; i++) {
      try {
        await callOnce()
      } catch {
        // 前 3 次结果不重要，只是为了推进频控计数
      }
    }
    await expectCode(callOnce, 'SIGN_IN_PROGRESS', 'F2 会员 1 分钟内第 4 次 compose 被频控拒绝')
  }

  console.log(`\nverify:print-sign — all ${assertionCount} assertions passed`)
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
