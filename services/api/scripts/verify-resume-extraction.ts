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

/**
 * 应届生简历，排法仿 Word 导出的文字层：每段用绝对坐标 Tm 定位，不靠换行符。
 * 姓名拆成两个文字项且先写右边再写左边；联系方式同样先写邮箱再写手机。
 * 中文走 UniGB-UCS2-H（与 fixtures/zh-cmap.pdf 同一套，不嵌字库、不落文件）。
 */
function ucs2Hex(text: string): string {
  return [...text].map((ch) => (ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')).join('')
}

function pdfLiteral(text: string): string {
  return `(${text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')})`
}

function buildWordLikeResumePdf(pageStreams: string[]): Buffer {
  const header = '%PDF-1.4\n'
  const firstPageObj = 7
  const kids: string[] = []
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [4 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 5 0 R /DW 1000 >>',
    '<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [-25 -254 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 93 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  pageStreams.forEach((content, index) => {
    const pageObj = firstPageObj + index * 2
    const contentObj = pageObj + 1
    kids.push(`${pageObj} 0 R`)
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 6 0 R >> >> /Contents ${contentObj} 0 R >>`,
    )
    objects.push(`<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`)
  })
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageStreams.length} >>`
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

function zhTj(text: string): string {
  return `<${ucs2Hex(text)}> Tj\n`
}

/** 两页应届生简历。项目名与时间段分属不同 y；姓名、联系方式的书写顺序与从左到右相反。 */
function graduateResumePdf(): Buffer {
  const page1 = `BT
/F1 16 Tf
1 0 0 1 108 760 Tm
${zhTj('予安')}1 0 0 1 72 760 Tm
${zhTj('陈')}/F2 11 Tf
1 0 0 1 340 730 Tm
${pdfLiteral('chen.yuan@example.com')} Tj
1 0 0 1 72 730 Tm
${pdfLiteral('13812345678')} Tj
/F1 14 Tf
1 0 0 1 72 690 Tm
${zhTj('教育经历')}/F1 12 Tf
1 0 0 1 72 666 Tm
${zhTj('青序工学院')}/F2 11 Tf
1 0 0 1 220 666 Tm
${pdfLiteral('2020.09 - 2024.06')} Tj
/F1 14 Tf
1 0 0 1 72 628 Tm
${zhTj('项目经历')}/F1 12 Tf
1 0 0 1 72 604 Tm
${zhTj('校园二手交易平台')}/F2 11 Tf
1 0 0 1 72 582 Tm
${pdfLiteral('2023.09 - 2024.06')} Tj
/F1 11 Tf
1 0 0 1 84 560 Tm
${zhTj('负责商品发布与订单状态')}/F1 12 Tf
1 0 0 1 72 528 Tm
${zhTj('社团招新报名小程序')}/F2 11 Tf
1 0 0 1 72 506 Tm
${pdfLiteral('2022.03 - 2022.06')} Tj
/F1 14 Tf
1 0 0 1 72 468 Tm
${zhTj('技能')}/F2 11 Tf
1 0 0 1 72 446 Tm
${pdfLiteral('TypeScript / React / Java')} Tj
ET`
  const page2 = `BT
/F1 14 Tf
1 0 0 1 72 760 Tm
${zhTj('实习经历')}/F2 11 Tf
1 0 0 1 72 736 Tm
${pdfLiteral('2023.07 - 2023.08')} Tj
/F1 12 Tf
1 0 0 1 72 714 Tm
${zhTj('青序信息科技')}/F1 11 Tf
1 0 0 1 84 692 Tm
${zhTj('参与内部打印终端页面联调')}ET`
  return buildWordLikeResumePdf([page1, page2])
}

// ── 真实、pdfjs 会诚实报告 numPages=count 的最小 PDF（用于 MAX_BORN_DIGITAL_EXTRACT_PAGES
//    回归测试，与 verify-materials-processing.ts 的 buildDeclaredBigPageCountPdf 同一实现）：
//    /Pages 字典的 /Kids 数组重复引用同一个真实 Page 对象 count 次，/Count 与 Kids.length
//    一致。pdfjs 的 checkLastPage 校验只在 /Count 与实际遍历到的 Kids 数不一致时才把
//    numPages 纠正为实际遍历数（已用 node -e 探针验证：仅声明 /Count 而 /Kids 只有 1 个真实
//    条目时，pdfjs 会打印 "invalid /Pages tree /Count" 警告并把 numPages 纠正回 1）——这里
//    让两者一致，因此拿到的 numPages 是 pdfjs 真实解析结果，不是伪造值，PDF 体积仍只有几百字节。

function buildDeclaredBigPageCountPdf(count: number): Buffer {
  const header = '%PDF-1.4\n'
  const kidsRefs = Array.from({ length: count }, () => '3 0 R').join(' ')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kidsRefs}] /Count ${count} >>`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ]
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
  fixtures.set('big-page-1', {
    buffer: buildDeclaredBigPageCountPdf(60),
    mimeType: PDF_MIME,
    filename: 'declared-60-pages.pdf',
    purpose: 'resume_upload',
    endUserId: null,
  })
  // 「只有姓名和电话」的极简历：有真实文字层，但字数低于 MIN_TEXT_CHARS。
  // 这类文件绝不能被说成「扫描件 / 无文字层」（见 case 13）。
  fixtures.set('short-pdf-1', {
    buffer: buildTextPdf(['林小雨', '13800137902']),
    mimeType: PDF_MIME,
    filename: 'minimal.pdf',
    purpose: 'resume_upload',
    endUserId: null,
  })
  fixtures.set('word-pdf-1', {
    buffer: graduateResumePdf(),
    mimeType: PDF_MIME,
    filename: 'chen-yuan-resume.pdf',
    purpose: 'resume_upload',
    endUserId: null,
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

  // 12)（回归测试）extractPdf() 的 MAX_BORN_DIGITAL_EXTRACT_PAGES 防护此前无任何测试覆盖
  //     （mutation testing 证实：还原该防护后无任何既有测试失败）。unpdf.extractText() 内部
  //     对 pdf.numPages 做 Array.from + Promise.all、不设上限；本接口匿名可达，一份体积很小
  //     但声明超大页数的恶意 PDF 可借此让服务端做无界 CPU/内存工作。声明页数(60) 超过 50 阈值
  //     时必须跳过 born-digital 文字层抽取，直接落入 OCR_PROVIDER=disabled 时既有的诚实失败
  //     路径（PDF_TEXT_EMPTY），不做无界工作、不挂起、不崩溃。
  //
  //     观测手段：monkey-patch require('unpdf') 导出对象上的 extractText 与 extractTextItems。services/api 是
  //     commonjs + node10 resolution，本脚本与 resume-extraction.service.ts 的
  //     require('unpdf') 解析到同一个被 Node 缓存的模块对象，patch 对两侧同时可见——这只是
  //     在观察一个已存在的真实模块边界调用是否发生，不是伪造整个 unpdf 的行为（getDocumentProxy
  //     仍是真实实现，big-page-1 fixture 也是 pdfjs 会诚实解析出 numPages=60 的合法 PDF，
  //     见 buildDeclaredBigPageCountPdf 上方注释）。
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const unpdfSpyModule = require('unpdf') as {
    extractText: (...args: unknown[]) => Promise<unknown>
    extractTextItems: (...args: unknown[]) => Promise<unknown>
  }
  const originalUnpdfExtractText = unpdfSpyModule.extractText
  const originalUnpdfExtractTextItems = unpdfSpyModule.extractTextItems
  let unpdfExtractTextCalls = 0
  let unpdfExtractTextItemsCalls = 0
  unpdfSpyModule.extractText = async (...args: unknown[]) => {
    unpdfExtractTextCalls += 1
    return originalUnpdfExtractText(...args)
  }
  unpdfSpyModule.extractTextItems = async (...args: unknown[]) => {
    unpdfExtractTextItemsCalls += 1
    return originalUnpdfExtractTextItems(...args)
  }
  try {
    process.env['OCR_PROVIDER'] = 'disabled'
    const ocrDisabledForBigPage = new OcrService(new DisabledOcrProvider(), new TencentOcrProvider(), new BaiduOcrProvider())
    const svcBigPage = new ResumeExtractionService(fakeFiles as never, ocrDisabledForBigPage)
    const r12 = await svcBigPage.extractResumeText({ fileId: 'big-page-1' })
    assert(
      unpdfExtractTextCalls === 0 && unpdfExtractTextItemsCalls === 0,
      '12a. PDF 声明页数(60) 超过 MAX_BORN_DIGITAL_EXTRACT_PAGES(50) 时，born-digital 文字层抽取（unpdf.extractText / extractTextItems）从未被调用',
    )
    assert(
      !r12.ok && r12.errorCode === 'PDF_TEXT_EMPTY' && r12.text === undefined,
      `12b. 跳过 extractText 后落入既有 OCR-disabled 诚实失败路径（PDF_TEXT_EMPTY），流程干净完成、未挂起未崩溃，got ${JSON.stringify(r12)}`,
    )
  } finally {
    unpdfSpyModule.extractText = originalUnpdfExtractText
    unpdfSpyModule.extractTextItems = originalUnpdfExtractTextItems
  }

  // 13) 有文字层但字数不足的 PDF：不得报「扫描件 / 无文字层」
  //
  // 回归背景：此前 extractPdf 把「抽不到字」和「抽到字但太少」合并成同一句
  // PDF_TEXT_EMPTY「检测到扫描件 / 图片型 PDF（无文字层）」。对只写了姓名和电话的
  // 极简历来说这句话是事实错误，且建议用户「上传带文字层的 PDF」——正是他已经做过的事。
  process.env['OCR_PROVIDER'] = 'disabled'
  const ocrDisabledForShortPdf = new OcrService(new DisabledOcrProvider(), new TencentOcrProvider(), new BaiduOcrProvider())
  const svcShortPdf = new ResumeExtractionService(fakeFiles as never, ocrDisabledForShortPdf)
  const r13 = await svcShortPdf.extractResumeText({ fileId: 'short-pdf-1' })
  assert(
    !r13.ok && r13.errorCode === 'TEXT_TOO_SHORT',
    `13a. 有文字层但过短的 PDF 返回 TEXT_TOO_SHORT（而非 PDF_TEXT_EMPTY），got ${JSON.stringify(r13)}`,
  )
  assert(
    !r13.ok && !(r13.errorMessage ?? '').includes('无文字层') && !(r13.errorMessage ?? '').includes('扫描件'),
    `13b. 该失败文案不得声称文件是扫描件 / 无文字层，got ${JSON.stringify(r13.ok ? null : r13.errorMessage)}`,
  )
  assert(!r13.ok && r13.text === undefined, '13c. 失败结果仍不返回任何文本（不伪造成功）')

  // 13d) OCR 可用时行为不变：短文字层 PDF 仍交给 OCR，不因上面的修复损失识别能力。
  process.env['OCR_PROVIDER'] = 'tencent'
  process.env['TENCENT_OCR_SECRET_ID'] = 'fake-id'
  process.env['TENCENT_OCR_SECRET_KEY'] = 'fake-key'
  const ocrOnForShortPdf = new OcrService(new DisabledOcrProvider(), new TencentOcrProvider(), new BaiduOcrProvider())
  const svcShortPdfOcr = new ResumeExtractionService(fakeFiles as never, ocrOnForShortPdf)
  const r13d = await svcShortPdfOcr.extractResumeText({ fileId: 'short-pdf-1' })
  assert(
    !r13d.ok && r13d.errorCode === 'OCR_FAILED' && r13d.text === undefined,
    `13d. OCR 可用时短文字层 PDF 仍走 OCR 路径（占位 provider 诚实失败为 OCR_FAILED），got ${JSON.stringify(r13d)}`,
  )
  process.env['OCR_PROVIDER'] = 'disabled'
  delete process.env['TENCENT_OCR_SECRET_ID']
  delete process.env['TENCENT_OCR_SECRET_KEY']

  // 14) Word 式文字层简历必须按行保留。mergePages 会把全文压成一行，本断言随之变红。
  const r14 = await service.extractResumeText({ fileId: 'word-pdf-1' })
  const wordText = r14.ok ? (r14.text ?? '') : ''
  const wordLines = wordText.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
  const contactLine = wordLines.find((line) => line.includes('13812345678') && line.includes('chen.yuan@example.com'))
  const dateLines = wordLines.filter((line) => /\d{4}\.\d{2} - \d{4}\.\d{2}/.test(line))
  const projectLines = wordLines.filter((line) => line === '校园二手交易平台' || line === '社团招新报名小程序')
  const sectionLines = ['教育经历', '项目经历', '技能', '实习经历'].filter((title) => wordLines.includes(title))
  assert(
    r14.ok && r14.textSource === 'pdf_text' && r14.pageCount === 2 && !wordText.includes('予安陈') && wordLines.some((line) => line.includes('陈予安')),
    `14a. 文字层简历按行读出姓名（书写顺序是先「予安」后「陈」），textSource=pdf_text，两页。got ${JSON.stringify(r14.ok ? { textSource: r14.textSource, pageCount: r14.pageCount, head: wordText.slice(0, 80) } : r14)}`,
  )
  assert(
    sectionLines.length === 4 && projectLines.length === 2 && dateLines.length >= 4,
    `14b. 四段标题、两条项目各自成行，四个时间段都在可读的行里。sections=${sectionLines.join(',')} projects=${projectLines.length} dates=${dateLines.length} lines=${wordLines.length}`,
  )
  assert(
    wordLines.includes('校园二手交易平台') && wordLines.includes('2023.09 - 2024.06') && !wordLines.some((line) => line.includes('校园二手交易平台') && line.includes('2023.09 - 2024.06')),
    `14c. 「2023.09 - 2024.06」与「校园二手交易平台」不在同一行。lines=${JSON.stringify(wordLines)}`,
  )
  assert(
    wordLines.length > 1 && !wordLines.some((line) => line.includes('教育经历') && line.includes('项目经历')) && contactLine !== undefined && contactLine.indexOf('13812345678') < contactLine.indexOf('chen.yuan@example.com'),
    `14d. 全文不是一行；手机号在邮箱左边（书写时邮箱在前）。contact=${JSON.stringify(contactLine)} lineCount=${wordLines.length}`,
  )
  const meaningful = wordText.replace(/\s+/g, '')
  assert(
    r14.ok && r14.charCount === wordText.length && (r14.charCount ?? 0) > meaningful.length && wordText.length <= 20000 && meaningful.includes('13812345678') && meaningful.includes('chen.yuan@example.com') && !/\n{3,}/.test(wordText) && !/ {2,}/.test(wordText),
    `14e. 字数仍按整份文本计（含换行），联系方式还在，连续空行与多余空格已收掉。charCount=${r14.charCount} meaningful=${meaningful.length}`,
  )

  console.log('\n=== ALL PASS ===\n')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
