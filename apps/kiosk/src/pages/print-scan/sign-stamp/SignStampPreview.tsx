import { useEffect, useRef } from 'react'
import { FileTextIcon } from 'lucide-react'
import type { SignStampPosition, SignStampSize } from '@ai-job-print/shared'
import { PdfCanvasPreview } from '../../../components/PdfCanvasPreview'
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
  onPreviewError,
}: {
  compact?: boolean
  document: PickedFile | null
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
  onPreviewError: () => void
}) {
  const viewRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; y: number; sl: number; st: number } | null>(null)
  const previewUrl = (burned ? result?.printFileUrl : document?.fileAccessUrl) || ''

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
          <span className="ss-pv-badge" aria-hidden="true"><FileTextIcon size={48} /></span>
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

  const showMarker = Boolean(box && stamp && !burned && viewPage === (placePage ?? viewPage))
  const marker = showMarker && box ? (
    <span
      className="ss-stampmark"
      data-testid="sign-stamp-overlay-marker"
      data-position={position}
      data-size={size}
      data-page={viewPage}
      data-burned="false"
      style={previewUrl
        ? {
            left: `${(box.x / PAGE_W) * 100}%`,
            top: `${(box.y / PAGE_H) * 100}%`,
            width: `${(box.w / PAGE_W) * 100}%`,
            height: `${(box.h / PAGE_H) * 100}%`,
            fontSize: 15,
          }
        : {
            left: box.x * scale,
            top: box.y * scale,
            width: box.w * scale,
            height: box.h * scale,
            fontSize: Math.max(15, box.h * 0.26 * scale),
          }}
    >
      签名图
    </span>
  ) : null

  return (
    <section className="ss-pvcol" aria-label="文档完整页预览">
      <div
        className="ss-pv-view"
        ref={viewRef}
        data-testid="sign-stamp-pv-view"
        tabIndex={0}
        aria-label={`${burned ? '生成的新 PDF' : '原 PDF'}完整页预览，可拖动平移`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {previewUrl ? (
          <PdfCanvasPreview
            src={previewUrl}
            title={`${burned ? result?.name ?? '合成 PDF' : document.name} 预览`}
            page={viewPage}
            fit={viewMode === 'width' ? 'width' : 'page'}
            zoom={viewMode === 'zoom' ? ZOOMS[zoom] : 1}
            showPager={false}
            layout="intrinsic"
            sheetTestId="sign-stamp-pv-page"
            onError={onPreviewError}
            overlay={marker}
          />
        ) : (
          <div
            className="ss-pv-page"
            data-testid="sign-stamp-pv-page"
            data-preview-kind="no-file"
            style={{ position: 'relative', left: 20, top: 20, width: pw, height: ph }}
          >
            <p style={{ margin: 24, fontSize: 20, lineHeight: 1.5 }}>没有可打开的文件内容，这里不画示意纸面。</p>
            {marker}
          </div>
        )}
      </div>
      <div className="ss-pv-cap" data-testid="sign-stamp-pv-caption">
        {!previewUrl
          ? '没有可打开的文件内容，不画示意纸面。'
          : burned
            ? '生成的新 PDF · 签名已印在纸上'
            : compact
              ? `原 PDF 第 ${viewPage} 页`
              : '原 PDF · 框是标记，原件不改写'}
      </div>
    </section>
  )
}
