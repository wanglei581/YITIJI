/**
 * 我的文档列表页数契约（GET /api/v1/me/documents 的 data）。
 *
 * 为什么单独成文件：verify-member-assets.ts 是归属隔离套件，且没有挂在
 * postgres-readiness。本契约要在 SQLite 与 PostgreSQL 上都证明新列：
 * 有真实页数、未识别是 null 不是 0、响应字段白名单。
 * 不把上传识别和字段白名单塞进归属套件，也不把整条 member-assets 链推进 PG 作业。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:document-page-count
 */
import 'dotenv/config'
import { mkdirSync } from 'fs'
import { randomUUID } from 'crypto'
import { PDFDocument } from 'pdf-lib'
import { PrismaService } from '../src/prisma/prisma.service'
import { MemberAssetsService } from '../src/member-assets/member-assets.service'
import { FilesService } from '../src/files/files.service'
import { AuditService } from '../src/audit/audit.service'
import { StorageService } from '../src/storage/storage.service'
import { recognizeStoredPageCount } from '../src/files/file-page-count.util'
import type { MemberDocumentItem } from '../src/member-assets/member-assets.types'

process.env['FILE_SIGNING_SECRET'] ??= 'document-page-count-verify-secret-2026-09-29'

const ITEM_KEYS = [
  'allowedRetentionPolicies',
  'assetCategory',
  'createdAt',
  'downloadUrlPath',
  'expiresAt',
  'filename',
  'id',
  'mimeType',
  'pageCount',
  'previewUrlPath',
  'purpose',
  'reprintable',
  'retentionPolicy',
  'sensitiveLevel',
  'sizeBytes',
]
const PAGE_KEYS = ['items', 'nextCursor', 'total']
const SECRET_SHA = 'PAGECOUNT-SHA-SECRET'
const SECRET_KEY_PREFIX = 'pagecount-secret/'

let passed = 0
let failed = 0
function pass(message: string): void { passed += 1; console.log(`  PASS ${message}`) }
function fail(message: string): void { failed += 1; console.error(`  FAIL ${message}`) }

function sameKeys(value: object, expected: string[], label: string): void {
  const keys = Object.keys(value).sort()
  const want = [...expected].sort()
  if (keys.join('|') === want.join('|')) pass(label)
  else fail(`${label} — 实际 [${keys.join(', ')}]，期望 [${want.join(', ')}]`)
}

async function onePagePdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create()
  pdf.addPage([500, 700])
  return Buffer.from(await pdf.save())
}

async function main(): Promise<void> {
  console.log('\n=== 我的文档页数：真实值或 null，字段白名单 ===')
  const storageDir = process.env['FILE_STORAGE_DIR']?.trim()
  if (storageDir) mkdirSync(storageDir, { recursive: true })

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const files = new FilesService(prisma, new AuditService(prisma), new StorageService())
  const assets = new MemberAssetsService(prisma)
  const pageQuery = { cursor: null, pageSize: 50 }
  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const userId = `eu_pc_${suffix}`
  const otherId = `eu_pc_b_${suffix}`
  const future = new Date(Date.now() + 60 * 60 * 1000)
  const knownId = `pc_known_${suffix}`
  const unknownId = `pc_unknown_${suffix}`
  const zeroId = `pc_zero_${suffix}`
  const negativeId = `pc_neg_${suffix}`
  const seededIds = [knownId, unknownId, zeroId, negativeId]
  const uploadedIds: string[] = []

  async function cleanup(): Promise<void> {
    for (const id of uploadedIds) {
      try { await files.systemDelete(id, 'verify-document-page-count') } catch (error) {
        console.error(`  cleanup upload ${id}: ${(error as Error).message}`)
      }
    }
    await prisma.fileObject.deleteMany({ where: { id: { in: [...seededIds, ...uploadedIds] } } })
    await prisma.endUser.deleteMany({ where: { id: { in: [userId, otherId] } } })
  }

  try {
    await cleanup()
    await prisma.endUser.create({ data: { id: userId, phoneHash: `pc-${userId}`, phoneEnc: `pc-enc-${userId}`, nickname: '页数会员' } })
    await prisma.endUser.create({ data: { id: otherId, phoneHash: `pc-${otherId}`, phoneEnc: `pc-enc-${otherId}`, nickname: '他人' } })

    const seed = (id: string, filename: string, pageCount: number | null) => prisma.fileObject.create({
      data: {
        id,
        storageKey: `${SECRET_KEY_PREFIX}${id}`,
        filename,
        mimeType: 'application/pdf',
        sizeBytes: 4321,
        sha256: SECRET_SHA,
        purpose: 'print_doc',
        pageCount,
        expiresAt: future,
        endUserId: userId,
        ownerType: 'user',
        ownerId: userId,
        status: 'active',
        createdBy: userId,
      },
    })
    await seed(knownId, 'known.pdf', 4)
    await seed(unknownId, 'unknown.pdf', null)
    await seed(zeroId, 'zero.pdf', 0)
    await seed(negativeId, 'negative.pdf', -2)

    const pdf = await onePagePdf()
    const pdfArgs: Parameters<FilesService['upload']>[0] & { pageCount: number } = {
      buffer: pdf,
      filename: 'one-page.pdf',
      mimeType: 'application/pdf',
      purpose: 'print_doc',
      uploaderId: null,
      endUserId: userId,
      pageCount: 99,
    }
    const uploadedPdf = await files.upload(pdfArgs)
    uploadedIds.push(uploadedPdf.fileId)

    const fakePdf = Buffer.from('%PDF-1.4\nthis is not a pdf page tree')
    const uploadedFake = await files.upload({
      buffer: fakePdf,
      filename: 'broken.pdf',
      mimeType: 'application/pdf',
      purpose: 'print_doc',
      uploaderId: null,
      endUserId: userId,
    })
    uploadedIds.push(uploadedFake.fileId)

    const uploadedText = await files.upload({
      buffer: Buffer.from('这是一份没有页数的纯文本简历\n'),
      filename: 'resume.txt',
      mimeType: 'text/plain',
      purpose: 'resume_upload',
      uploaderId: null,
      endUserId: userId,
    })
    uploadedIds.push(uploadedText.fileId)

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    const uploadedPng = await files.upload({
      buffer: png,
      filename: 'scan.png',
      mimeType: 'image/png',
      purpose: 'print_doc',
      uploaderId: null,
      endUserId: userId,
    })
    uploadedIds.push(uploadedPng.fileId)

    const listed = await assets.listDocuments(userId, pageQuery)
    sameKeys(listed, PAGE_KEYS, '列表响应只有 items / total / nextCursor')
    const byId = new Map(listed.items.map((item) => [item.id, item]))
    const expectIds = [...seededIds, ...uploadedIds]
    if (expectIds.every((id) => byId.has(id)) && listed.items.length === expectIds.length) {
      pass('本人列表包含全部测试文档，没有多出来的行')
    } else {
      fail(`列表条目不符：${listed.items.map((item) => item.id).join(',')}`)
    }

    for (const item of listed.items) sameKeys(item, ITEM_KEYS, `文档 ${item.filename} 字段白名单`)

    const known = byId.get(knownId)
    const knownRow = await prisma.fileObject.findUnique({ where: { id: knownId }, select: { pageCount: true } })
    if (known?.pageCount === 4 && knownRow?.pageCount === 4) pass('有页数的文件返回真实页数 4')
    else fail(`有页数的文件返回真实页数 — 列表 ${String(known?.pageCount)}，库 ${String(knownRow?.pageCount)}，期望 4`)

    const unknown = byId.get(unknownId)
    if (unknown && Object.prototype.hasOwnProperty.call(unknown, 'pageCount') && unknown.pageCount === null) {
      pass('未识别的文件返回 null，且字段存在')
    } else fail(`未识别的文件应返回 null — ${JSON.stringify(unknown ?? null)}`)

    const zero = byId.get(zeroId)
    const negative = byId.get(negativeId)
    const zeroJson = JSON.stringify(zero ?? null)
    if (zero?.pageCount === null && negative?.pageCount === null && !/"pageCount"\s*:\s*0(?!\d)/.test(zeroJson)) {
      pass('库里的 0 和负数对外是 null，不是 0')
    } else fail(`0/负数应对外为 null — zero=${zeroJson} negative=${JSON.stringify(negative ?? null)}`)

    const recognized = await recognizeStoredPageCount(pdf, 'application/pdf')
    const pdfRow = await prisma.fileObject.findUnique({
      where: { id: uploadedPdf.fileId },
      select: { pageCount: true, sizeBytes: true },
    })
    const pdfItem = byId.get(uploadedPdf.fileId)
    if (
      recognized === 1
      && pdfRow?.pageCount === 1
      && pdfItem?.pageCount === 1
      && pdfItem.pageCount !== 99
      && pdfItem.pageCount !== pdfRow.sizeBytes
    ) pass('上传的一页 PDF 返回识别页数 1，不用客户端申报的 99，也不用字节数')
    else fail(`一页 PDF 页数错误 — 识别 ${String(recognized)}，库 ${String(pdfRow?.pageCount)}，列表 ${String(pdfItem?.pageCount)}，字节 ${String(pdfRow?.sizeBytes)}`)

    const fakeRow = await prisma.fileObject.findUnique({ where: { id: uploadedFake.fileId }, select: { pageCount: true } })
    const fakeItem = byId.get(uploadedFake.fileId)
    if (fakeRow?.pageCount === null && fakeItem?.pageCount === null) pass('识别失败的 PDF 仍上传成功，页数是 null 不是 0')
    else fail(`损坏 PDF 应为 null — 库 ${String(fakeRow?.pageCount)}，列表 ${String(fakeItem?.pageCount)}`)

    const textRow = await prisma.fileObject.findUnique({ where: { id: uploadedText.fileId }, select: { pageCount: true } })
    const textItem = byId.get(uploadedText.fileId)
    if (textRow?.pageCount === null && textItem?.pageCount === null) pass('纯文本简历没有可识别页数，返回 null')
    else fail(`纯文本应为 null — 库 ${String(textRow?.pageCount)}，列表 ${String(textItem?.pageCount)}`)

    const pngRow = await prisma.fileObject.findUnique({
      where: { id: uploadedPng.fileId },
      select: { pageCount: true, sizeBytes: true },
    })
    const pngItem = byId.get(uploadedPng.fileId)
    if (pngRow?.pageCount === 1 && pngItem?.pageCount === 1 && pngItem.pageCount !== pngRow.sizeBytes) {
      pass('图片按文件类型识别为 1 页，不用字节数')
    } else fail(`图片页数错误 — 库 ${String(pngRow?.pageCount)}，列表 ${String(pngItem?.pageCount)}，字节 ${String(pngRow?.sizeBytes)}`)

    const body = JSON.stringify(listed)
    if (/"pageCount"\s*:\s*0(?!\d)/.test(body)) fail('响应里出现了页数 0')
    else pass('整页响应没有页数 0')
    if (body.includes(SECRET_SHA) || body.includes(SECRET_KEY_PREFIX) || body.includes('storageKey') || body.includes('sha256')) {
      fail('响应泄露了存储键或摘要')
    } else pass('响应没有存储键、摘要字段或种子密文')

    const other = await assets.listDocuments(otherId, pageQuery)
    if (other.items.length === 0) pass('他人看不到这些文档')
    else fail(`他人列表不应有文档：${other.items.map((item) => item.id).join(',')}`)

    const typed: MemberDocumentItem | undefined = known
    if (typed && typed.pageCount === 4) pass('列表项类型带 pageCount')
    else fail('列表项类型未能带上真实页数')
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }

  if (failed > 0) {
    console.error(`\nFAIL ${failed} / PASS ${passed}\n`)
    process.exit(1)
  }
  console.log(`\nALL PASS (${passed})\n`)
}

main().catch((error: unknown) => {
  console.error('\nFatal:', (error as Error).message)
  console.error((error as Error).stack)
  process.exit(1)
})
