import { useEffect, useRef } from 'react'
import { FileTextIcon } from 'lucide-react'
import type { SignStampPosition, SignStampSize } from '@ai-job-print/shared'
import { MARGIN_RATIO, PAGE_H, PAGE_W, SIZE_FACTOR, ZOOMS } from './constants'
import type { ComposeResult, PickedFile, ViewMode } from './signStampModel'

const POSGRID: Record<SignStampPosition, { col: 'left' | 'center' | 'right'; row: 'top' | 'middle' | 'bottom' }> = {
  'top-left': { col: 'left', row: 'top' },
  'top-center': { col: 'center', row: 'top' },
  'top-right': { col: 'right', row: 'top' },
  'middle-left': { col: 'left', row: 'middle' },
  center: { col: 'center', row: 'middle' },
  'middle-right': { col: 'right', row: 'middle' },
  'bottom-left': { col: 'left', row: 'bottom' },
  'bottom-center': { col: 'center', row: 'bottom' },
  'bottom-right': { col: 'right', row: 'bottom' },
}

function stampBox(position: SignStampPosition, size: SignStampSize, aspect: number) {
  const f = SIZE_FACTOR[size]
  let w = PAGE_W * f
  let h = w / aspect
  if (h > PAGE_H * f) {
    h = PAGE_H * f
    w = h * aspect
  }
  const mX = PAGE_W * MARGIN_RATIO
  const mY = PAGE_H * MARGIN_RATIO
  const g = POSGRID[position]
  const vx = g.col === 'left' ? mX : g.col === 'right' ? PAGE_W - mX - w : (PAGE_W - w) / 2
  const vy = g.row === 'bottom' ? mY : g.row === 'top' ? PAGE_H - mY - h : (PAGE_H - h) / 2
  return { x: vx, y: PAGE_H - vy - h, w, h }
}

export function SignStampPreview({
  compact,
  document,
  pages,
  stamp,
  result,
  viewPage,
  viewMode,
  zoom,
  pan,
  position,
  size,
  placePage,
  burned,
  outErr,
  onViewPage,
  onViewMode,
  onZoom,
  onPreviewError,
}: {
  compact?: boolean
  document: PickedFile | null
  pages: number | null
  stamp: PickedFile | null
  result: ComposeResult | null
  viewPage: number
  viewMode: ViewMode
  zoom: number
  pan: 'br' | null
  position: SignStampPosition
  size: SignStampSize
  placePage?: number
  burned: boolean
  outErr: 'render' | 'expired' | null
  onViewPage: (page: number) => void
  onViewMode: (mode: ViewMode) => void
  onZoom: (zoom: number) => void
  onPreviewError: () => void
}) {
  const viewRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; y: number; sl: number; st: number } | null>(null)
  const pageCount = pages ?? 1
  const useIframe = Boolean(result?.printFileUrl) && !outErr && !compact

  useEffect(() => {
    if (pan !== 'br' || !viewRef.current) return
    const el = viewRef.current
    el.scrollLeft = el.scrollWidth
    el.scrollTop = el.scrollHeight
  }, [pan, viewMode, zoom, viewPage])

  if (outErr) {
    return (
      <section className="ss-pvcol" aria-label="文档完整页预览">
        <div className="ss-pv-empty" data-testid="sign-stamp-pv-unavailable">
          <FileTextIcon size={44} />
          <b>{outErr === 'expired' ? '预览链接已过期' : '这份预览暂时打不开'}</b>
          <span>
            {outErr === 'expired'
              ? '访问链接有效期 30 分钟，已经到期。文件本身没有丢，重新取一次即可。'
              : '浏览器没能渲染这份 PDF。不代表文件损坏或丢失，可以重新取一次预览链接。'}
          </span>
        </div>
        <div className="ss-pv-cap">不放上一次的画面，免得你当成这次的结果。</div>
      </section>
    )
  }

  if (!document) {
    return (
      <section className="ss-pvcol" aria-label="文档完整页预览">
        <div className="ss-pv-empty" data-testid="sign-stamp-pv-empty">
          <div className="ss-pv-ghost">
            <FileTextIcon size={44} />
            <b>还没有文档</b>
            <span>选好 PDF 之后，这里显示完整的一页纸。</span>
          </div>
        </div>
        <div className="ss-pv-cap">这里只显示你选的文件，不放示例文件。</div>
      </section>
    )
  }

  const fitPage = 0.42
  const scale = viewMode === 'width' ? 0.68 : viewMode === 'zoom' ? fitPage * ZOOMS[zoom] : fitPage
  const pw = PAGE_W * scale
  const ph = PAGE_H * scale
  const box = stamp ? stampBox(position, size, 900 / 360) : null

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const view = viewRef.current
    if (!view) return
    if (view.scrollWidth <= view.clientWidth && view.scrollHeight <= view.clientHeight) return
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, sl: view.scrollLeft, st: view.scrollTop }
    view.classList.add('is-grabbing')
    view.setPointerCapture(e.pointerId)
    e.preventDefault()
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const view = viewRef.current
    const d = drag.current
    if (!view || !d || e.pointerId !== d.id) return
    view.scrollLeft = d.sl - (e.clientX - d.x)
    view.scrollTop = d.st - (e.clientY - d.y)
    e.preventDefault()
  }
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || e.pointerId !== drag.current.id) return
    drag.current = null
    viewRef.current?.classList.remove('is-grabbing')
  }

  return (
    <section className="ss-pvcol" aria-label="文档完整页预览">
      {!compact && (
        <div className="ss-pvbar" data-testid="sign-stamp-pv-toolbar">
          <div className="ss-pvrow">
            <button type="button" className="ss-pvbtn" data-testid="sign-stamp-pv-prev" aria-label="上一页" disabled={viewPage <= 1} onClick={() => onViewPage(viewPage - 1)}>
              上一页
            </button>
            <span className="ss-pvlabel" data-testid="sign-stamp-pv-pagelabel">
              第 {viewPage} 页 / 共 {pageCount} 页
            </span>
            <button type="button" className="ss-pvbtn" data-testid="sign-stamp-pv-next" aria-label="下一页" disabled={viewPage >= pageCount} onClick={() => onViewPage(viewPage + 1)}>
              下一页
            </button>
            <button type="button" className="ss-pvbtn" data-testid="sign-stamp-pv-jump2" aria-label="跳到第 2 页" onClick={() => onViewPage(Math.min(2, pageCount))}>
              第2页
            </button>
            <button type="button" className="ss-pvbtn" data-testid="sign-stamp-pv-last" aria-label="跳到末页" onClick={() => onViewPage(pageCount)}>
              末页
            </button>
          </div>
          <div className="ss-pvrow">
            <button type="button" className="ss-pvbtn" data-testid="sign-stamp-pv-fit-page" aria-pressed={viewMode === 'page'} aria-label="适整页显示" onClick={() => onViewMode('page')}>
              适整页
            </button>
            <button type="button" className="ss-pvbtn" data-testid="sign-stamp-pv-fit-width" aria-pressed={viewMode === 'width'} aria-label="适宽显示" onClick={() => onViewMode('width')}>
              适宽
            </button>
            <button
              type="button"
              className="ss-pvbtn"
              data-testid="sign-stamp-pv-zoom-out"
              aria-label="缩小"
              disabled={viewMode !== 'zoom' || zoom <= 0}
              onClick={() => {
                const next = Math.max(0, zoom - 1)
                onZoom(next)
                if (next === 0) onViewMode('page')
              }}
            >
              −
            </button>
            <button
              type="button"
              className="ss-pvbtn"
              data-testid="sign-stamp-pv-zoom-in"
              aria-label="放大"
              disabled={viewMode === 'zoom' && zoom >= ZOOMS.length - 1}
              onClick={() => {
                onViewMode('zoom')
                onZoom(Math.min(ZOOMS.length - 1, viewMode === 'zoom' ? zoom + 1 : 2))
              }}
            >
              ＋
            </button>
            <span className="ss-pvlabel" data-testid="sign-stamp-pv-zoomlabel">
              {viewMode === 'width' ? '适宽' : viewMode === 'zoom' ? '放大' : '适整页'} · {Math.round((scale / fitPage) * 100)}%
            </span>
            <button
              type="button"
              className="ss-pvbtn"
              data-testid="sign-stamp-pv-zoom"
              aria-pressed={viewMode === 'zoom'}
              aria-label="切到放大模式"
              onClick={() => {
                onViewMode('zoom')
                if (zoom < 1) onZoom(2)
              }}
            >
              放大
            </button>
          </div>
        </div>
      )}

      {useIframe ? (
        <iframe
          title={`${result?.name ?? '合成 PDF'} 预览`}
          src={result?.printFileUrl}
          className="ss-pv-frame"
          onError={onPreviewError}
        />
      ) : (
        <div
          className="ss-pv-view"
          ref={viewRef}
          data-testid="sign-stamp-pv-view"
          tabIndex={0}
          aria-label={`${burned ? '派生 PDF' : '原 PDF'}完整页预览，可拖动平移`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div style={{ width: Math.max(pw + 40, 560), height: Math.max(ph + 40, 400), position: 'relative' }}>
            <div
              className="ss-pv-page"
              data-testid="sign-stamp-pv-page"
              role="img"
              aria-label={`${burned ? '派生 PDF' : '原 PDF'} 第 ${viewPage} 页完整页面预览`}
              style={{ left: 20, top: 20, width: pw, height: ph }}
            >
              <span className="ss-bar is-title" style={{ left: '8%', top: '8%', width: '50%', height: '2.6%' }} />
              <span className="ss-bar" style={{ left: '8%', top: '14%', width: '80%', height: '1.4%' }} />
              <span className="ss-bar" style={{ left: '8%', top: '18%', width: '72%', height: '1.4%' }} />
              <span className="ss-bar" style={{ left: '8%', top: '22%', width: '78%', height: '1.4%' }} />
              <span className="ss-bar" style={{ left: '8%', top: '28%', width: '64%', height: '1.4%' }} />
              <span className="ss-pmark" style={{ left: 8, top: 8, width: 52, height: 24 }}>
                左上
              </span>
              <span className="ss-pmark" style={{ right: 8, top: 8, width: 52, height: 24 }}>
                右上
              </span>
              <span className="ss-pmark" style={{ left: 8, bottom: 8, width: 52, height: 24 }}>
                左下
              </span>
              <span className="ss-pmark" style={{ right: 8, bottom: 8, width: 52, height: 24 }}>
                右下
              </span>
              {box && stamp && viewPage === (placePage ?? viewPage) ? (
                <span
                  className="ss-stampmark"
                  data-testid="sign-stamp-overlay-marker"
                  data-position={position}
                  data-size={size}
                  data-page={viewPage}
                  data-burned={burned ? 'true' : 'false'}
                  style={{
                    left: box.x * scale,
                    top: box.y * scale,
                    width: box.w * scale,
                    height: box.h * scale,
                    fontSize: Math.max(15, box.h * 0.26 * scale),
                  }}
                >
                  {burned ? '已合成' : '签名图'}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      )}
      <div className="ss-pv-cap" data-testid="sign-stamp-pv-caption">
        {burned ? '派生 PDF · 签章已印在纸上' : compact ? `原 PDF 第 ${viewPage} 页 · 下一步可翻页放大` : '原 PDF · 框是标记，原件不改写'}
      </div>
    </section>
  )
}
