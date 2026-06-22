/**
 * Phase 1A — 简历文件文字提取 + OCR 底座 验证。
 *
 * 目的：
 *   离线、零外部费用地验证 ResumeExtractionService 真实提取（mammoth/unpdf），
 *   各失败边界返回明确 errorCode（绝不返回 mock/假文本），OCR 默认 disabled 时
 *   图片诚实失败，且我方日志不泄漏简历原文 / buffer。
 *
 *   DOCX / 文本型 PDF 样例在脚本内手搓（stored ZIP + 精确 xref），不引入任何二进制 fixture。
 *
 * 运行：
 *   pnpm --filter @ai-job-print/api verify:resume-extraction
 */
import 'dotenv/config'
import zlib from 'node:zlib'
import { Logger } from '@nestjs/common'
import { ResumeExtractionService } from '../src/ai/resume/resume-extraction.service'
import { OcrService } from '../src/ai/resume/ocr/ocr.service'
import { DisabledOcrProvider } from '../src/ai/resume/ocr/disabled-ocr.provider'
import { TencentOcrProvider } from '../src/ai/resume/ocr/tencent-ocr.provider.stub'
import { BaiduOcrProvider } from '../src/ai/resume/ocr/baidu-ocr.provider'

const SENTINEL = 'ZZ_SECRET_RESUME_TOKEN_42'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const DOC_MIME = 'application/msword'
const PDF_MIME = 'application/pdf'

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  process.exit(1)
}

function assert(cond: unknown, message: string): void {
  if (cond) pass(message)
  else fail(message)
}

// ── 手搓最小 DOCX（stored ZIP，CRC32 用 Node 26 内置 zlib.crc32）──────────────

function crc32(buf: Buffer): number {
  return zlib.crc32(buf) >>> 0
}

function buildZip(entries: { name: string; data: Buffer }[]): Buffer {
  const localChunks: Buffer[] = []
  const centralChunks: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8')
    const data = e.data
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8) // stored
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    localChunks.push(local, nameBuf, data)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0, 8)
    cd.writeUInt16LE(0, 10) // stored
    cd.writeUInt16LE(0, 12)
    cd.writeUInt16LE(0, 14)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(data.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt16LE(0, 30)
    cd.writeUInt16LE(0, 32)
    cd.writeUInt16LE(0, 34)
    cd.writeUInt16LE(0, 36)
    cd.writeUInt32LE(0, 38)
    cd.writeUInt32LE(offset, 42)
    centralChunks.push(cd, nameBuf)

    offset += 30 + nameBuf.length + data.length
  }
  const centralStart = offset
  const centralSize = centralChunks.reduce((n, c) => n + c.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(centralStart, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...localChunks, ...centralChunks, eocd])
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function buildDocx(paragraphs: string[]): Buffer {
  const body = paragraphs
    .map((p) => `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(p)}</w:t></w:r></w:p>`)
    .join('')
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${body}</w:body></w:document>`
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `</Types>`
  const rels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`
  return buildZip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') },
  ])
}

// ── 手搓最小文本型 PDF（标准 Helvetica，精确 xref 偏移）─────────────────────────

function buildTextPdf(lines: string[]): Buffer {
  const header = '%PDF-1.4\n'
  const objects: string[] = []
  objects.push('<< /Type /Catalog /Pages 2 0 R >>')
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  objects.push(
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  )
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')

  let content = 'BT\n/F1 12 Tf\n72 720 Td\n'
  lines.forEach((ln, i) => {
    const esc = ln.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
    if (i > 0) content += '0 -16 Td\n'
    content += `(${esc}) Tj\n`
  })
  content += 'ET'
  objects.push(`<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`)

  let bodyStr = header
  const offsets: number[] = []
  objects.forEach((obj, idx) => {
    offsets.push(Buffer.byteLength(bodyStr, 'utf8'))
    bodyStr += `${idx + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xrefStart = Buffer.byteLength(bodyStr, 'utf8')
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  offsets.forEach((off) => {
    xref += `${String(off).padStart(10, '0')} 00000 n \n`
  })
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`
  return Buffer.from(bodyStr + xref + trailer, 'utf8')
}

// ── 验证主流程 ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n=== Phase 1A 简历文件文字提取 + OCR 底座 验证 ===')

  // 收集我方 Logger 输出，用于「日志不泄漏原文」断言
  const logged: string[] = []
  Logger.overrideLogger({
    log: (m: unknown) => logged.push(String(m)),
    error: (m: unknown) => logged.push(String(m)),
    warn: (m: unknown) => logged.push(String(m)),
    debug: () => {},
    verbose: () => {},
    fatal: () => {},
  })

  // 干净 OCR 默认态
  delete process.env['TENCENT_OCR_SECRET_ID']
  delete process.env['TENCENT_OCR_SECRET_KEY']
  process.env['OCR_PROVIDER'] = 'disabled'

  const ocrDisabled = new OcrService(new DisabledOcrProvider(), new TencentOcrProvider(), new BaiduOcrProvider())

  type Fixture = { buffer: Buffer; mimeType: string; filename: string; purpose: string; endUserId: string | null }
  const fixtures = new Map<string, Fixture>()
  const fakeFiles = {
    readContent: async () => {
      throw new Error('UNSCOPED_READ_FORBIDDEN')
    },
    readContentForEndUser: async (fileId: string, endUserId: string | null) => {
      const f = fixtures.get(fileId)
      if (!f) throw new Error('FILE_NOT_FOUND')
      if ((f.endUserId ?? null) !== (endUserId ?? null)) throw new Error('FILE_ACCESS_DENIED')
      return f
    },
  }
  const service = new ResumeExtractionService(fakeFiles as never, ocrDisabled)

  const docxParagraphs = [
    `姓名：张三 ${SENTINEL}`,
    '求职意向：前端工程师',
    '工作经历：2019-2024 ABC 公司 高级前端，负责一体机触控前端与打印链路。',
    '技能：TypeScript / React / NestJS / Vite',
  ]
  fixtures.set('docx-1', {
    buffer: buildDocx(docxParagraphs),
    mimeType: DOCX_MIME,
    filename: 'resume.docx',
    purpose: 'resume_upload',
    endUserId: null,
  })
  fixtures.set('pdf-1', {
    buffer: buildTextPdf([
      `Name Zhang San ${SENTINEL}`,
      'Objective Frontend Engineer',
      'Experience 2019-2024 ABC Senior Frontend kiosk printing pipeline',
      'Skills TypeScript React NestJS Vite',
    ]),
    mimeType: PDF_MIME,
    filename: 'resume.pdf',
    purpose: 'resume_upload',
    endUserId: null,
  })
  fixtures.set('img-1', {
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]),
    mimeType: 'image/jpeg',
    filename: 'resume.jpg',
    purpose: 'resume_scan',
    endUserId: null,
  })
  fixtures.set('doc-1', {
    buffer: Buffer.from('this pretends to be an old binary .doc payload', 'utf8'),
    mimeType: DOC_MIME,
    filename: 'resume.doc',
    purpose: 'resume_upload',
    endUserId: null,
  })
  fixtures.set('empty-1', {
    buffer: Buffer.alloc(0),
    mimeType: DOCX_MIME,
    filename: 'resume.docx',
    purpose: 'resume_upload',
    endUserId: null,
  })
  fixtures.set('short-1', {
    buffer: buildDocx(['你好']),
    mimeType: DOCX_MIME,
    filename: 'tiny.docx',
    purpose: 'resume_upload',
    endUserId: null,
  })
  fixtures.set('notresume-1', {
    buffer: buildDocx(docxParagraphs),
    mimeType: DOCX_MIME,
    filename: 'id-card.docx',
    purpose: 'id_scan',
    endUserId: null,
  })
  fixtures.set('docx-owned-a', {
    buffer: buildDocx(docxParagraphs),
    mimeType: DOCX_MIME,
    filename: 'owned-resume.docx',
    purpose: 'resume_upload',
    endUserId: 'enduser-a',
  })

  // 1) DOCX 提取
  const r1 = await service.extractResumeText({ fileId: 'docx-1' })
  assert(
    r1.ok && r1.textSource === 'docx' && !!r1.text && r1.text.includes(SENTINEL),
    `1. DOCX 样例真实提取出含哨兵正文（charCount=${r1.charCount}）`,
  )

  // 2) 文本型 PDF 提取
  const r2 = await service.extractResumeText({ fileId: 'pdf-1' })
  assert(
    r2.ok && r2.textSource === 'pdf_text' && !!r2.text && r2.text.includes(SENTINEL),
    `2. 文本型 PDF 样例真实提取出含哨兵正文（pageCount=${r2.pageCount}, charCount=${r2.charCount}）`,
  )

  // 3) 图片 + OCR disabled → OCR_NOT_CONFIGURED，无假文本
  const r3 = await service.extractResumeText({ fileId: 'img-1' })
  assert(
    !r3.ok && r3.errorCode === 'OCR_NOT_CONFIGURED' && r3.text === undefined,
    '3. 图片在 OCR_PROVIDER=disabled 时返回 OCR_NOT_CONFIGURED，不返回任何文本',
  )

  // 4) 旧版 .doc → UNSUPPORTED_FILE_TYPE
  const r4 = await service.extractResumeText({ fileId: 'doc-1' })
  assert(
    !r4.ok && r4.errorCode === 'UNSUPPORTED_FILE_TYPE' && r4.text === undefined,
    '4. 旧版 .doc 返回 UNSUPPORTED_FILE_TYPE，不返回文本',
  )

  // 5) 空文件 → FILE_EMPTY
  const r5 = await service.extractResumeText({ fileId: 'empty-1' })
  assert(!r5.ok && r5.errorCode === 'FILE_EMPTY', '5. 空文件返回 FILE_EMPTY')

  // 6) 文本过短 → TEXT_TOO_SHORT
  const r6 = await service.extractResumeText({ fileId: 'short-1' })
  assert(
    !r6.ok && r6.errorCode === 'TEXT_TOO_SHORT' && r6.text === undefined,
    '6. 提取文本过短返回 TEXT_TOO_SHORT，不返回文本',
  )

  // 7) 日志 / 返回不泄漏原文与 buffer
  const noBufferField = !('buffer' in (r1 as Record<string, unknown>))
  const logsNoSentinel = !logged.join('\n').includes(SENTINEL)
  const metaLogged = logged.some((l) => l.includes('extract.ok'))
  assert(
    r1.ok && !!r1.text && r1.text.includes(SENTINEL) && noBufferField && logsNoSentinel && metaLogged,
    '7. 成功结果含正文但返回体无 buffer 字段；我方日志只含元数据、不含简历原文（哨兵未泄漏）',
  )

  // 8)（增强）非简历用途 fileId → FILE_PURPOSE_REJECTED
  const r8 = await service.extractResumeText({ fileId: 'notresume-1' })
  assert(
    !r8.ok && r8.errorCode === 'FILE_PURPOSE_REJECTED' && r8.text === undefined,
    '8. 非简历用途（id_scan）文件返回 FILE_PURPOSE_REJECTED，不借道读取',
  )

  // 9)（增强）fileId 不存在 / 已清理 → FILE_NOT_FOUND
  const r9 = await service.extractResumeText({ fileId: 'does-not-exist' })
  assert(!r9.ok && r9.errorCode === 'FILE_NOT_FOUND', '9. 不存在 / 已清理 fileId 返回 FILE_NOT_FOUND')

  // 10)（增强）提取层必须按会员归属读取，不能绕过 FilesService 归属门禁
  const r10a = await service.extractResumeText({ fileId: 'docx-owned-a', endUserId: 'enduser-a' })
  assert(r10a.ok && r10a.textSource === 'docx', '10a. 本人会员可提取本人上传的简历文件')
  const r10b = await service.extractResumeText({ fileId: 'docx-owned-a', endUserId: 'enduser-b' })
  assert(!r10b.ok && r10b.errorCode === 'FILE_NOT_FOUND', '10b. 其他会员不可借 fileId 提取本人外文件')
  const r10c = await service.extractResumeText({ fileId: 'docx-owned-a', endUserId: null })
  assert(!r10c.ok && r10c.errorCode === 'FILE_NOT_FOUND', '10c. 匿名调用不可借 fileId 提取会员文件')

  // 11)（增强）tencent provider 占位也绝不返回假文本
  process.env['OCR_PROVIDER'] = 'tencent'
  const ocrTencentNoCred = new OcrService(new DisabledOcrProvider(), new TencentOcrProvider(), new BaiduOcrProvider())
  const svcTencent = new ResumeExtractionService(fakeFiles as never, ocrTencentNoCred)
  const r11a = await svcTencent.extractResumeText({ fileId: 'img-1' })
  assert(
    !r11a.ok && r11a.errorCode === 'OCR_NOT_CONFIGURED' && r11a.text === undefined,
    '11a. OCR_PROVIDER=tencent 且无凭证 → OCR_NOT_CONFIGURED，无假文本',
  )
  process.env['TENCENT_OCR_SECRET_ID'] = 'dummy-id-not-real'
  process.env['TENCENT_OCR_SECRET_KEY'] = 'dummy-key-not-real'
  const r11b = await svcTencent.extractResumeText({ fileId: 'img-1' })
  assert(
    !r11b.ok && r11b.errorCode === 'OCR_FAILED' && r11b.text === undefined,
    '11b. OCR_PROVIDER=tencent 占位（有凭证）→ OCR_FAILED，仍不返回假文本',
  )
  delete process.env['TENCENT_OCR_SECRET_ID']
  delete process.env['TENCENT_OCR_SECRET_KEY']

  console.log('\n=== ALL PASS ===\n')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
