// ============================================================
// 扫描版 PDF 页面渲染器（Stage 3 OCR 前置步骤）。
//
// 为什么不用 unpdf.renderPageAsImage：unpdf 1.6.2 打包的 pdfjs 在 Node 下的
// NodeCanvasFactory 是恒抛错的占位（含图片的 PDF——恰恰是扫描件——必然渲染失败）。
// 这里改为：unpdf.getResolvedPDFJS() 拿到其内部 pdfjs，再通过 getDocument 的
// `CanvasFactory` 注入 @napi-rs/canvas 实现（三平台均有预编译二进制，无原生编译）。
//
// 安全：渲染只在内存进行，输入 buffer 与输出 PNG 均不落盘、不写日志。
// isEvalSupported:false —— 禁止 pdfjs 对 PDF 内嵌函数走 eval 路径（防御不可信文件）。
// ============================================================

import { createCanvas, ImageData, Path2D, DOMMatrix } from '@napi-rs/canvas'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getResolvedPDFJS } = require('unpdf') as {
  getResolvedPDFJS(): Promise<{
    getDocument(params: Record<string, unknown>): { promise: Promise<PdfjsDocument> }
  }>
}

interface PdfjsPage {
  getViewport(opts: { scale: number }): { width: number; height: number }
  render(opts: { canvasContext: unknown; viewport: unknown }): { promise: Promise<void> }
  cleanup(): void
}

interface PdfjsDocument {
  numPages: number
  getPage(n: number): Promise<PdfjsPage>
  destroy(): Promise<void>
}

// pdfjs 图片解码路径需要这些 DOM 全局；@napi-rs/canvas 提供 Node 实现。
for (const [name, impl] of Object.entries({ ImageData, Path2D, DOMMatrix })) {
  const g = globalThis as Record<string, unknown>
  if (!g[name]) g[name] = impl
}

/** pdfjs getDocument 的 CanvasFactory 注入实现（duck-typed BaseCanvasFactory）。 */
class NapiCanvasFactory {
  // pdfjs 以 new CanvasFactory({ownerDocument, enableHWA}) 实例化；参数不需要。
  constructor(_opts: unknown) {}

  create(width: number, height: number) {
    const canvas = createCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)))
    return { canvas, context: canvas.getContext('2d') }
  }

  reset(cc: { canvas: { width: number; height: number } }, width: number, height: number) {
    cc.canvas.width = Math.max(1, Math.ceil(width))
    cc.canvas.height = Math.max(1, Math.ceil(height))
  }

  destroy(cc: { canvas: { width: number; height: number } | null; context: unknown }) {
    if (cc.canvas) {
      cc.canvas.width = 0
      cc.canvas.height = 0
    }
    cc.canvas = null
    cc.context = null
  }

  _createCanvas(width: number, height: number) {
    return createCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)))
  }
}

/**
 * PDF 页面渲染的最大画布尺寸/像素总量上限（防御性）。
 * viewport 宽高由 PDF 自己声明的 MediaBox × scale 决定，对本函数的调用方而言完全不可控——
 * 一份很小的恶意 PDF 可以声明巨大的页面尺寸，触发原生 canvas 分配巨量内存。
 * 超出上限时不渲染，抛出明确错误，交给调用方既有的 try/catch 按失败处理，
 * 而不是让原生层自己决定怎么应对一次异常大的分配请求。
 *
 * 正常简历页面（A4 @ scale 2 约 1190x1684px，见 resume-extraction.service.ts
 * OCR_PDF_RENDER_SCALE 注释）远低于该上限，不影响真实业务场景。
 */
const MAX_RENDER_DIMENSION_PX = 6000
const MAX_RENDER_TOTAL_PIXELS = 24_000_000

export interface RenderedPdf {
  totalPages: number
  /** 渲染指定页（1-based）为 PNG buffer。 */
  renderPage(pageNumber: number, scale: number): Promise<Buffer>
  /** 释放 pdfjs 文档资源。 */
  destroy(): Promise<void>
}

/** 打开 PDF 供逐页渲染（调用方负责 destroy）。 */
export async function openPdfForRender(buffer: Buffer): Promise<RenderedPdf> {
  const pdfjs = await getResolvedPDFJS()
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    CanvasFactory: NapiCanvasFactory,
    isEvalSupported: false,
  }).promise
  return {
    totalPages: doc.numPages,
    async renderPage(pageNumber: number, scale: number): Promise<Buffer> {
      const page = await doc.getPage(pageNumber)
      try {
        const viewport = page.getViewport({ scale })
        const width = Math.ceil(viewport.width)
        const height = Math.ceil(viewport.height)
        if (
          width <= 0 || height <= 0 ||
          width > MAX_RENDER_DIMENSION_PX || height > MAX_RENDER_DIMENSION_PX ||
          width * height > MAX_RENDER_TOTAL_PIXELS
        ) {
          throw new Error(`PDF page render dimensions out of bounds: ${width}x${height}`)
        }
        const canvas = createCanvas(width, height)
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
        return canvas.toBuffer('image/png')
      } finally {
        page.cleanup()
      }
    },
    destroy: () => doc.destroy(),
  }
}
