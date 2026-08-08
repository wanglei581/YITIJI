/**
 * 隐私遮挡（一级 · 文字层 PDF）验证。
 *
 * 依据：docs/product/pii-redaction-decision-2026-08.md §七 验收表。
 *
 * 最关键的一条：**派生件用 unpdf.extractText 提取，被遮挡的号码必须提不出来**。
 * 这是整个功能成立与否的判据 —— 如果还能提出来，说明只是画了个黑条，功能是假的。
 *
 * 运行：
 *   pnpm --filter @ai-job-print/api verify:pii-redaction
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import PDFKitDocument from 'pdfkit'
import { PrismaService } from '../src/prisma/prisma.service'
import { MaterialsService } from '../src/materials/materials.service'
import { PiiRedactionService } from '../src/materials/pii-redaction.service'
import { FilesService } from '../src/files/files.service'
import { AuditService } from '../src/audit/audit.service'
import { StorageService } from '../src/storage/storage.service'
import { LOCAL_BUCKET_SENTINEL, LOCAL_REGION_SENTINEL } from '../src/storage/storage.interface'
import { verifyFileSignature } from '../src/files/signing'
import { buildRedactedPdf } from '../src/materials/pii-redaction.util'
import type { OcrService } from '../src/ai/resume/ocr/ocr.service'
import type { PiiBox } from '../src/materials/pii-scan.util'

interface UnpdfApi {
  getDocumentProxy(data: Uint8Array): Promise<unknown>
  extractText(pdf: unknown, options?: { mergePages?: boolean }): Promise<{ totalPages: number; text: string | string[] }>
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const unpdf = require('unpdf') as UnpdfApi

/** 固定测试值。只出现在本脚本生成的临时 PDF 里，不是任何真实个人信息。 */
const TEST_ID_CARD = '110101199003078515'
const TEST_PHONE = '13800138000'
const TEST_EMAIL = 'wanglei@example.com'
const PAGE_TWO_MARKER = 'Page two carries no personal identifiers at all.'
const PAGE_THREE_MARKER = 'Reference letter attached below.'

function pass(message: string) {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

/**
 * 三页测试 PDF：
 *   p1 姓名 + 身份证号 + 手机号 + 邮箱
 *   p2 无任何 PII（用于验证"未受影响页仍是矢量文字"）
 *   p3 再次出现**同一个**身份证号（用于验证多处出现必须全部覆盖，只盖第一处就是漏盖）
 */
function buildThreePagePdf(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFKitDocument({ size: 'A4', margin: 50 })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    doc.fontSize(12)
    doc.text('Name: Wang Lei', 60, 72)
    doc.text(`ID: ${TEST_ID_CARD}`, 60, 102)
    doc.text(`Phone: ${TEST_PHONE} (mobile)`, 60, 132)
    doc.text(`Email: ${TEST_EMAIL}`, 60, 162)
    doc.text('Experience: backend engineer, 2019-2025.', 60, 192)
    doc.addPage()
    doc.text(PAGE_TWO_MARKER, 60, 72)
    doc.text('Skills: TypeScript, PostgreSQL, distributed systems, printing pipelines.', 60, 102)
    doc.addPage()
    doc.text(PAGE_THREE_MARKER, 60, 72)
    doc.text(`Applicant ID number on file: ${TEST_ID_CARD}`, 60, 102)
    doc.end()
  })
}

/** 单页空白 PDF（内容流为空）——用于直接验证渲染保真兜底。 */
function buildBlankSinglePagePdf(): Buffer {
  const header = '%PDF-1.4\n'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ]
  let body = header
  const offsets: number[] = []
  objects.forEach((obj, idx) => {
    offsets.push(Buffer.byteLength(body, 'utf8'))
    body += `${idx + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xrefStart = Buffer.byteLength(body, 'utf8')
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  offsets.forEach((off) => {
    xref += `${String(off).padStart(10, '0')} 00000 n \n`
  })
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`
  return Buffer.from(body + xref + trailer, 'utf8')
}

/** 真实、可解码的 4×4 白色 PNG（图片路径的 not_supported 用例）。 */
async function buildTinyPng(): Promise<Buffer> {
  const { createCanvas } = await import('@napi-rs/canvas')
  const canvas = createCanvas(4, 4)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 4, 4)
  return canvas.toBuffer('image/png')
}

async function extractAllText(pdfBytes: Buffer): Promise<string[]> {
  const proxy = await unpdf.getDocumentProxy(new Uint8Array(pdfBytes))
  const extracted = await unpdf.extractText(proxy, { mergePages: false })
  return Array.isArray(extracted.text) ? extracted.text : [extracted.text ?? '']
}

function checksOf(task: { result: Record<string, unknown> | null }): Record<string, unknown> {
  return (task.result?.['checks'] ?? {}) as Record<string, unknown>
}

/**
 * §3.3 禁用文案的服务端静态门禁。
 *
 * 仓库根的 verify:compliance-copy 只扫 apps/&#42;/src，**不扫 services/api**，
 * 所以后端自己产出的用户可见文案没有任何门禁覆盖 —— 这里补上。
 *
 * "已遮挡" 本身不是禁词：决策文档允许 "已遮挡你确认的 N 处 · 请核对预览"（有限定），
 * 禁的是不带限定的绝对化断言。所以用负向断言而不是简单子串匹配。
 */
function verifyForbiddenClaimCopy(): void {
  const forbidden: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /已遮挡(?!你确认的)/, label: '不带限定的「已遮挡」' },
    { pattern: /已无隐私信息/, label: '「已无隐私信息」' },
    { pattern: /隐私已保护/, label: '「隐私已保护」' },
  ]
  const sources = ['src/materials/materials.service.ts', 'src/materials/pii-redaction.util.ts', 'src/materials/pii-scan.util.ts']
  const offenders: string[] = []
  for (const relative of sources) {
    const content = readFileSync(join(__dirname, '..', relative), 'utf-8')
    for (const line of content.split('\n')) {
      // 只看会出现在用户可见文案里的中文字符串字面量；注释行不算。
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue
      for (const { pattern, label } of forbidden) {
        if (pattern.test(line)) offenders.push(`${relative}: ${label} → ${line.trim().slice(0, 90)}`)
      }
    }
  }
  if (offenders.length === 0) {
    pass('C. 服务端遮挡相关文案不含 §3.3 禁用断言（仓库根 verify:compliance-copy 不扫 services/api，这条在这里补齐）')
  } else {
    fail(`C. 服务端文案越界：\n    ${offenders.join('\n    ')}`)
  }
}

async function main() {
  console.log('\n=== 隐私遮挡（一级 · 文字层 PDF）验证 ===')
  verifyForbiddenClaimCopy()
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const storage = new StorageService()
  const audit = new AuditService(prisma)
  const files = new FilesService(prisma, audit, storage)
  // 文字层 PDF 路径不该触发任何 OCR；触发即立刻失败，而不是悄悄返回貌似合理的结果。
  const strictNoOcr: Pick<OcrService, 'recognize'> = {
    recognize: async () => fail('unexpected OCR call on the born-digital text-layer path'),
  }
  const materials = new MaterialsService(prisma, storage, strictNoOcr as unknown as OcrService, new PiiRedactionService(prisma, storage, strictNoOcr as unknown as OcrService, files))

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const ownerId = `eu_redact_${suffix}`
  const pdfFileId = `file_redact_pdf_${suffix}`
  const imageFileId = `file_redact_img_${suffix}`
  const keepOnlyFileId = `file_redact_keep_${suffix}`
  const anonFileId = `file_redact_anon_${suffix}`
  const seededFileIds = [pdfFileId, imageFileId, keepOnlyFileId, anonFileId]
  const pdfObjectKey = `verify/pii-redaction/${pdfFileId}.pdf`
  const imageObjectKey = `verify/pii-redaction/${imageFileId}.png`
  const keepOnlyObjectKey = `verify/pii-redaction/${keepOnlyFileId}.pdf`
  const anonObjectKey = `verify/pii-redaction/${anonFileId}.pdf`
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
  const derivedFileIds: string[] = []

  try {
    await prisma.endUser.create({
      data: { id: ownerId, phoneHash: `redact-hash-${suffix}`, phoneEnc: `redact-enc-${suffix}` },
    })

    const pdfBytes = await buildThreePagePdf()
    const put = await storage.putObject(pdfObjectKey, pdfBytes, 'application/pdf', LOCAL_BUCKET_SENTINEL)
    await prisma.fileObject.create({
      data: {
        id: pdfFileId,
        storageKey: pdfObjectKey,
        bucket: LOCAL_BUCKET_SENTINEL,
        region: LOCAL_REGION_SENTINEL,
        filename: 'resume.pdf',
        mimeType: 'application/pdf',
        sizeBytes: put.sizeBytes,
        sha256: put.sha256,
        purpose: 'resume_upload',
        sensitiveLevel: 'highly_sensitive',
        expiresAt,
        endUserId: ownerId,
        ownerType: 'user',
        ownerId,
      },
    })

    // ── 0. 前提：原件本身确实能提取出这些值（否则后面的"提不出来"毫无意义）──────────
    const sourceText = (await extractAllText(pdfBytes)).join('\n')
    if (sourceText.includes(TEST_ID_CARD) && sourceText.includes(TEST_PHONE) && sourceText.includes(PAGE_TWO_MARKER)) {
      pass('0. 原件文字层确实含身份证号 / 手机号 / 第二页正文（后续"提不出来"才有意义）')
    } else {
      fail(`0. 原件文字层缺少预期内容，测试前提不成立：${JSON.stringify(sourceText.slice(0, 200))}`)
    }

    // ── 1. pii_scan：命中项带真实坐标 ─────────────────────────────────────────────
    const scanTask = await materials.createTask(
      { kind: 'pii_scan', sourceFileId: pdfFileId, params: {} },
      { kind: 'member', endUserId: ownerId },
    )
    const findings = scanTask.piiFindings ?? []
    const idFinding = findings.find((finding) => finding.type === 'id_card')
    const phoneFinding = findings.find((finding) => finding.type === 'phone')
    const emailFinding = findings.find((finding) => finding.type === 'email')
    if (!idFinding || !phoneFinding || !emailFinding) {
      fail(`1. 期望检出 id_card / phone / email，实际：${JSON.stringify(findings.map((f) => f.type))}`)
    }
    const idBoxes = idFinding.boxes ?? []
    if (
      idBoxes.length >= 2 &&
      idBoxes.every((box) => box.width > 0 && box.height > 0 && box.pageWidth > 400 && box.pageHeight > 700)
    ) {
      pass(`1a. 身份证号带 ${idBoxes.length} 个矩形（含页面尺寸），覆盖它在文档里的多处出现`)
    } else {
      fail(`1a. 期望身份证号在 p1/p3 各有矩形，实际：${JSON.stringify(idBoxes)}`)
    }
    const idPages = new Set(idBoxes.map((box) => box.pageNumber))
    if (idPages.has(1) && idPages.has(3)) {
      pass('1b. 同一个身份证号在第 1、3 页的出现都被记录（只盖第一处就是漏盖）')
    } else {
      fail(`1b. 期望身份证号矩形覆盖第 1、3 页，实际页码：${JSON.stringify([...idPages])}`)
    }
    if ((phoneFinding.boxes ?? []).length >= 1 && phoneFinding.pageNumber === 1) {
      pass('1c. 手机号带矩形且页码为真实页码（改动前 born-digital 路径的 pageNumber 恒为 null）')
    } else {
      fail(`1c. 手机号缺少矩形或页码不对：${JSON.stringify({ page: phoneFinding.pageNumber, boxes: phoneFinding.boxes })}`)
    }
    const storedFindings = await prisma.piiFinding.findMany({ where: { taskId: scanTask.id } })
    const storedBlob = JSON.stringify(storedFindings)
    if (!storedBlob.includes(TEST_ID_CARD) && !storedBlob.includes(TEST_PHONE) && !storedBlob.includes(TEST_EMAIL)) {
      pass('1d. 坐标落库不带任何 PII 原文（boxesJson 只有数字坐标）')
    } else {
      fail('1d. PiiFinding 落库出现了 PII 原文')
    }

    // ── 2. 裁决：遮挡身份证号 + 手机号，保留邮箱 ──────────────────────────────────
    const settled = await materials.decidePiiFindings(
      scanTask.id,
      {
        decisions: findings.map((finding) => ({
          findingId: finding.id,
          action: finding.type === 'id_card' || finding.type === 'phone' ? ('redact' as const) : ('keep' as const),
        })),
      },
      { kind: 'member', endUserId: ownerId },
    )

    // ── 3. pii_redact：真的生成派生件 ────────────────────────────────────────────
    const redactTask = await materials.createTask(
      { kind: 'pii_redact', sourceFileId: pdfFileId, params: { decisionTaskId: settled.id } },
      { kind: 'member', endUserId: ownerId },
    )
    const checks = checksOf(redactTask)
    const redactedFileId = typeof checks['redactedFileId'] === 'string' ? checks['redactedFileId'] : null
    if (redactedFileId) derivedFileIds.push(redactedFileId)
    if (redactedFileId && checks['resultFileCreated'] === true) {
      pass('3a. 生成了真实的遮挡派生件（不再恒为 resultFileCreated:false）')
    } else {
      fail(`3a. 期望生成派生件，实际：${JSON.stringify(checks)}`)
    }
    if (redactTask.resultFileId === redactedFileId) {
      pass('3b. 任务 resultFileId 指向派生件')
    } else {
      fail(`3b. 期望 task.resultFileId === ${redactedFileId}，实际 ${redactTask.resultFileId}`)
    }
    if (JSON.stringify(checks['rasterizedPages']) === JSON.stringify([1, 3])) {
      pass('3c. 只有第 1、3 页被栅格化（第 2 页没有遮挡，不该被牺牲）')
    } else {
      fail(`3c. 期望 rasterizedPages=[1,3]，实际 ${JSON.stringify(checks['rasterizedPages'])}`)
    }

    // ── 3d. 匿名可取：一体机是匿名使用的，只给 fileId 等于功能不可用 ─────────────────
    const redactedFileUrl = typeof checks['redactedFileUrl'] === 'string' ? checks['redactedFileUrl'] : null
    if (redactedFileUrl && redactedFileUrl.includes(`/files/${redactedFileId}/content`)) {
      pass('3d. 结果直接带 checks.redactedFileUrl（/files/:id/content 签名链接，该端点不挂 JwtAuthGuard）')
    } else {
      fail(`3d. 期望 checks.redactedFileUrl 指向 /files/${redactedFileId}/content，实际 ${JSON.stringify(checks['redactedFileUrl'])}`)
    }
    const urlParams = new URLSearchParams(redactedFileUrl!.split('?')[1] ?? '')
    const expires = urlParams.get('expires') ?? ''
    const sig = urlParams.get('sig') ?? ''
    if (verifyFileSignature(redactedFileId!, expires, sig)) {
      pass('3e. 签名 URL 真实可验签（不是拼出来的假链接）')
    } else {
      fail('3e. checks.redactedFileUrl 的 HMAC 签名验不过')
    }
    const ttlMs = Number(expires) - Date.now()
    if (ttlMs > 0 && ttlMs <= 60 * 60 * 1000) {
      pass(`3f. 链接 TTL 受限（约 ${Math.round(ttlMs / 60000)} 分钟），不是长期公开 URL`)
    } else {
      fail(`3f. 链接 TTL 异常：${ttlMs}ms`)
    }
    const storedResult = await prisma.documentProcessTask.findUnique({ where: { id: redactTask.id } })
    if (!(storedResult?.resultJson ?? '').includes('sig=')) {
      pass('3g. 签名 URL 不落库（bearer capability 不该在 DB 里躺满任务 24 小时有效期）')
    } else {
      fail('3g. resultJson 里持久化了签名 URL')
    }
    // 走 controller 同一条链路：验签 → FilesService.readContent（不带任何登录态）。
    // 只验签名格式不够 —— 前端 fail-closed 第 3 条要求"claim 说成功就必须真的取得到文件"。
    const urlFileId = redactedFileUrl!.split('/files/')[1]!.split('/content')[0]!
    if (verifyFileSignature(urlFileId, expires, sig)) {
      const fetched = await files.readContent(urlFileId)
      const fetchedText = (await extractAllText(fetched.buffer)).join('\n')
      if (
        fetched.mimeType === 'application/pdf' &&
        !fetchedText.includes(TEST_ID_CARD) &&
        fetchedText.includes(PAGE_TWO_MARKER)
      ) {
        pass('3d2. 按该链接（仅凭签名、无登录态）真的取回了遮挡后的 PDF 字节')
      } else {
        fail(`3d2. 链接取回的内容不对：mime=${fetched.mimeType}`)
      }
    } else {
      fail('3d2. 链接验签失败，无法取回内容')
    }

    const reread = await materials.getTask(redactTask.id, { kind: 'member', endUserId: ownerId })
    const rereadUrl = (checksOf(reread)['redactedFileUrl'] ?? '') as string
    if (rereadUrl.includes(`/files/${redactedFileId}/content`) && rereadUrl.includes('sig=')) {
      pass('3h. 再次查询任务时重新签发链接（任务 24h 内不会拿到早已过期的链接）')
    } else {
      fail(`3h. 重新读取任务没有拿到新鲜链接：${JSON.stringify(rereadUrl)}`)
    }

    // ── 4. 最关键的一条：派生件里提不出被遮挡的号码 ───────────────────────────────
    const derived = await prisma.fileObject.findUnique({ where: { id: redactedFileId! } })
    if (!derived) fail('4. 派生件 FileObject 不存在')
    const derivedBytes = await storage.getObject(derived.storageKey, derived.bucket)
    const derivedPages = await extractAllText(derivedBytes)
    const derivedText = derivedPages.join('\n')
    if (!derivedText.includes(TEST_ID_CARD)) {
      pass('4a. 【核心判据】派生件用 unpdf.extractText 提取，身份证号提不出来')
    } else {
      fail('4a. 【核心判据失败】派生件仍能提取出身份证号 —— 只是画了个黑条，功能是假的')
    }
    if (!derivedText.includes(TEST_PHONE)) {
      pass('4b. 【核心判据】派生件提取不出手机号')
    } else {
      fail('4b. 【核心判据失败】派生件仍能提取出手机号')
    }
    if (derivedPages[1]?.includes(PAGE_TWO_MARKER)) {
      pass('4c. 未受影响的第 2 页仍是矢量文字，可正常提取（没有被无谓栅格化）')
    } else {
      fail(`4c. 第 2 页文字层丢失，说明未受影响页也被栅格化了：${JSON.stringify(derivedPages[1]?.slice(0, 120))}`)
    }
    if (!derivedPages[0]?.trim() && !derivedPages[2]?.trim()) {
      pass('4d. 被遮挡的第 1、3 页已无任何文字层（整页烧成像素，不可逆）')
    } else {
      fail(`4d. 期望第 1、3 页无文字层，实际 p1=${JSON.stringify(derivedPages[0]?.slice(0, 80))} p3=${JSON.stringify(derivedPages[2]?.slice(0, 80))}`)
    }
    if (derivedText.includes(TEST_EMAIL) === false && derivedPages[0]?.trim() === '') {
      pass('4e. 用户选择"保留"的邮箱位于已栅格化页，随该页一起变成图片（如实反映在 items 里）')
    } else {
      pass('4e. 保留项仍可提取（该项所在页未被栅格化）')
    }

    // ── 5. 复检与逐项结果如实 ───────────────────────────────────────────────────
    const reverify = checks['reverify'] as Record<string, unknown> | undefined
    if (reverify?.['ran'] === true && reverify['remainingCount'] === 0 && reverify['method'] === 'text_layer') {
      pass('5a. 复检在派生件上真实跑过，remainingCount=0')
    } else {
      fail(`5a. 期望复检跑过且 remainingCount=0，实际 ${JSON.stringify(reverify)}`)
    }
    // 前端把缺失的 remainingCount 解析成 null 而非 0（缺失 ≠ 零残留），所以这个字段永远不能省。
    if (reverify && 'remainingCount' in reverify && 'ran' in reverify && 'method' in reverify) {
      pass('5a2. reverify 三个字段都显式出现（省略 remainingCount 会被前端判为"无法确认"，不是零残留）')
    } else {
      fail(`5a2. reverify 字段不全：${JSON.stringify(reverify)}`)
    }
    if (checks['claim'] === 'redacted_verified') {
      pass('5b. claim=redacted_verified（生成成功 + 复检 0 残留）')
    } else {
      fail(`5b. 期望 claim=redacted_verified，实际 ${JSON.stringify(checks['claim'])}`)
    }
    const items = (checks['items'] ?? []) as Array<Record<string, unknown>>
    const idItem = items.find((item) => item['type'] === 'id_card')
    const emailItem = items.find((item) => item['type'] === 'email')
    if (
      idItem?.['requested'] === 'redact' &&
      idItem['applied'] === 'redacted' &&
      emailItem?.['requested'] === 'keep' &&
      emailItem['applied'] === 'kept'
    ) {
      pass('5c. items 逐项反映真实结果（不是笼统成功）')
    } else {
      fail(`5c. items 未如实反映逐项结果：${JSON.stringify(items)}`)
    }

    // ── 6. 血缘 ────────────────────────────────────────────────────────────────
    if (derived.sourceFileId === pdfFileId && derived.assetCategory === 'derived' && derived.endUserId === ownerId) {
      pass('6. 派生件血缘正确：sourceFileId 指向原件、assetCategory=derived、归属本人')
    } else {
      fail(`6. 血缘字段不对：${JSON.stringify({ sourceFileId: derived.sourceFileId, assetCategory: derived.assetCategory, endUserId: derived.endUserId })}`)
    }
    if (derived.sensitiveLevel === 'highly_sensitive') {
      pass('6b. 派生件敏感等级不低于原件（遮挡后仍是求职材料）')
    } else {
      fail(`6b. 期望派生件敏感等级 >= 原件 highly_sensitive，实际 ${derived.sensitiveLevel}`)
    }

    // ── 7. 拿不到坐标 → not_supported，且零文件产出 ───────────────────────────────
    const pngBytes = await buildTinyPng()
    const pngPut = await storage.putObject(imageObjectKey, pngBytes, 'image/png', LOCAL_BUCKET_SENTINEL)
    await prisma.fileObject.create({
      data: {
        id: imageFileId,
        storageKey: imageObjectKey,
        bucket: LOCAL_BUCKET_SENTINEL,
        region: LOCAL_REGION_SENTINEL,
        filename: 'scanned-resume.png',
        mimeType: 'image/png',
        sizeBytes: pngPut.sizeBytes,
        sha256: pngPut.sha256,
        purpose: 'resume_scan',
        sensitiveLevel: 'highly_sensitive',
        expiresAt,
        endUserId: ownerId,
        ownerType: 'user',
        ownerId,
      },
    })
    const imageOcr: Pick<OcrService, 'recognize'> = {
      recognize: async () => ({ ok: true as const, text: `身份证 ${TEST_ID_CARD}，电话 ${TEST_PHONE}`, confidence: 'high' as const }),
    }
    const materialsImageOcr = new MaterialsService(prisma, storage, imageOcr as unknown as OcrService, new PiiRedactionService(prisma, storage, imageOcr as unknown as OcrService, files))
    const imageScan = await materialsImageOcr.createTask(
      { kind: 'pii_scan', sourceFileId: imageFileId, params: {} },
      { kind: 'member', endUserId: ownerId },
    )
    const imageFindings = imageScan.piiFindings ?? []
    if (imageFindings.length > 0 && imageFindings.every((finding) => (finding.boxes ?? []).length === 0)) {
      pass('7a. 扫描件 OCR 路径检出命中但没有坐标（百度 accurate_basic 不返回 location，如实为空）')
    } else {
      fail(`7a. 期望扫描件命中项 boxes 为空，实际 ${JSON.stringify(imageFindings.map((f) => f.boxes))}`)
    }
    const imageSettled = await materialsImageOcr.decidePiiFindings(
      imageScan.id,
      { decisions: imageFindings.map((finding) => ({ findingId: finding.id, action: 'redact' as const })) },
      { kind: 'member', endUserId: ownerId },
    )
    const filesBefore = await prisma.fileObject.count({ where: { sourceFileId: imageFileId } })
    const imageRedact = await materialsImageOcr.createTask(
      { kind: 'pii_redact', sourceFileId: imageFileId, params: { decisionTaskId: imageSettled.id } },
      { kind: 'member', endUserId: ownerId },
    )
    const imageChecks = checksOf(imageRedact)
    const filesAfter = await prisma.fileObject.count({ where: { sourceFileId: imageFileId } })
    if (
      imageChecks['claim'] === 'not_supported' &&
      imageChecks['notSupportedReason'] === 'unsupported_format' &&
      imageChecks['redactedFileId'] === null &&
      imageChecks['redactedFileUrl'] === null &&
      imageChecks['resultFileCreated'] === false
    ) {
      pass('7b. 拿不到坐标 → claim=not_supported + 明确 reason，redactedFileId / redactedFileUrl 均为 null')
    } else {
      fail(`7b. 期望 not_supported/unsupported_format，实际 ${JSON.stringify(imageChecks)}`)
    }
    if (filesAfter === filesBefore && imageRedact.resultFileId === null) {
      pass('7c. not_supported 时确实零文件产出（不留半成品）')
    } else {
      fail(`7c. not_supported 却产出了文件：before=${filesBefore} after=${filesAfter} resultFileId=${imageRedact.resultFileId}`)
    }
    const imageItems = (imageChecks['items'] ?? []) as Array<Record<string, unknown>>
    if (imageItems.length > 0 && imageItems.every((item) => item['applied'] === 'failed_no_position')) {
      pass('7d. 逐项结果如实标记 failed_no_position（不是笼统失败，也不谎称已遮挡）')
    } else {
      fail(`7d. 期望所有项 applied=failed_no_position，实际 ${JSON.stringify(imageItems)}`)
    }
    const imageReverify = imageChecks['reverify'] as Record<string, unknown> | undefined
    if (imageReverify && imageReverify['remainingCount'] === 0 && imageReverify['ran'] === false && imageReverify['method'] === 'skipped') {
      pass('7d2. not_supported 时 reverify 仍完整给出（ran:false / method:skipped），字段从不省略')
    } else {
      fail(`7d2. not_supported 的 reverify 字段不全：${JSON.stringify(imageReverify)}`)
    }
    const notSupportedText = JSON.stringify(imageChecks['messages'] ?? [])
    if (!notSupportedText.includes('已遮挡') && !notSupportedText.includes('已无隐私')) {
      pass('7e. not_supported 文案不出现"已遮挡 / 已无隐私信息"')
    } else {
      fail(`7e. not_supported 文案越界：${notSupportedText}`)
    }

    // ── 8. 一处都没勾选遮挡 → nothing_to_redact，同样零文件产出 ────────────────────
    const keepPdfBytes = await buildThreePagePdf()
    const keepPut = await storage.putObject(keepOnlyObjectKey, keepPdfBytes, 'application/pdf', LOCAL_BUCKET_SENTINEL)
    await prisma.fileObject.create({
      data: {
        id: keepOnlyFileId,
        storageKey: keepOnlyObjectKey,
        bucket: LOCAL_BUCKET_SENTINEL,
        region: LOCAL_REGION_SENTINEL,
        filename: 'resume-keep-all.pdf',
        mimeType: 'application/pdf',
        sizeBytes: keepPut.sizeBytes,
        sha256: keepPut.sha256,
        purpose: 'resume_upload',
        sensitiveLevel: 'highly_sensitive',
        expiresAt,
        endUserId: ownerId,
        ownerType: 'user',
        ownerId,
      },
    })
    const keepScan = await materials.createTask(
      { kind: 'pii_scan', sourceFileId: keepOnlyFileId, params: {} },
      { kind: 'member', endUserId: ownerId },
    )
    const keepSettled = await materials.decidePiiFindings(
      keepScan.id,
      { decisions: (keepScan.piiFindings ?? []).map((finding) => ({ findingId: finding.id, action: 'keep' as const })) },
      { kind: 'member', endUserId: ownerId },
    )
    const keepRedact = await materials.createTask(
      { kind: 'pii_redact', sourceFileId: keepOnlyFileId, params: { decisionTaskId: keepSettled.id } },
      { kind: 'member', endUserId: ownerId },
    )
    const keepChecks = checksOf(keepRedact)
    const keepDerivedCount = await prisma.fileObject.count({ where: { sourceFileId: keepOnlyFileId } })
    if (keepChecks['claim'] === 'nothing_to_redact' && keepChecks['redactedFileId'] === null && keepDerivedCount === 0) {
      pass('8. 一处都没勾选遮挡 → claim=nothing_to_redact，不生成任何文件')
    } else {
      fail(`8. 期望 nothing_to_redact 且零文件，实际 ${JSON.stringify(keepChecks['claim'])} / derived=${keepDerivedCount}`)
    }

    // ── 9. 决策未完成仍然阻塞（原有前置校验没有被本次改动放松）────────────────────
    const pendingScan = await materials.createTask(
      { kind: 'pii_scan', sourceFileId: pdfFileId, params: {} },
      { kind: 'member', endUserId: ownerId },
    )
    const pendingRedact = await materials.createTask(
      { kind: 'pii_redact', sourceFileId: pdfFileId, params: { decisionTaskId: pendingScan.id } },
      { kind: 'member', endUserId: ownerId },
    )
    const pendingChecks = checksOf(pendingRedact)
    if (
      pendingChecks['canRedact'] === false &&
      pendingChecks['claim'] === 'not_supported' &&
      pendingChecks['notSupportedReason'] === 'decisions_pending' &&
      pendingChecks['redactedFileId'] === null
    ) {
      pass('9. 仍有未裁决项时继续阻塞，且 claim / reason 如实')
    } else {
      fail(`9. 期望 decisions_pending 阻塞，实际 ${JSON.stringify(pendingChecks)}`)
    }

    // ── 9b. 匿名路径（一体机的真实主路径：不登录、只有 task token）──────────────────
    const anonPdfBytes = await buildThreePagePdf()
    const anonPut = await storage.putObject(anonObjectKey, anonPdfBytes, 'application/pdf', LOCAL_BUCKET_SENTINEL)
    await prisma.fileObject.create({
      data: {
        id: anonFileId,
        storageKey: anonObjectKey,
        bucket: LOCAL_BUCKET_SENTINEL,
        region: LOCAL_REGION_SENTINEL,
        filename: 'walk-in-resume.pdf',
        mimeType: 'application/pdf',
        sizeBytes: anonPut.sizeBytes,
        sha256: anonPut.sha256,
        purpose: 'print_doc',
        sensitiveLevel: 'normal',
        expiresAt,
        endUserId: null,
        ownerType: 'system',
        ownerId: null,
      },
    })
    const anonScan = await materials.createTask({ kind: 'pii_scan', sourceFileId: anonFileId, params: {} }, { kind: 'anonymous' })
    const anonToken = anonScan.accessToken
    if (!anonToken) fail('9b. 匿名 pii_scan 未返回 access token')
    const anonSettled = await materials.decidePiiFindings(
      anonScan.id,
      {
        decisions: (anonScan.piiFindings ?? []).map((finding) => ({
          findingId: finding.id,
          action: finding.type === 'id_card' ? ('redact' as const) : ('keep' as const),
        })),
      },
      { kind: 'anonymous', accessToken: anonToken },
    )
    const anonRedact = await materials.createTask(
      { kind: 'pii_redact', sourceFileId: anonFileId, params: { decisionTaskId: anonSettled.id } },
      { kind: 'anonymous', accessToken: anonToken },
    )
    const anonChecks = checksOf(anonRedact)
    const anonFileIdOut = typeof anonChecks['redactedFileId'] === 'string' ? anonChecks['redactedFileId'] : null
    if (anonFileIdOut) derivedFileIds.push(anonFileIdOut)
    const anonUrl = typeof anonChecks['redactedFileUrl'] === 'string' ? anonChecks['redactedFileUrl'] : null
    if (anonChecks['claim'] === 'redacted_verified' && anonFileIdOut && anonUrl) {
      pass('9b. 匿名（未登录）路径同样生成派生件并带可访问链接')
    } else {
      fail(`9b. 匿名路径未能生成派生件：${JSON.stringify(anonChecks)}`)
    }
    const anonParams = new URLSearchParams(anonUrl!.split('?')[1] ?? '')
    if (verifyFileSignature(anonFileIdOut!, anonParams.get('expires') ?? '', anonParams.get('sig') ?? '')) {
      const anonFetched = await files.readContent(anonFileIdOut!)
      const anonText = (await extractAllText(anonFetched.buffer)).join('\n')
      if (!anonText.includes(TEST_ID_CARD)) {
        pass('9c. 匿名派生件同样提取不出身份证号，且仅凭签名即可取回（无登录态）')
      } else {
        fail('9c. 匿名派生件仍能提取出身份证号')
      }
    } else {
      fail('9c. 匿名派生件链接验签失败')
    }
    const anonDerived = await prisma.fileObject.findUnique({ where: { id: anonFileIdOut! } })
    if (anonDerived?.endUserId === null && anonDerived.sourceFileId === anonFileId && anonDerived.assetCategory === 'derived') {
      pass('9d. 匿名派生件不被错误挂到任何会员名下，血缘仍指向原件')
    } else {
      fail(`9d. 匿名派生件归属/血缘不对：${JSON.stringify({ endUserId: anonDerived?.endUserId, sourceFileId: anonDerived?.sourceFileId })}`)
    }

    // ── 10. 渲染保真兜底：页面渲染不出内容时整单失败，不产出"只剩黑条的白纸" ────────
    const blankPdf = buildBlankSinglePagePdf()
    const fakeBox: PiiBox = { pageNumber: 1, x: 60, y: 700, width: 120, height: 16, pageWidth: 595, pageHeight: 842 }
    const guarded = await buildRedactedPdf(blankPdf, [fakeBox], new Map([[1, 500]]))
    if (!guarded.ok && guarded.reason === 'render_unverified') {
      pass('10a. 文字层声称有 500 字但渲染几乎无墨 → render_unverified，整单失败不产文件')
    } else {
      fail(`10a. 期望 render_unverified，实际 ${JSON.stringify(guarded.ok ? 'ok' : guarded.reason)}`)
    }
    const unguarded = await buildRedactedPdf(blankPdf, [fakeBox], new Map([[1, 0]]))
    if (unguarded.ok) {
      pass('10b. 同一页在文字层本就为空时正常通过（兜底只抓"该有字却没画出来"，不误伤空白页）')
    } else {
      fail(`10b. 空白页不该被兜底拦下，实际 ${unguarded.reason}`)
    }
  } finally {
    await prisma.piiFinding.deleteMany({ where: { task: { sourceFileId: { in: [...seededFileIds, ...derivedFileIds] } } } })
    await prisma.documentProcessTask.deleteMany({ where: { sourceFileId: { in: [...seededFileIds, ...derivedFileIds] } } })
    for (const derivedId of derivedFileIds) {
      const record = await prisma.fileObject.findUnique({ where: { id: derivedId } }).catch(() => null)
      if (record) await storage.deleteObject(record.storageKey, record.bucket).catch(() => undefined)
    }
    await prisma.fileObject.deleteMany({ where: { sourceFileId: { in: seededFileIds } } })
    await prisma.fileObject.deleteMany({ where: { id: { in: seededFileIds } } })
    await prisma.endUser.deleteMany({ where: { id: { in: [ownerId] } } })
    await storage.deleteObject(pdfObjectKey, LOCAL_BUCKET_SENTINEL).catch(() => undefined)
    await storage.deleteObject(imageObjectKey, LOCAL_BUCKET_SENTINEL).catch(() => undefined)
    await storage.deleteObject(keepOnlyObjectKey, LOCAL_BUCKET_SENTINEL).catch(() => undefined)
    await storage.deleteObject(anonObjectKey, LOCAL_BUCKET_SENTINEL).catch(() => undefined)
    await prisma.onModuleDestroy()
  }

  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  process.exit(1)
})
