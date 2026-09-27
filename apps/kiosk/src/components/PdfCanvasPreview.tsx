import { useEffect, useRef, useState, type ReactNode } from 'react'
// 只把 URL 打进包。PDF.js 本体仍是单独文件，预览出现时才 fetch。
// 不用 import()：那会变成 script 请求，页面重载或跳走时 Chromium 报 net::ERR_ABORTED。
import pdfjsModuleUrl from 'unpdf/pdfjs?url'

/**
 * 把 PDF 画到 canvas 上。
 * 字节只走 fetch；卸载时中止的是这次 fetch，并取消 PDF.js 的 loading / render task。
 * 不把 PDF 当成文档打开，避免一体机内置查看器的打印、下载按钮，也避免跳走时的
 * document 级 net::ERR_ABORTED。
 */

export type PdfCanvasFit = 'page' | 'width'
export type PdfCanvasLayout = 'fill' | 'intrinsic'

const LOADING_COPY = '正在准备预览'
const FAILURE_COPY = '预览没能生成，打印仍按原文件。'
const MAX_BITMAP_EDGE = 4096
const MAX_ZOOM = 4

type PdfjsNamespace = {
  getDocument: (src: {
    data: Uint8Array
    isEvalSupported: boolean
    useSystemFonts: boolean
    useWorkerFetch: boolean
    disableAutoFetch: boolean
    disableStream: boolean
    verbosity: number
  }) => PdfLoadingTask
}

type PdfLoadingTask = {
  destroyed: boolean
  promise: Promise<PdfDocument>
  destroy: () => Promise<void>
  onPassword: (updatePassword: (password: string) => void, reason: number) => void
}

type PdfDocument = {
  numPages: number
  getPage: (pageNumber: number) => Promise<PdfPage>
  destroy: () => Promise<void>
}

type PdfPage = {
  getViewport: (params: { scale: number }) => { width: number; height: number }
  render: (params: {
    canvas: HTMLCanvasElement
    viewport: { width: number; height: number }
  }) => { promise: Promise<void>; cancel: () => void }
}

type RenderTask = { promise: Promise<void>; cancel: () => void }

type PreviewSession = {
  dead: boolean
  paintGen: number
  controller: AbortController
  loadingTask: PdfLoadingTask | null
  pdf: PdfDocument | null
  renderTask: RenderTask | null
}

export interface PdfCanvasPreviewProps {
  src: string
  title: string
  className?: string
  /** 1-based。传入后由外部翻页，不传则组件自己记当前页。 */
  page?: number
  onPageChange?: (page: number) => void
  fit?: PdfCanvasFit
  /** 在 fit 的结果上再乘。适宽 / 适整页用 1。 */
  zoom?: number
  showPager?: boolean
  credentials?: RequestCredentials
  failureMessage?: string
  onError?: () => void
  onReady?: (info: { pageCount: number }) => void
  /** fill：撑满父级并在内部滚动。intrinsic：按画布尺寸撑开，交给外层滚动。 */
  layout?: PdfCanvasLayout
  sheetTestId?: string
  overlay?: ReactNode
}

function clampPage(page: number, pageCount: number | null): number {
  const requested = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1
  return pageCount ? Math.min(requested, pageCount) : requested
}

function isBenignPreviewError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true
  if (!error || typeof error !== 'object') return false
  const name = 'name' in error ? String(error.name) : ''
  if (name === 'AbortError' || name === 'RenderingCancelledException') return true
  const message = 'message' in error ? String(error.message) : ''
  return /Rendering cancelled|Loading aborted|Worker was destroyed/i.test(message)
}

let pdfjsModule: Promise<PdfjsNamespace> | null = null

function loadUnpdfPdfjs(): Promise<PdfjsNamespace> {
  if (!pdfjsModule) {
    pdfjsModule = (async () => {
      const response = await fetch(pdfjsModuleUrl)
      if (!response.ok) throw new Error('pdfjs-fetch-failed')
      const blob = new Blob([await response.blob()], { type: 'text/javascript' })
      const blobUrl = URL.createObjectURL(blob)
      try {
        return await import(/* @vite-ignore */ blobUrl) as PdfjsNamespace
      } finally {
        URL.revokeObjectURL(blobUrl)
      }
    })().catch((error: unknown) => {
      pdfjsModule = null
      throw error
    })
  }
  return pdfjsModule
}

function disposeSession(session: PreviewSession): void {
  if (session.dead) return
  session.dead = true
  session.paintGen += 1
  session.controller.abort()
  const task = session.renderTask
  const pdf = session.pdf
  const loading = session.loadingTask
  session.renderTask = null
  session.pdf = null
  session.loadingTask = null
  try {
    task?.cancel()
  } catch {
    // 渲染已经结束时 cancel 可能抛；卸载路径只负责停掉后续绘制。
  }
  void (async () => {
    try {
      await task?.promise
    } catch {
      // 取消后的 rejection 不是预览失败。
    }
    try {
      if (pdf) await pdf.destroy()
      else if (loading && !loading.destroyed) await loading.destroy()
    } catch {
      // 文档可能已经随 loading task 一起销毁。
    }
  })()
}

export function PdfCanvasPreview({
  src,
  title,
  className,
  page: pageProp,
  onPageChange,
  fit = 'width',
  zoom = 1,
  showPager = true,
  credentials = 'same-origin',
  failureMessage = FAILURE_COPY,
  onError,
  onReady,
  layout = 'fill',
  sheetTestId,
  overlay,
}: PdfCanvasPreviewProps) {
  const sessionRef = useRef<PreviewSession | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const onErrorRef = useRef(onError)
  const onReadyRef = useRef(onReady)
  onErrorRef.current = onError
  onReadyRef.current = onReady

  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [pageCount, setPageCount] = useState<number | null>(null)
  const [uncontrolledPage, setUncontrolledPage] = useState(1)
  const [renderSerial, setRenderSerial] = useState(0)
  const [display, setDisplay] = useState<{ width: number; height: number } | null>(null)

  const requestedPage = pageProp ?? uncontrolledPage
  const shownPage = clampPage(requestedPage, pageCount)

  useEffect(() => {
    if (pageProp === undefined) setUncontrolledPage(1)
  }, [pageProp, src])

  useEffect(() => {
    if (pageProp !== undefined || !pageCount) return
    setUncontrolledPage((current) => Math.min(current, pageCount))
  }, [pageCount, pageProp])

  useEffect(() => {
    const session: PreviewSession = {
      dead: false,
      paintGen: 0,
      controller: new AbortController(),
      loadingTask: null,
      pdf: null,
      renderTask: null,
    }
    sessionRef.current = session
    setPhase('loading')
    setPageCount(null)
    setRenderSerial(0)
    setDisplay(null)

    const run = async () => {
      let passwordRejected = false
      try {
        const response = await fetch(src, { signal: session.controller.signal, credentials })
        if (session.dead) return
        if (!response.ok) throw new Error('preview-fetch-failed')
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (session.dead) return
        const { getDocument } = await loadUnpdfPdfjs()
        if (session.dead) return
        const loadingTask = getDocument({
          data: bytes,
          isEvalSupported: false,
          useSystemFonts: true,
          useWorkerFetch: false,
          disableAutoFetch: true,
          disableStream: true,
          verbosity: 0,
        })
        session.loadingTask = loadingTask
        loadingTask.onPassword = () => {
          passwordRejected = true
          void loadingTask.destroy()
        }
        const pdf = await loadingTask.promise
        if (session.dead) {
          await pdf.destroy().catch(() => undefined)
          return
        }
        if (!pdf.numPages) throw new Error('preview-empty')
        session.pdf = pdf
        setPageCount(pdf.numPages)
        setPhase('ready')
        onReadyRef.current?.({ pageCount: pdf.numPages })
      } catch (error) {
        if (session.dead) return
        if (!passwordRejected && isBenignPreviewError(error)) return
        setPhase('error')
        onErrorRef.current?.()
      }
    }

    void run()
    return () => {
      if (sessionRef.current === session) sessionRef.current = null
      disposeSession(session)
    }
  }, [credentials, src])

  useEffect(() => {
    const session = sessionRef.current
    const stage = stageRef.current
    const canvas = canvasRef.current
    if (!session || session.dead || phase !== 'ready' || !session.pdf || !stage || !canvas) return
    const pdf = session.pdf
    const gen = ++session.paintGen
    const measureEl = layout === 'fill'
      ? stage
      : (stage.parentElement?.parentElement ?? stage.parentElement ?? stage)
    let frame = 0
    let painting = false
    let dirty = false
    let measuredWidth = measureEl.clientWidth
    let measuredHeight = measureEl.clientHeight
    const stale = () => session.dead || session.paintGen !== gen

    const paintOnce = async () => {
      if (stale()) return
      const width = measuredWidth
      const height = measuredHeight
      if (width < 8 || height < 8) return
      const target = clampPage(requestedPage, pdf.numPages)
      let pageProxy: PdfPage
      try {
        pageProxy = await pdf.getPage(target)
      } catch (error) {
        if (stale() || isBenignPreviewError(error)) return
        setPhase('error')
        onErrorRef.current?.()
        return
      }
      if (stale()) return
      const base = pageProxy.getViewport({ scale: 1 })
      if (base.width < 1 || base.height < 1) return
      const zoomFactor = Number.isFinite(zoom) && zoom > 0 ? Math.min(zoom, MAX_ZOOM) : 1
      const fitScale = fit === 'width'
        ? width / base.width
        : Math.min(width / base.width, height / base.height)
      const cssScale = Math.max(0.05, fitScale * zoomFactor)
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      let bitmapScale = cssScale * dpr
      const longest = Math.max(base.width, base.height) * bitmapScale
      if (longest > MAX_BITMAP_EDGE) bitmapScale *= MAX_BITMAP_EDGE / longest
      const viewport = pageProxy.getViewport({ scale: bitmapScale })
      const outputScale = bitmapScale / cssScale
      const cssWidth = Math.max(1, Math.round(viewport.width / outputScale))
      const cssHeight = Math.max(1, Math.round(viewport.height / outputScale))

      const previous = session.renderTask
      if (previous) {
        try {
          previous.cancel()
        } catch {
          // 上一笔渲染已结束。
        }
        try {
          await previous.promise
        } catch {
          // 取消。
        }
        if (session.renderTask === previous) session.renderTask = null
      }
      if (stale()) return

      const buffer = document.createElement('canvas')
      buffer.width = Math.max(1, Math.floor(viewport.width))
      buffer.height = Math.max(1, Math.floor(viewport.height))
      const task = pageProxy.render({ canvas: buffer, viewport })
      session.renderTask = task
      try {
        await task.promise
      } catch (error) {
        if (session.renderTask === task) session.renderTask = null
        if (stale() || isBenignPreviewError(error)) return
        setPhase('error')
        onErrorRef.current?.()
        return
      }
      if (stale() || session.renderTask !== task) return
      session.renderTask = null
      canvas.width = buffer.width
      canvas.height = buffer.height
      const context = canvas.getContext('2d')
      if (!context) {
        setPhase('error')
        onErrorRef.current?.()
        return
      }
      context.drawImage(buffer, 0, 0)
      setDisplay((current) => (
        current && current.width === cssWidth && current.height === cssHeight
          ? current
          : { width: cssWidth, height: cssHeight }
      ))
      setRenderSerial((current) => current + 1)
    }

    const pump = async () => {
      if (stale()) return
      if (painting) {
        dirty = true
        return
      }
      painting = true
      try {
        do {
          dirty = false
          await paintOnce()
        } while (dirty && !stale())
      } finally {
        painting = false
      }
    }

    const kick = () => {
      if (stale()) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => { void pump() })
    }
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect) return
      measuredWidth = rect.width
      measuredHeight = rect.height
      kick()
    })
    observer.observe(measureEl)
    kick()

    return () => {
      if (session.paintGen === gen) session.paintGen += 1
      cancelAnimationFrame(frame)
      observer.disconnect()
      try {
        session.renderTask?.cancel()
      } catch {
        // 渲染已结束。
      }
    }
  }, [fit, layout, phase, requestedPage, src, zoom])

  const turn = (next: number) => {
    const clamped = clampPage(next, pageCount)
    if (pageProp !== undefined) onPageChange?.(clamped)
    else setUncontrolledPage(clamped)
  }

  const hostClass = layout === 'intrinsic'
    ? `relative inline-block max-w-none ${className ?? ''}`
    : `relative flex h-full min-h-0 w-full flex-col overflow-hidden ${className ?? ''}`

  return (
    <div
      className={hostClass}
      data-pdf-preview-host=""
      data-pdf-renderer="canvas"
      data-preview-src={src}
      data-pdf-status={phase}
      data-pdf-page={shownPage}
      data-pdf-fit={fit}
      data-pdf-page-count={pageCount ?? undefined}
      data-pdf-render={renderSerial}
      title={title}
    >
      {phase === 'ready' ? (
        <div
          ref={stageRef}
          className={layout === 'fill'
            ? `flex min-h-0 w-full flex-1 justify-center overflow-auto ${fit === 'page' ? 'items-center' : 'items-start'}`
            : ''}
        >
          <div
            data-testid={sheetTestId}
            className="relative inline-block max-w-none"
            style={display ? { width: display.width, height: display.height } : undefined}
          >
            <canvas
              ref={canvasRef}
              className="block"
              aria-label={`${title}，第 ${shownPage} 页`}
              style={display ? { width: display.width, height: display.height } : { width: 0, height: 0 }}
            />
            {display ? overlay : null}
          </div>
        </div>
      ) : (
        <div className="flex min-h-[160px] flex-1 items-center justify-center bg-white px-6 py-8 text-center" role="status">
          <p className={`max-w-md text-lg font-semibold leading-7 ${phase === 'error' ? 'text-neutral-700' : 'text-neutral-500'}`}>
            {phase === 'error' ? failureMessage : LOADING_COPY}
          </p>
        </div>
      )}
      {phase === 'ready' && showPager && pageCount ? (
        <nav aria-label="预览翻页" className="flex shrink-0 items-center justify-center gap-3 border-t border-neutral-200 bg-white px-3 py-2">
          <button
            type="button"
            className="min-h-14 min-w-14 rounded-md px-4 text-base font-semibold text-neutral-800 disabled:opacity-40"
            disabled={shownPage <= 1}
            onClick={() => turn(shownPage - 1)}
          >
            上一页
          </button>
          <span className="min-w-36 text-center text-lg font-semibold tabular-nums text-neutral-800" aria-live="polite">
            第 {shownPage} / 共 {pageCount} 页
          </span>
          <button
            type="button"
            className="min-h-14 min-w-14 rounded-md px-4 text-base font-semibold text-neutral-800 disabled:opacity-40"
            disabled={shownPage >= pageCount}
            onClick={() => turn(shownPage + 1)}
          >
            下一页
          </button>
        </nav>
      ) : null}
    </div>
  )
}
