/**
 * Stage 3 真实 OCR（百度智能云）— 离线回归验证（受控 stub 百度服务，不触网，可进 CI）。
 *
 * 用本地 HTTP stub 模拟百度 token / accurate_basic 端点（BAIDU_OCR_BASE_URL 指向 stub），
 * BaiduOcrProvider 与 ResumeExtractionService 走真实代码路径（含 pdfkit 造扫描件 +
 * unpdf/@napi-rs/canvas 真实渲染），验证：
 *
 *  1. 图片 OCR 成功映射（多行文本拼接 + 高置信度）
 *  2. 低 probability → confidence=low + 提取层附「请人工核对」提示（Stage 3 验收点）
 *  3. 额度/限流错误（17）→ 诚实 OCR_FAILED「繁忙/额度」文案，不假成功
 *  4. 接口超时 → AbortController 真实中断 → 诚实超时文案
 *  5. token 失效（110）→ 作废缓存自动重取并重试一次成功（token 端点被调两次）
 *  6. 超大图片 → 本地直接拒绝，不发任何请求
 *  7. 扫描版 PDF（无文字层）→ 受控渲染 → 逐页 OCR → ok=true, textSource=pdf_ocr
 *  8. 多页扫描件超限 → 只识别前 OCR_PDF_MAX_PAGES 页 + warning 如实告知
 *  9. 扫描件某页 OCR 失败 → 整体诚实失败（不拿部分页冒充完整简历）
 * 10. OCR_PROVIDER=disabled 时扫描件 → 既有 PDF_TEXT_EMPTY 行为不回退
 * 11. 日志脱敏：全程捕获 Logger，断言不含识别文本 / 手机号 / base64 图片 / token 值
 * 12. 凭证未配置 → OCR_NOT_CONFIGURED
 *
 * 运行：pnpm --filter @ai-job-print/api verify:ocr-baidu
 * 真实联网冒烟见 verify:ocr-baidu-live（用真实密钥，不进 CI）。
 */

// env 必须在 dotenv 之前钉死（dotenv 不覆盖已有值）
process.env['OCR_PROVIDER'] = 'baidu'
process.env['BAIDU_OCR_API_KEY'] = 'stub-api-key'
process.env['BAIDU_OCR_SECRET_KEY'] = 'stub-secret-key'
process.env['BAIDU_OCR_TIMEOUT_MS'] = '1200'
process.env['BAIDU_OCR_MAX_CONCURRENCY'] = '2'
process.env['OCR_PDF_MAX_PAGES'] = '3'
require('dotenv').config()

import { createServer, type Server } from 'http'
import { readFileSync } from 'fs'
import { join } from 'path'
import { Logger } from '@nestjs/common'
import PDFDocument from 'pdfkit'

const SECRET_TEXT_LINE_1 = '张某某 求职简历'
const SECRET_TEXT_LINE_2 = '电话 13800001234 邮箱 test@example.com'
const STUB_TOKEN_1 = 'stub-token-aaaa1111'
const STUB_TOKEN_2 = 'stub-token-bbbb2222'

let passCount = 0
function pass(msg: string) {
  passCount += 1
  console.log(`  PASS ${msg}`)
}
function fail(msg: string): never {
  console.error(`  FAIL ${msg}`)
  throw new Error(`VERIFY FAILED: ${msg}`)
}

// ── 日志捕获（脱敏断言用）────────────────────────────────────────────────────
const capturedLogs: string[] = []
class CapturingLogger {
  log(message: unknown, ..._rest: unknown[]) { capturedLogs.push(String(message)) }
  error(message: unknown, ..._rest: unknown[]) { capturedLogs.push(String(message)) }
  warn(message: unknown, ..._rest: unknown[]) { capturedLogs.push(String(message)) }
  debug(message: unknown, ..._rest: unknown[]) { capturedLogs.push(String(message)) }
  verbose(message: unknown, ..._rest: unknown[]) { capturedLogs.push(String(message)) }
}
Logger.overrideLogger(new CapturingLogger())

// ── 百度 stub 服务 ───────────────────────────────────────────────────────────
type OcrStubReply =
  | { kind: 'ok'; lines: Array<{ words: string; probability: number }> }
  | { kind: 'error'; code: number; msg: string }
  | { kind: 'sleep'; ms: number }

const ocrQueue: OcrStubReply[] = []
let tokenCalls = 0
let ocrCalls = 0
let issueToken = STUB_TOKEN_1
let lastOcrTokens: string[] = []

function startStub(): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = req.url ?? ''
      if (url.startsWith('/oauth/2.0/token')) {
        tokenCalls += 1
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ access_token: issueToken, expires_in: 2_592_000, scope: 'brain_ocr' }))
        return
      }
      if (url.startsWith('/rest/2.0/ocr/v1/accurate_basic')) {
        ocrCalls += 1
        lastOcrTokens.push(new URL(url, 'http://x').searchParams.get('access_token') ?? '')
        const reply = ocrQueue.shift() ?? { kind: 'error' as const, code: 282000, msg: 'stub queue empty' }
        const send = (body: unknown) => {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(body))
        }
        if (reply.kind === 'sleep') {
          setTimeout(() => send({ words_result_num: 0, words_result: [] }), reply.ms)
          return
        }
        if (reply.kind === 'error') {
          send({ error_code: reply.code, error_msg: reply.msg })
          return
        }
        send({
          words_result_num: reply.lines.length,
          words_result: reply.lines.map((l) => ({
            words: l.words,
            probability: { average: l.probability, min: l.probability, variance: 0 },
          })),
        })
        return
      }
      res.statusCode = 404
      res.end('not found')
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({ server, url: `http://127.0.0.1:${port}` })
    })
  })
}

// ── 工具：造扫描件 PDF（只画图形，无文字层）─────────────────────────────────
function makeScannedPdf(pages: number): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4' })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    for (let i = 0; i < pages; i += 1) {
      if (i > 0) doc.addPage()
      // 模拟扫描图：灰底 + 黑色块（无任何文字对象 → 无文字层）
      doc.rect(40, 40, 500, 760).fillColor('#f2f2f2').fill()
      doc.rect(60, 80 + i * 10, 460, 24).fillColor('#222222').fill()
    }
    doc.end()
  })
}

const PNG_1PX = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000400000004008000000008f02'.padEnd(40, '0'),
  'hex',
) // 仅作 buffer 占位，stub 不真正解码图片

async function main() {
  const { server, url } = await startStub()
  process.env['BAIDU_OCR_BASE_URL'] = url

  const { BaiduOcrProvider } = await import('../src/ai/resume/ocr/baidu-ocr.provider')
  const { DisabledOcrProvider } = await import('../src/ai/resume/ocr/disabled-ocr.provider')
  const { TencentOcrProvider } = await import('../src/ai/resume/ocr/tencent-ocr.provider.stub')
  const { OcrService } = await import('../src/ai/resume/ocr/ocr.service')
  const { ResumeExtractionService } = await import('../src/ai/resume/resume-extraction.service')

  const newOcrService = () =>
    new OcrService(new DisabledOcrProvider(), new TencentOcrProvider(), new BaiduOcrProvider())

  // 提取层只需要 scoped read → stub FilesService（不触库、不触真实存储）
  const fileStore = new Map<string, { buffer: Buffer; mimeType: string; filename: string }>()
  const stubFiles = {
    readContent: (fileId: string) => {
      const f = fileStore.get(fileId)
      if (!f) throw new Error('not found')
      return Promise.resolve({ ...f, purpose: 'resume_upload' })
    },
    readContentForEndUser: (fileId: string, _endUserId: string | null) => {
      const f = fileStore.get(fileId)
      if (!f) throw new Error('not found')
      return Promise.resolve({ ...f, purpose: 'resume_upload' })
    },
  }

  try {
    // ── 0. Live verify 必须复用运行时兼容渲染器 ─────────────────────────────
    {
      const liveSource = readFileSync(join(__dirname, 'verify-ocr-baidu-live.ts'), 'utf8')
      if (!/\bopenPdfForRender\s*\(/.test(liveSource)) fail('0. live OCR verify 必须调用 openPdfForRender')
      if (/\brenderPageAsImage\s*\(/.test(liveSource)) fail('0. live OCR verify 不得调用不兼容的 renderPageAsImage')
      if (!/\breadContentForEndUser\s*[:(]/.test(liveSource)) fail('0. live OCR verify stub 必须实现受控文件读取')
      pass('0. live OCR verify 复用兼容 PDF 渲染器，禁止回退 renderPageAsImage')
    }

    // ── 0.5 Node 20 缺失 ArrayBuffer API 时仍可渲染 ────────────────────────
    {
      const original = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'transferToFixedLength')
      try {
        Object.defineProperty(ArrayBuffer.prototype, 'transferToFixedLength', {
          configurable: true,
          writable: true,
          value: undefined,
        })
        const { ensureArrayBufferTransferToFixedLength } = await import('../src/ai/resume/ocr/pdf-page-renderer')
        if (typeof ensureArrayBufferTransferToFixedLength !== 'function') fail('0.5 必须导出 Node 20 ArrayBuffer 兼容函数')
        ensureArrayBufferTransferToFixedLength()
        const source = new Uint8Array([7, 9, 11, 13]).buffer as ArrayBuffer & {
          transferToFixedLength?: (length?: number) => ArrayBuffer
        }
        const fixed = source.transferToFixedLength?.(2)
        if (!(fixed instanceof ArrayBuffer)) fail('0.5 兼容函数必须返回 ArrayBuffer')
        if (fixed.byteLength !== 2 || new Uint8Array(fixed)[0] !== 7 || new Uint8Array(fixed)[1] !== 9) {
          fail('0.5 兼容函数必须保留截断后的前缀字节')
        }
        pass('0.5 Node 20 缺失 ArrayBuffer API 时安装安全的固定长度拷贝兼容层')
      } finally {
        if (original) Object.defineProperty(ArrayBuffer.prototype, 'transferToFixedLength', original)
        else delete (ArrayBuffer.prototype as { transferToFixedLength?: unknown }).transferToFixedLength
      }
    }

    // ── 1. 图片 OCR 成功映射 ────────────────────────────────────────────────
    {
      const provider = new BaiduOcrProvider()
      ocrQueue.push({
        kind: 'ok',
        lines: [
          { words: SECRET_TEXT_LINE_1, probability: 0.99 },
          { words: SECRET_TEXT_LINE_2, probability: 0.97 },
        ],
      })
      const r = await provider.recognize({ buffer: PNG_1PX, mimeType: 'image/png' })
      if (!r.ok) fail(`1. 应识别成功: ${r.errorMessage}`)
      if (r.text !== `${SECRET_TEXT_LINE_1}\n${SECRET_TEXT_LINE_2}`) fail('1. 多行文本拼接错误')
      if (r.confidence !== 'high') fail(`1. 置信度应 high，实际 ${r.confidence}`)
      pass('1. 图片 OCR 成功：多行拼接 + 高置信度')
    }

    // ── 2. 低 probability → low + 人工核对提示（走提取层）──────────────────
    {
      const extraction = new ResumeExtractionService(
        stubFiles as never,
        newOcrService(),
      )
      fileStore.set('img-low', { buffer: PNG_1PX, mimeType: 'image/png', filename: 'resume.png' })
      ocrQueue.push({
        kind: 'ok',
        lines: [{ words: '模糊翻拍的简历正文内容需要超过最小有效字数阈值三十个字符以上才能通过提取校验', probability: 0.55 }],
      })
      const r = await extraction.extractResumeText({ fileId: 'img-low' })
      if (!r.ok) fail(`2. 低置信度仍应返回文本: ${r.errorMessage}`)
      if (r.confidence !== 'low') fail(`2. confidence 应 low，实际 ${r.confidence}`)
      if (!(r.warnings ?? []).some((w) => w.includes('核对'))) fail('2. 缺「人工核对」提示')
      pass('2. 低置信度：confidence=low + 「请人工核对」提示')
    }

    // ── 3. 额度错误诚实失败 ─────────────────────────────────────────────────
    {
      const provider = new BaiduOcrProvider()
      ocrQueue.push({ kind: 'error', code: 17, msg: 'Open api daily request limit reached' })
      const r = await provider.recognize({ buffer: PNG_1PX, mimeType: 'image/png' })
      if (r.ok) fail('3. 额度耗尽不应成功')
      if (r.errorCode !== 'OCR_FAILED' || !r.errorMessage?.includes('额度')) fail(`3. 文案不符: ${r.errorMessage}`)
      pass('3. 额度/限流（17）→ 诚实 OCR_FAILED，不假成功')
    }

    // ── 4. 超时真实中断 ─────────────────────────────────────────────────────
    {
      const provider = new BaiduOcrProvider()
      ocrQueue.push({ kind: 'sleep', ms: 3000 }) // > BAIDU_OCR_TIMEOUT_MS=1200
      const t0 = Date.now()
      const r = await provider.recognize({ buffer: PNG_1PX, mimeType: 'image/png' })
      const ms = Date.now() - t0
      if (r.ok) fail('4. 超时不应成功')
      if (!r.errorMessage?.includes('超时')) fail(`4. 应为超时文案: ${r.errorMessage}`)
      if (ms > 2500) fail(`4. 未真实中断（耗时 ${ms}ms）`)
      pass(`4. 接口超时 → AbortController 真实中断（${ms}ms）+ 诚实超时文案`)
    }

    // ── 5. token 失效自动刷新重试一次 ───────────────────────────────────────
    {
      const provider = new BaiduOcrProvider()
      const tokenCallsBefore = tokenCalls
      issueToken = STUB_TOKEN_1
      ocrQueue.push({ kind: 'error', code: 110, msg: 'Access token invalid or no longer valid' })
      issueToken = STUB_TOKEN_2
      ocrQueue.push({ kind: 'ok', lines: [{ words: '重试成功', probability: 0.95 }] })
      lastOcrTokens = []
      const r = await provider.recognize({ buffer: PNG_1PX, mimeType: 'image/png' })
      if (!r.ok || r.text !== '重试成功') fail(`5. token 刷新重试失败: ${r.errorMessage}`)
      if (tokenCalls - tokenCallsBefore !== 2) fail(`5. token 端点应被调 2 次，实际 ${tokenCalls - tokenCallsBefore}`)
      pass('5. token 失效（110）→ 作废缓存自动重取 + 重试一次成功')
    }

    // ── 6. 超大图本地拒绝（不发请求）────────────────────────────────────────
    {
      const provider = new BaiduOcrProvider()
      const before = ocrCalls
      const big = Buffer.alloc(7 * 1024 * 1024) // > 默认 6MB 上限
      const r = await provider.recognize({ buffer: big, mimeType: 'image/png' })
      if (r.ok) fail('6. 超大图不应成功')
      if (!r.errorMessage?.includes('上限')) fail(`6. 文案不符: ${r.errorMessage}`)
      if (ocrCalls !== before) fail('6. 不应发出任何请求')
      pass('6. 超大图片 → 本地拒绝，零外发请求')
    }

    // ── 7. 扫描版 PDF：真实渲染 → 逐页 OCR → pdf_ocr ────────────────────────
    {
      const extraction = new ResumeExtractionService(stubFiles as never, newOcrService())
      const pdf2 = await makeScannedPdf(2)
      fileStore.set('scan-2p', { buffer: pdf2, mimeType: 'application/pdf', filename: 'scan.pdf' })
      ocrQueue.push({ kind: 'ok', lines: [{ words: `第一页 ${SECRET_TEXT_LINE_1}内容内容内容内容内容内容内容`, probability: 0.96 }] })
      ocrQueue.push({ kind: 'ok', lines: [{ words: `第二页 工作经历内容内容内容内容内容内容内容内容`, probability: 0.95 }] })
      const r = await extraction.extractResumeText({ fileId: 'scan-2p' })
      if (!r.ok) fail(`7. 扫描件应识别成功: ${r.errorMessage}`)
      if (r.textSource !== 'pdf_ocr') fail(`7. textSource 应 pdf_ocr，实际 ${r.textSource}`)
      if (!r.text?.includes('第一页') || !r.text?.includes('第二页')) fail('7. 页文本未合并')
      if (r.pageCount !== 2) fail(`7. pageCount 应 2，实际 ${r.pageCount}`)
      pass('7. 扫描版 PDF：真实渲染 2 页 → 逐页 OCR → textSource=pdf_ocr')
    }

    // ── 8. 多页超限：只识别前 N 页 + 如实 warning ───────────────────────────
    {
      const extraction = new ResumeExtractionService(stubFiles as never, newOcrService())
      const pdf5 = await makeScannedPdf(5)
      fileStore.set('scan-5p', { buffer: pdf5, mimeType: 'application/pdf', filename: 'scan5.pdf' })
      const before = ocrCalls
      for (let i = 0; i < 3; i += 1) {
        ocrQueue.push({ kind: 'ok', lines: [{ words: `第${i + 1}页正文内容内容内容内容内容内容内容内容内容`, probability: 0.95 }] })
      }
      const r = await extraction.extractResumeText({ fileId: 'scan-5p' })
      if (!r.ok) fail(`8. 应成功: ${r.errorMessage}`)
      if (ocrCalls - before !== 3) fail(`8. 应只发 3 次 OCR 请求，实际 ${ocrCalls - before}`)
      if (!(r.warnings ?? []).some((w) => w.includes('仅识别前 3 页'))) fail('8. 缺「仅识别前 3 页」warning')
      pass('8. 5 页扫描件：只识别前 3 页（OCR_PDF_MAX_PAGES）+ 如实告知')
    }

    // ── 9. 某页失败 → 整体诚实失败 ──────────────────────────────────────────
    {
      const extraction = new ResumeExtractionService(stubFiles as never, newOcrService())
      ocrQueue.push({ kind: 'ok', lines: [{ words: '第一页内容内容内容内容内容内容内容内容内容内容', probability: 0.95 }] })
      ocrQueue.push({ kind: 'error', code: 282000, msg: 'internal error' })
      const r = await extraction.extractResumeText({ fileId: 'scan-2p' })
      if (r.ok) fail('9. 部分页失败不应整体成功')
      if (r.errorCode !== 'OCR_FAILED') fail(`9. 应 OCR_FAILED，实际 ${r.errorCode}`)
      pass('9. 扫描件某页 OCR 失败 → 整体诚实失败（不拿部分页冒充完整简历）')
    }

    // ── 10. disabled 时扫描件 → 既有 PDF_TEXT_EMPTY 行为 ────────────────────
    {
      process.env['OCR_PROVIDER'] = 'disabled'
      const extraction = new ResumeExtractionService(
        stubFiles as never,
        new OcrService(new DisabledOcrProvider(), new TencentOcrProvider(), new BaiduOcrProvider()),
      )
      process.env['OCR_PROVIDER'] = 'baidu'
      const r = await extraction.extractResumeText({ fileId: 'scan-2p' })
      if (r.ok || r.errorCode !== 'PDF_TEXT_EMPTY') fail(`10. 应 PDF_TEXT_EMPTY，实际 ${r.errorCode}`)
      pass('10. OCR 未启用时扫描件仍诚实 PDF_TEXT_EMPTY（行为不回退）')
    }

    // ── 11. 日志脱敏 ────────────────────────────────────────────────────────
    {
      const joined = capturedLogs.join('\n')
      for (const secret of [SECRET_TEXT_LINE_1, '13800001234', STUB_TOKEN_1, STUB_TOKEN_2, PNG_1PX.toString('base64').slice(0, 24)]) {
        if (joined.includes(secret)) fail(`11. 日志泄露敏感内容: ${secret.slice(0, 12)}…`)
      }
      if (!/ocr\.ok/.test(joined)) fail('11. 应有 ocr.ok 元数据日志')
      pass('11. 日志脱敏：无识别文本 / 手机号 / token / 图片 base64，只有元数据')
    }

    // ── 12. 凭证未配置 → OCR_NOT_CONFIGURED ─────────────────────────────────
    {
      const saved = process.env['BAIDU_OCR_API_KEY']
      delete process.env['BAIDU_OCR_API_KEY']
      const provider = new BaiduOcrProvider()
      const r = await provider.recognize({ buffer: PNG_1PX, mimeType: 'image/png' })
      process.env['BAIDU_OCR_API_KEY'] = saved
      if (r.ok || r.errorCode !== 'OCR_NOT_CONFIGURED') fail(`12. 应 OCR_NOT_CONFIGURED，实际 ${r.errorCode}`)
      pass('12. 凭证未配置 → OCR_NOT_CONFIGURED（不发请求、不假成功）')
    }

    console.log(`\n=== ALL PASS (${passCount} checks) ===`)
  } catch (err) {
    process.exitCode = 1
    console.error(err instanceof Error ? err.message : err)
  } finally {
    server.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
