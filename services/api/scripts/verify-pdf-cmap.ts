/**
 * 预置 CMap 回归：没嵌字体、靠 Adobe CMap 编码的中文 PDF。
 *
 * 样本第一行是 Type0 /STSong-Light /UniGB-UCS2-H（28pt），第二行是 Helvetica 英文。
 * 断言抽文本、渲染深色像素、空白页检测。渲染出字只说明预览/体检能读，不是打印机已验证。
 *
 * 不连数据库。由 verify:materials-processing 在体检门禁之后调用。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { openUnpdfDocument, pdfjsPresetDataOptions } from '../src/common/pdf/pdfjs-document'
import { openPdfForRender } from '../src/ai/resume/ocr/pdf-page-renderer'
import { MaterialsService } from '../src/materials/materials.service'
import { extractTextForPiiScan } from '../src/materials/pii-scan.util'

const unpdf = require('unpdf') as {
  extractText(pdf: unknown, options: { mergePages: boolean }): Promise<{ text: string | string[] }>
}

const FIXTURE = path.join(__dirname, '../fixtures/zh-cmap.pdf')
const ZH = '中文预览测试'
let passes = 0

function pass(message: string): void {
  passes += 1
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  throw new Error(message)
}

function walkTs(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'generated') continue
    const abs = path.join(dir, name)
    if (statSync(abs).isDirectory()) walkTs(abs, out)
    else if (name.endsWith('.ts')) out.push(abs)
  }
}

function assertOpenSitesUseFactory(): void {
  const root = path.join(__dirname, '../src')
  const files: string[] = []
  walkTs(root, files)
  const factory = path.join(root, 'common/pdf/pdfjs-document.ts')
  for (const file of files) {
    if (path.resolve(file) === path.resolve(factory)) continue
    const source = readFileSync(file, 'utf8')
    const rel = path.relative(path.join(__dirname, '..'), file)
    if (source.includes('unpdf.getDocumentProxy(')) {
      fail(`${rel} 仍直接调用 unpdf.getDocumentProxy，没有走 openUnpdfDocument`)
    }
    if (source.includes("from 'pdfjs-dist'") || source.includes('require("pdfjs-dist")') || source.includes("require('pdfjs-dist')")) {
      fail(`${rel} 引入了 pdfjs-dist 的 PDF.js 构建`)
    }
    if (/getDocument\s*\(\s*\{/.test(source) && !source.includes('pdfjsPresetDataOptions()')) {
      fail(`${rel} 的 getDocument 没有传入 pdfjsPresetDataOptions()`)
    }
  }
  pass('服务端 PDF.js 打开点都经过预置 CMap 工厂，且没有加载 pdfjs-dist 构建')
}

async function darkBands(png: Buffer): Promise<{ zh: number; ascii: number }> {
  const image = await loadImage(png)
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  const band = (start: number, end: number) => {
    const y0 = Math.floor(image.height * start)
    const y1 = Math.floor(image.height * end)
    const { data } = ctx.getImageData(0, y0, image.width, y1 - y0)
    let dark = 0
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i] ?? 255) < 160) dark += 1
    }
    return dark
  }
  return { zh: band(0.085, 0.135), ascii: band(0.15, 0.19) }
}

async function main(): Promise<void> {
  console.log('\n=== preset CMap Chinese PDF ===')
  const options = pdfjsPresetDataOptions()
  if (!options.cMapUrl.endsWith('/cmaps/') || options.cMapPacked !== true || !options.standardFontDataUrl.endsWith('/standard_fonts/')) {
    fail(`预置数据目录格式不对: ${JSON.stringify(options)}`)
  }
  pass(`CMap 目录 ${options.cMapUrl}`)

  assertOpenSitesUseFactory()

  const buffer = readFileSync(FIXTURE)
  const warnings: string[] = []
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((item) => String(item)).join(' '))
    originalWarn.apply(console, args)
  }
  try {
    const proxy = await openUnpdfDocument<{ destroy?: () => Promise<void> }>(new Uint8Array(buffer))
    try {
      const extracted = await unpdf.extractText(proxy, { mergePages: true })
      const text = Array.isArray(extracted.text) ? extracted.text.join('\n') : (extracted.text ?? '')
      if (!text.includes(ZH)) fail(`extractText 没有「${ZH}」，得到 ${JSON.stringify(text).slice(0, 180)}`)
      pass(`extractText 含「${ZH}」`)
    } finally {
      await proxy.destroy?.()
    }

    let ocrCalls = 0
    const scanned = await extractTextForPiiScan(buffer, 'application/pdf', {
      recognize: async () => {
        ocrCalls += 1
        return { ok: false, errorCode: 'OCR_FAILED', errorMessage: 'cmap regression must not OCR a blank render' }
      },
    })
    const scannedText = scanned.pages.map((page) => page.text).join('\n')
    if (scanned.outcome !== 'ok' || !scannedText.includes(ZH) || ocrCalls !== 0) {
      fail(`隐私扫描没有从文字层读到中文（outcome=${scanned.outcome} ocrCalls=${ocrCalls} text=${JSON.stringify(scannedText).slice(0, 180)}）`)
    }
    pass('隐私片段扫描从文字层读到中文，没有改走 OCR')

    const rendered = await openPdfForRender(buffer)
    try {
      const png = await rendered.renderPage(1, 1)
      const bands = await darkBands(png)
      if (bands.zh < 100 || bands.ascii < 40) {
        fail(`渲染深色像素不足 zh=${bands.zh} ascii=${bands.ascii}`)
      }
      pass(`渲染后中文行 ${bands.zh} 个深色像素，英文行 ${bands.ascii} 个`)
    } finally {
      await rendered.destroy()
    }

    const detectBlankPages = (MaterialsService.prototype as unknown as {
      detectBlankPages(this: unknown, file: Buffer, mimeType: string): Promise<number[]>
    }).detectBlankPages
    const blankPages = await detectBlankPages.call({}, buffer, 'application/pdf')
    if (blankPages.includes(1)) fail(`空白页检测仍把第 1 页报成空白: ${JSON.stringify(blankPages)}`)
    pass('空白页检测不再把第 1 页报成空白')
  } finally {
    console.warn = originalWarn
  }

  const cmapWarnings = warnings.filter((line) => /cMapUrl|standardFontDataUrl|Unable to load CMap/i.test(line))
  if (cmapWarnings.length > 0) fail(`打开样本时仍有 CMap/标准字体警告: ${cmapWarnings.join(' | ')}`)
  pass('打开样本时没有 CMap 或标准字体缺失警告')
  console.log(`\n${passes} PASS`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exit(1)
})
