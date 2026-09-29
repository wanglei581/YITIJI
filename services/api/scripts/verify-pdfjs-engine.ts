/**
 * 服务端 PDF.js 引擎与打开选项门禁（CVE-2026-16633 / GHSA-hq66-cqwq-w95j，修复版本 6.2.108）。
 *
 * 运行时核对（版本一律从运行中的引擎取，不读 package.json 文本）：
 * 1. 订阅 src/common/pdf/pdfjs-document.ts 发布的 diagnostics_channel，逐个跑服务端真实入口 ——
 *    简历抽取、合同审查抽取、隐私片段扫描、逐页渲染（含 CCITT 黑白扫描件）、页数识别、空白页检测，
 *    以及 unpdf 自己的 extractText(字节) 内部路径 —— 断言每个入口都真的打开过 PDF，且每一次交给
 *    PDF.js getDocument 的参数都带 enableScripting:false、isEvalSupported:false、enableXfa:false，
 *    事件里的引擎版本 ≥ 6.2.108（语义版本比较）。
 * 2. unpdf.getResolvedPDFJS() 返回的引擎版本 ≥ 6.2.108（unpdf 的 extractText 等内部路径用的就是它）。
 * 3. 在 globalThis.pdfjsLib / pdfjsSandbox / pdfjsScripting 上装陷阱：进程内每一份被求值的
 *    PDF.js 构建都会往 pdfjsLib 写一次自己的版本 —— 断言整个进程只求值过一份且 ≥ 6.2.108
 *    （unpdf 自带的 5.6.205 从未被装进来），脚本沙箱（漏洞所在组件）从未被加载。
 *
 * 静态核对：除共用入口 pdfjs-document.ts 之外，src 里没有文件自己调 getDocument /
 * getResolvedPDFJS / unpdf.getDocumentProxy / definePDFJSModule，也没有引入 unpdf 或 pdfjs-dist
 * （先用 TypeScript printer 去掉注释再匹配，注释里提到这些名字不算）。
 *
 * 不连数据库、不发外部请求、零费用。
 */
import { subscribe } from 'node:diagnostics_channel'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import ts from 'typescript'
import {
  PDFJS_GET_DOCUMENT_CHANNEL,
  type PdfjsGetDocumentEvent,
} from '../src/common/pdf/pdfjs-document'
import { ResumeExtractionService } from '../src/ai/resume/resume-extraction.service'
import { ContractReviewExtractionService } from '../src/contract-review/contract-review-extraction.service'
import { extractTextForPiiScan } from '../src/materials/pii-scan.util'
import { openPdfForRender } from '../src/ai/resume/ocr/pdf-page-renderer'
import { resolvePdfPageCount } from '../src/files/file-page-count.util'
import { MaterialsService } from '../src/materials/materials.service'

const API_ROOT = path.join(__dirname, '..')
const SRC_ROOT = path.join(API_ROOT, 'src')
const SHARED_ENTRY = path.join(SRC_ROOT, 'common/pdf/pdfjs-document.ts')
const ZH_CMAP_FIXTURE = path.join(API_ROOT, 'fixtures/zh-cmap.pdf')
/** libtiff tiff2pdf 生成的 CCITT G4（/CCITTFaxDecode）黑白扫描样本；6.x 靠 wasm 解码它。 */
const CCITT_FIXTURE = path.join(API_ROOT, 'fixtures/ccitt-g4-scan.pdf')
const MIN_SAFE_VERSION = '6.2.108'
const ZH = '中文预览测试'

let passes = 0
let failures = 0

function pass(message: string): void {
  passes += 1
  console.log(`  PASS ${message}`)
}

function fail(message: string): void {
  failures += 1
  console.error(`  FAIL ${message}`)
}

function check(condition: boolean, message: string, detail = ''): void {
  if (condition) pass(message)
  else fail(detail ? `${message}（${detail}）` : message)
}

// ── 运行时：版本比较（门禁自带一份，不复用被测代码里的实现）────────────────

function versionAtLeast(version: unknown, minimum: string): boolean {
  const parse = (value: unknown) => {
    const match = typeof value === 'string' ? /^(\d+)\.(\d+)\.(\d+)$/.exec(value) : null
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
  }
  const a = parse(version)
  const b = parse(minimum)
  if (!a || !b) return false
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return (a[i] as number) > (b[i] as number)
  }
  return true
}

// ── 运行时：记录进程内被求值的 PDF.js 构建 ───────────────────────────────────

const evaluatedEngines: unknown[] = []
const evaluatedSandboxes: string[] = []

function trapGlobal(name: string, onSet: (value: unknown) => void): void {
  let current: unknown
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get: () => current,
    set: (value: unknown) => {
      onSet(value)
      current = value
    },
  })
}

// ── 运行时：订阅共用入口发布的 getDocument 参数 ─────────────────────────────

const events: PdfjsGetDocumentEvent[] = []
subscribe(PDFJS_GET_DOCUMENT_CHANNEL, (message) => {
  events.push(message as PdfjsGetDocumentEvent)
})

function isHardened(event: PdfjsGetDocumentEvent): boolean {
  return event.enableScripting === false && event.isEvalSupported === false && event.enableXfa === false
}

function isSafeEngine(event: PdfjsGetDocumentEvent): boolean {
  return versionAtLeast(event.engineVersion, MIN_SAFE_VERSION)
}

/** 跑一个真实入口：它必须至少打开过一次 PDF，且每一次打开都带齐安全选项。 */
async function entry(label: string, run: () => Promise<void>): Promise<void> {
  const before = events.length
  try {
    await run()
  } catch (error) {
    fail(`${label}：入口执行出错 ${(error as Error)?.stack ?? String(error)}`)
    return
  }
  const mine = events.slice(before)
  if (mine.length === 0) {
    fail(`${label}：没有经过共用入口打开 PDF（未观察到 getDocument）`)
    return
  }
  const bad = mine.filter((event) => !isHardened(event))
  check(
    bad.length === 0,
    `${label}：${mine.length} 次 getDocument 都带 enableScripting:false / isEvalSupported:false / enableXfa:false`,
    `不合格 ${JSON.stringify(bad)}`,
  )
  const old = mine.filter((event) => !isSafeEngine(event))
  check(
    old.length === 0,
    `${label}：引擎版本 ${JSON.stringify([...new Set(mine.map((event) => event.engineVersion))])} ≥ ${MIN_SAFE_VERSION}`,
    `低于修复版本 ${JSON.stringify(old.map((event) => event.engineVersion))}`,
  )
}

// ── 夹具 ─────────────────────────────────────────────────────────────────────

/** 文字层足够可靠的英文 PDF（合同审查要求单行 ≥30 个字母数字；简历要求有效字符 ≥30）。 */
async function buildTextLayerPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([595, 842])
  const lines = [
    'Engine check line one ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789',
    'Engine check line two abcdefghijklmnopqrstuvwxyz 9876543210',
    'Engine check line three contract review text layer sample',
  ]
  lines.forEach((line, index) => {
    page.drawText(line, { x: 48, y: 780 - index * 28, size: 14, font })
  })
  return Buffer.from(await doc.save())
}

async function darkPixels(png: Buffer): Promise<number> {
  const image = await loadImage(png)
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  const { data } = ctx.getImageData(0, 0, image.width, image.height)
  let dark = 0
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i] ?? 255) < 128) dark += 1
  }
  return dark
}

function fakeFiles(buffer: Buffer, purpose: string, filename: string) {
  return {
    readContentForEndUser: async () => ({ buffer, mimeType: 'application/pdf', filename, purpose }),
  }
}

const OCR_DISABLED = {
  activeProviderName: 'disabled',
  recognize: async () => ({ ok: false, errorCode: 'OCR_NOT_CONFIGURED', errorMessage: 'disabled in engine gate' }),
}

// ── 静态：除共用入口外没有别的 PDF.js 打开点 ────────────────────────────────

function walkTs(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'generated') continue
    const abs = path.join(dir, name)
    if (statSync(abs).isDirectory()) walkTs(abs, out)
    else if (name.endsWith('.ts')) out.push(abs)
  }
}

const printer = ts.createPrinter({ removeComments: true })

function codeWithoutComments(file: string): string {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
  return printer.printFile(source)
}

const FORBIDDEN_OUTSIDE_SHARED_ENTRY: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\.getDocument\s*\(/, label: '直接调 getDocument(' },
  { pattern: /\bgetResolvedPDFJS\b/, label: '取 unpdf 内部引擎 getResolvedPDFJS' },
  { pattern: /\bunpdf\.getDocumentProxy\b/, label: '直接调 unpdf.getDocumentProxy' },
  { pattern: /\bdefinePDFJSModule\b/, label: '自行 definePDFJSModule' },
  { pattern: /['"`]pdfjs-dist(?:\/[^'"`]*)?['"`]/, label: '引入 pdfjs-dist' },
  { pattern: /['"`]unpdf(?:\/[^'"`]*)?['"`]/, label: '直接引入 unpdf（须经共用入口，否则可能先于换引擎装进自带的 5.6.205）' },
]

function assertSingleOpenSite(): void {
  const files: string[] = []
  walkTs(SRC_ROOT, files)
  const offenders: string[] = []
  for (const file of files) {
    if (path.resolve(file) === path.resolve(SHARED_ENTRY)) continue
    const code = codeWithoutComments(file)
    for (const { pattern, label } of FORBIDDEN_OUTSIDE_SHARED_ENTRY) {
      if (pattern.test(code)) offenders.push(`${path.relative(API_ROOT, file)}：${label}`)
    }
  }
  check(
    offenders.length === 0 && files.length > 100,
    `src 共 ${files.length} 个 .ts 文件，除 common/pdf/pdfjs-document.ts 外没有别的 PDF.js 打开点`,
    offenders.join('；'),
  )
}

// ── 主流程 ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n=== verify:pdfjs-engine — 服务端 PDF.js 引擎与打开选项 ===')
  // 陷阱必须先于任何 PDF.js 构建被求值；本文件顶部的 import 只引入服务代码，引擎是首次打开时才加载。
  check(evaluatedEngines.length === 0 && (globalThis as Record<string, unknown>)['pdfjsLib'] === undefined, '开始时进程内还没有任何 PDF.js 构建被求值')
  trapGlobal('pdfjsLib', (value) => evaluatedEngines.push((value as { version?: unknown } | undefined)?.version))
  trapGlobal('pdfjsSandbox', () => evaluatedSandboxes.push('pdfjsSandbox'))
  trapGlobal('pdfjsScripting', () => evaluatedSandboxes.push('pdfjsScripting'))

  assertSingleOpenSite()

  const zhCmap = readFileSync(ZH_CMAP_FIXTURE)
  const textPdf = await buildTextLayerPdf()

  await entry('简历抽取（文字层 PDF）', async () => {
    const service = new ResumeExtractionService(
      fakeFiles(textPdf, 'resume_upload', 'resume.pdf') as never,
      OCR_DISABLED as never,
    )
    const result = await service.extractResumeText({ fileId: 'engine-gate-resume', endUserId: null })
    if (!result.ok || result.textSource !== 'pdf_text' || !result.text?.includes('Engine check line two')) {
      throw new Error(`简历文字层抽取结果不对：${JSON.stringify({ ok: result.ok, errorCode: result.errorCode, textSource: result.textSource })}`)
    }
  })

  await entry('合同审查抽取（文字层 PDF，默认运行时）', async () => {
    const service = new ContractReviewExtractionService(
      fakeFiles(textPdf, 'contract_upload', 'contract.pdf') as never,
      OCR_DISABLED as never,
    )
    const result = await service.extract({ fileId: 'engine-gate-contract', endUserId: null })
    if (result.mode !== 'text_layer' || result.totalPages !== 1 || !result.pages[0]?.text.includes('Engine check line three')) {
      throw new Error(`合同审查文字层抽取结果不对：${JSON.stringify({ mode: result.mode, totalPages: result.totalPages })}`)
    }
  })

  await entry('隐私片段扫描（预置 CMap 中文 PDF）', async () => {
    const scanned = await extractTextForPiiScan(zhCmap, 'application/pdf', {
      recognize: async () => ({ ok: false, errorCode: 'OCR_FAILED', errorMessage: 'text layer must be enough' }),
    })
    const text = scanned.pages.map((page) => page.text).join('\n')
    if (scanned.outcome !== 'ok' || !text.includes(ZH)) {
      throw new Error(`隐私扫描没有从文字层读到中文：outcome=${scanned.outcome}`)
    }
  })

  await entry('逐页渲染（预置 CMap 中文 PDF）', async () => {
    const rendered = await openPdfForRender(zhCmap)
    try {
      const dark = await darkPixels(await rendered.renderPage(1, 1))
      if (rendered.totalPages !== 1 || dark < 100) {
        throw new Error(`渲染结果不对：totalPages=${rendered.totalPages} dark=${dark}`)
      }
    } finally {
      await rendered.destroy()
    }
  })

  await entry('逐页渲染（CCITT G4 黑白扫描件，wasm 解码）', async () => {
    const rendered = await openPdfForRender(readFileSync(CCITT_FIXTURE))
    try {
      const dark = await darkPixels(await rendered.renderPage(1, 1))
      // 800×240 @200dpi 的样本在 scale=1 下约 288×87，边框与两行字约 1600 个深色像素；解码失败时为 0。
      if (dark < 800) throw new Error(`CCITT 扫描件渲染成了空白：dark=${dark}`)
    } finally {
      await rendered.destroy()
    }
  })

  await entry('页数识别（打印计费 / 材料体检）', async () => {
    const pages = await resolvePdfPageCount(textPdf)
    if (pages !== 1) throw new Error(`页数识别应为 1，实得 ${pages}`)
  })

  await entry('空白页检测（材料体检）', async () => {
    const detectBlankPages = (MaterialsService.prototype as unknown as {
      detectBlankPages(this: unknown, file: Buffer, mimeType: string): Promise<number[]>
    }).detectBlankPages
    const blank = await detectBlankPages.call({}, zhCmap, 'application/pdf')
    if (blank.includes(1)) throw new Error(`有字的第 1 页被判成空白：${JSON.stringify(blank)}`)
  })

  // unpdf 自己的内部路径：extractText(字节) 由 unpdf 内部调 getDocumentProxy → 引擎的 getDocument。
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const unpdf = require('unpdf') as {
    getResolvedPDFJS(): Promise<{ version?: unknown }>
    extractText(data: unknown, options: { mergePages: boolean }): Promise<{ text: string | string[] }>
  }
  await entry('unpdf.extractText(字节) 内部路径', async () => {
    const extracted = await unpdf.extractText(new Uint8Array(textPdf), { mergePages: true })
    const text = Array.isArray(extracted.text) ? extracted.text.join('\n') : extracted.text
    if (!text.includes('Engine check line one')) throw new Error('unpdf.extractText 没读出文字层')
  })

  const resolved = await unpdf.getResolvedPDFJS()
  check(
    versionAtLeast(resolved.version, MIN_SAFE_VERSION),
    `unpdf.getResolvedPDFJS() 运行时版本 ${String(resolved.version)} ≥ ${MIN_SAFE_VERSION}（unpdf 内部路径用的引擎）`,
  )

  const engineVersions = [...new Set(evaluatedEngines)]
  check(
    evaluatedEngines.length === 1 && engineVersions.every((version) => versionAtLeast(version, MIN_SAFE_VERSION)),
    `整个进程只求值过一份 PDF.js 构建且 ≥ ${MIN_SAFE_VERSION}（unpdf 自带的 5.6.205 没被装进来）`,
    `实际求值 ${JSON.stringify(evaluatedEngines)}`,
  )
  check(
    evaluatedEngines[0] === resolved.version,
    '被求值的那一份就是 unpdf 当前使用的引擎',
    `求值 ${JSON.stringify(evaluatedEngines)} / unpdf ${String(resolved.version)}`,
  )
  check(evaluatedSandboxes.length === 0, 'PDF.js 脚本沙箱（pdf.sandbox / scripting）从未被加载', JSON.stringify(evaluatedSandboxes))

  const engines = [...new Set(events.map((event) => event.engineVersion))]
  console.log(`  INFO 本次进程内 getDocument 共 ${events.length} 次，引擎版本 ${JSON.stringify(engines)}`)

  console.log(`\n=== verify:pdfjs-engine — ${passes} PASS / ${failures} FAIL ===`)
  if (failures > 0) process.exit(1)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exit(1)
})
