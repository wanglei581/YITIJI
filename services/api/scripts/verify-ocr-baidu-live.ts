/**
 * Stage 3 真实 OCR — 联网冒烟（真实百度智能云接口，用 .env 真实密钥；不进 CI）。
 *
 * 链路：pdfkit 生成含中文简历样文的 PDF（无 PII 风险的合成内容）→ unpdf +
 * @napi-rs/canvas 渲染为 PNG → BaiduOcrProvider 真实调用 accurate_basic →
 * 断言识别出关键字段 + 置信度。再走一遍 ResumeExtractionService 扫描件路径
 * （把同一文档当扫描件强制 OCR 验证 pdf_ocr 全链路）。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:ocr-baidu-live
 * 前置：.env 配置 BAIDU_OCR_API_KEY / BAIDU_OCR_SECRET_KEY；消耗真实调用额度（约 3 次）。
 */
process.env['OCR_PROVIDER'] = 'baidu'
require('dotenv').config()

import PDFDocument from 'pdfkit'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { openPdfForRender } from '../src/ai/resume/ocr/pdf-page-renderer'

function fontSpec(): { path: string; family: string } | null {
  const candidates: Array<{ path: string; family: string }> =
    process.platform === 'darwin'
      ? [{ path: '/System/Library/Fonts/Hiragino Sans GB.ttc', family: 'HiraginoSansGB-W3' }]
      : process.platform === 'win32'
        ? [{ path: 'C:\\Windows\\Fonts\\msyh.ttc', family: 'Microsoft YaHei' }]
        : [{ path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', family: 'NotoSansCJKsc-Regular' }]
  return candidates.find((c) => fs.existsSync(c.path)) ?? null
}

function makeTextPdf(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4' })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    const fp = fontSpec()
    if (!fp) {
      reject(new Error('未找到 CJK 字体，无法生成中文样张'))
      return
    }
    doc.registerFont('cjk', fp.path, fp.family)
    doc.font('cjk').fontSize(22).text('测试简历 行政专员', 80, 80)
    doc.fontSize(14).text('教育经历：某某学院 行政管理 本科 2019-2023', 80, 140)
    doc.text('工作经历：某商贸公司 行政文员 负责档案管理与会议安排', 80, 170)
    doc.text('技能：Office 办公软件 档案管理 公文写作', 80, 200)
    doc.end()
  })
}

async function main() {
  if (!process.env['BAIDU_OCR_API_KEY'] || !process.env['BAIDU_OCR_SECRET_KEY']) {
    console.error('SKIP: .env 未配置 BAIDU_OCR_API_KEY / BAIDU_OCR_SECRET_KEY')
    process.exit(1)
  }
  const { BaiduOcrProvider } = await import('../src/ai/resume/ocr/baidu-ocr.provider')
  const { DisabledOcrProvider } = await import('../src/ai/resume/ocr/disabled-ocr.provider')
  const { TencentOcrProvider } = await import('../src/ai/resume/ocr/tencent-ocr.provider.stub')
  const { OcrService } = await import('../src/ai/resume/ocr/ocr.service')
  const { ResumeExtractionService } = await import('../src/ai/resume/resume-extraction.service')

  const pdf = await makeTextPdf()
  const renderer = await openPdfForRender(pdf)
  let png: Buffer
  try {
    png = await renderer.renderPage(1, 2)
  } finally {
    await renderer.destroy()
  }

  // 1) provider 直连真实接口
  const provider = new BaiduOcrProvider()
  const t0 = Date.now()
  const r = await provider.recognize({ buffer: png, mimeType: 'image/png' })
  if (!r.ok) throw new Error(`真实 OCR 失败: ${r.errorCode} ${r.errorMessage}`)
  const mustContain = ['测试简历', '行政', '档案管理']
  for (const kw of mustContain) {
    if (!r.text?.includes(kw)) throw new Error(`识别文本缺关键字「${kw}」；实际开头: ${r.text?.slice(0, 60)}`)
  }
  console.log(`  PASS 1. 真实 accurate_basic 识别成功（${Date.now() - t0}ms，置信度 ${r.confidence}，${r.text?.length} 字符）`)

  // 2) 扫描件全链路（同一 PDF 去掉文字层 → 真实渲染 + 真实 OCR）
  const scanned: Buffer = await new Promise((resolve) => {
    // 用渲染出的 PNG 反包成"图片型 PDF"（典型扫描件形态）
    const doc = new PDFDocument({ size: 'A4' })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    const tmp = path.join(os.tmpdir(), `ocr-live-${Date.now()}.png`)
    fs.writeFileSync(tmp, png)
    doc.image(tmp, 0, 0, { fit: [595, 842] })
    doc.end()
    fs.unlinkSync(tmp)
  })
  const stubFiles = {
    readContent: () =>
      Promise.resolve({ buffer: scanned, mimeType: 'application/pdf', filename: 'scan.pdf', purpose: 'resume_upload' }),
    readContentForEndUser: () =>
      Promise.resolve({ buffer: scanned, mimeType: 'application/pdf', filename: 'scan.pdf', purpose: 'resume_upload' }),
  }
  const extraction = new ResumeExtractionService(
    stubFiles as never,
    new OcrService(new DisabledOcrProvider(), new TencentOcrProvider(), new BaiduOcrProvider()),
  )
  const e = await extraction.extractResumeText({ fileId: 'live-scan' })
  if (!e.ok) throw new Error(`扫描件链路失败: ${e.errorCode} ${e.errorMessage}`)
  if (e.textSource !== 'pdf_ocr') throw new Error(`textSource 应 pdf_ocr，实际 ${e.textSource}`)
  if (!e.text?.includes('行政')) throw new Error('扫描件识别文本缺关键字')
  console.log(`  PASS 2. 扫描件全链路（图片型 PDF → 渲染 → 真实 OCR → pdf_ocr，置信度 ${e.confidence}）`)

  console.log('\n=== LIVE SMOKE PASS（消耗真实额度 ~3 次调用）===')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
