// ============================================================
// 隐私遮挡产物生成（一级 · 文字层 PDF）。
//
// 决策依据：docs/product/pii-redaction-decision-2026-08.md §3.1
//   - 只在页面上叠黑条**不成立**：pdf-lib 的图形叠在文字流之上，底层文字对象仍在，
//     存进「我的文档」的那份 PDF 里证件号仍可复制、可搜索、可解析。
//   - 全文档栅格化没必要：白白牺牲无关页的清晰度与体积。
//   - 采用：**只栅格化有遮挡的那几页**，未受影响的页保持矢量文字。
//
// 实现顺序很关键：先用 pdf-lib 在**原 PDF 用户空间**画黑条，再栅格化。
// 这样黑条坐标与 getTextContent 的 transform 处在同一坐标系，无需自己处理
// /Rotate、MediaBox 原点、viewport 变换 —— 那些交给 pdfjs 渲染时统一处理。
//
// 安全：全过程只在内存进行；中间产物（含黑条但文字层仍在的那份）**绝不落盘、绝不上传**。
// ============================================================
import { PDFDocument, rgb } from 'pdf-lib'
import { openPdfForRender } from '../ai/resume/ocr/pdf-page-renderer'
import type { PiiBox } from './pii-scan.util'

/** 栅格化目标 DPI（决策文档 §3.1「约 300 DPI」）。 */
const TARGET_RASTER_DPI = 300
/** 页面过大时允许降到的最低 DPI —— 再低就不适合出纸了，宁可诚实失败。 */
const MIN_RASTER_DPI = 150
/** PDF 用户空间 1pt = 1/72 inch。 */
const PDF_POINTS_PER_INCH = 72
/**
 * 单页栅格化像素上限。低于 pdf-page-renderer 自己的 24M 硬上限，
 * 留出余量：超过就先降 DPI，降到 MIN_RASTER_DPI 仍超才失败。
 */
const MAX_RASTER_PIXELS_PER_PAGE = 20_000_000

/** 单次遮挡允许栅格化的最大页数（控内存 / 控时延；匿名可达接口必须有界）。 */
export const PII_REDACT_MAX_RASTER_PAGES = (() => {
  const n = Number(process.env['PII_REDACT_MAX_RASTER_PAGES'])
  return Number.isInteger(n) && n > 0 && n <= 20 ? n : 10
})()

/** 派生件字节上限（与 FilesService proxy 上传上限一致，超出宁可失败也不产半成品）。 */
const MAX_OUTPUT_BYTES = 15 * 1024 * 1024

/** 判定「这个像素有墨」的灰度阈值。 */
const INK_LUMA_THRESHOLD = 200
/**
 * 渲染保真兜底：某页文字层有 ≥ 这么多非空白字符，但渲染结果几乎没有墨，
 * 说明 pdfjs 没能画出这一页的字（缺字体资源 / 缺 CMap / 其它静默失败）。
 * 这种情况下继续生成派生件 = 把用户的简历变成一张只有黑条的空白纸，
 * 比不遮挡更糟，所以整单失败、不产出任何文件。
 */
const INK_GUARD_MIN_CHARS = 30
/** 每个字符至少应贡献的深色像素数（300 DPI 下实际约 300–800，这里取极宽松值只抓"整页全白"）。 */
const INK_GUARD_MIN_DARK_PX_PER_CHAR = 8

export type RedactionFailureReason =
  | 'load_failed'
  | 'encrypted'
  | 'too_many_pages'
  | 'render_failed'
  | 'render_unverified'
  | 'output_too_large'

export type RedactionResult =
  | { ok: true; buffer: Buffer; rasterizedPages: number[] }
  | { ok: false; reason: RedactionFailureReason }

/**
 * 生成遮挡后的派生 PDF。
 *
 * @param source     原始 PDF 字节
 * @param boxes      要遮挡的矩形（PDF 用户空间 pt，原点左下角），可跨页
 * @param pageTextLengths 每页文字层非空白字符数（1-based 页码 → 字符数），用于渲染保真兜底
 */
export async function buildRedactedPdf(
  source: Buffer,
  boxes: PiiBox[],
  pageTextLengths: Map<number, number>,
): Promise<RedactionResult> {
  const boxesByPage = new Map<number, PiiBox[]>()
  for (const box of boxes) {
    if (!Number.isInteger(box.pageNumber) || box.pageNumber < 1) continue
    if (!(box.width > 0) || !(box.height > 0)) continue
    const list = boxesByPage.get(box.pageNumber)
    if (list) list.push(box)
    else boxesByPage.set(box.pageNumber, [box])
  }
  const affectedPages = [...boxesByPage.keys()].sort((a, b) => a - b)
  if (affectedPages.length === 0) return { ok: false, reason: 'render_failed' }
  if (affectedPages.length > PII_REDACT_MAX_RASTER_PAGES) return { ok: false, reason: 'too_many_pages' }

  // ── 1. 在原坐标系画黑条（中间产物：黑条已在，但文字层仍在，绝不外泄）──────────
  let intermediateBytes: Buffer
  let totalPages: number
  try {
    // 不传 ignoreEncryption：加密文档明确拒绝（与 print-sign.service.ts 同口径）。
    const doc = await PDFDocument.load(source)
    totalPages = doc.getPageCount()
    if (affectedPages.some((pageNo) => pageNo > totalPages)) return { ok: false, reason: 'render_failed' }
    for (const pageNo of affectedPages) {
      const page = doc.getPage(pageNo - 1)
      for (const box of boxesByPage.get(pageNo) ?? []) {
        page.drawRectangle({ x: box.x, y: box.y, width: box.width, height: box.height, color: rgb(0, 0, 0) })
      }
    }
    intermediateBytes = Buffer.from(await doc.save())
  } catch (error) {
    return { ok: false, reason: isEncryptedPdfError(error) ? 'encrypted' : 'load_failed' }
  }

  // ── 2. 只把受影响的页栅格化（黑条烧进像素，该页文字层随之消失）─────────────────
  const rasterByPage = new Map<number, { png: Buffer; width: number; height: number }>()
  try {
    const rendered = await openPdfForRender(intermediateBytes)
    try {
      for (const pageNo of affectedPages) {
        const raster = await renderPageWithInkGuard(rendered, pageNo, boxesByPage.get(pageNo) ?? [], pageTextLengths.get(pageNo) ?? 0)
        if (!raster.ok) return { ok: false, reason: raster.reason }
        rasterByPage.set(pageNo, raster.value)
      }
    } finally {
      await rendered.destroy().catch(() => undefined)
    }
  } catch {
    return { ok: false, reason: 'render_failed' }
  }

  // ── 3. 重组：受影响页用位图，其余页原样搬运（保持矢量文字）──────────────────────
  let outputBytes: Buffer
  try {
    const intermediate = await PDFDocument.load(intermediateBytes)
    const output = await PDFDocument.create()
    const untouchedPages = Array.from({ length: totalPages }, (_, i) => i + 1).filter((n) => !rasterByPage.has(n))
    const copied = await output.copyPages(intermediate, untouchedPages.map((n) => n - 1))
    const copiedByPage = new Map(untouchedPages.map((pageNo, i) => [pageNo, copied[i]!]))
    for (let pageNo = 1; pageNo <= totalPages; pageNo += 1) {
      const raster = rasterByPage.get(pageNo)
      if (!raster) {
        output.addPage(copiedByPage.get(pageNo)!)
        continue
      }
      const image = await output.embedPng(raster.png)
      // 页面尺寸取渲染时的 viewport 尺寸：viewport 已经把 /Rotate 算进去了，
      // 位图本身就是"转正后"的样子，所以新页不再设置 rotation。
      const page = output.addPage([raster.width, raster.height])
      page.drawImage(image, { x: 0, y: 0, width: raster.width, height: raster.height })
    }
    outputBytes = Buffer.from(await output.save())
  } catch {
    return { ok: false, reason: 'render_failed' }
  }

  if (outputBytes.length > MAX_OUTPUT_BYTES) return { ok: false, reason: 'output_too_large' }
  return { ok: true, buffer: outputBytes, rasterizedPages: affectedPages }
}

type RenderedPdfLike = {
  renderPage(pageNumber: number, scale: number): Promise<Buffer>
}

async function renderPageWithInkGuard(
  rendered: RenderedPdfLike,
  pageNo: number,
  pageBoxes: PiiBox[],
  textCharCount: number,
): Promise<{ ok: true; value: { png: Buffer; width: number; height: number } } | { ok: false; reason: RedactionFailureReason }> {
  const reference = pageBoxes[0]
  const pageWidth = reference?.pageWidth ?? 0
  const pageHeight = reference?.pageHeight ?? 0
  if (!(pageWidth > 0) || !(pageHeight > 0)) return { ok: false, reason: 'render_failed' }

  const scale = pickRasterScale(pageWidth, pageHeight)
  if (scale === null) return { ok: false, reason: 'render_failed' }

  let png: Buffer
  try {
    png = await rendered.renderPage(pageNo, scale)
  } catch {
    return { ok: false, reason: 'render_failed' }
  }

  const guard = await assertRenderCarriedInk(png, pageBoxes, scale, textCharCount)
  if (!guard) return { ok: false, reason: 'render_unverified' }

  return { ok: true, value: { png, width: pageWidth, height: pageHeight } }
}

/** 目标 300 DPI；单页像素超上限则逐步降 DPI，降到 MIN_RASTER_DPI 仍超则放弃。 */
function pickRasterScale(pageWidthPt: number, pageHeightPt: number): number | null {
  for (let dpi = TARGET_RASTER_DPI; dpi >= MIN_RASTER_DPI; dpi -= 25) {
    const scale = dpi / PDF_POINTS_PER_INCH
    const pixels = Math.ceil(pageWidthPt * scale) * Math.ceil(pageHeightPt * scale)
    if (pixels <= MAX_RASTER_PIXELS_PER_PAGE) return scale
  }
  return null
}

/**
 * 渲染保真兜底：确认这一页渲染出来确实有内容，而不是只剩黑条的空白纸。
 *
 * 做法：数深色像素，减去黑条自身应贡献的像素，剩下的必须与文字层字符数量级相称。
 * 阈值取得极宽松（每字符 8 个深色像素，实际是这个的几十倍），只用于抓「整页没画出来」，
 * 不用于判断排版质量。
 *
 * PNG 是本服务自己 canvas.toBuffer() 生成的字节（非攻击者可控），
 * 复用 materials.service.ts detectBlankPages 已论证过的安全前提。
 */
async function assertRenderCarriedInk(
  png: Buffer,
  pageBoxes: PiiBox[],
  scale: number,
  textCharCount: number,
): Promise<boolean> {
  if (textCharCount < INK_GUARD_MIN_CHARS) return true
  try {
    const { loadImage, createCanvas } = await import('@napi-rs/canvas')
    const image = await loadImage(png)
    const canvas = createCanvas(image.width, image.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(image, 0, 0)
    const { data } = ctx.getImageData(0, 0, image.width, image.height)
    let dark = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i]! < INK_LUMA_THRESHOLD && data[i + 1]! < INK_LUMA_THRESHOLD && data[i + 2]! < INK_LUMA_THRESHOLD) {
        dark += 1
      }
    }
    const barPixels = pageBoxes.reduce((sum, box) => sum + box.width * scale * box.height * scale, 0)
    const nonBarDark = dark - barPixels
    return nonBarDark >= textCharCount * INK_GUARD_MIN_DARK_PX_PER_CHAR
  } catch {
    // 解码/度量本身失败：无法确认渲染保真 → 按不可确认处理，不产出文件。
    return false
  }
}

function isEncryptedPdfError(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name ?? ''
  const message = (error as { message?: string } | null)?.message ?? ''
  return /encrypt/i.test(name) || /encrypt/i.test(message)
}
