import { useEffect, useRef, useState, type RefObject } from 'react'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FileTextIcon,
  ImageIcon,
  MoveHorizontalIcon,
  ShrinkIcon,
  XIcon,
} from 'lucide-react'
import { FileContentPreview, type PreviewKind } from '../../components/FileContentPreview'
import './styles/scan-result-viewer-qx.css'

/**
 * 扫描结果的整屏预览（稿 21 · rs-pv-*）。同一 route 内的视图状态：不改地址、不进历史、
 * 不落存储，关掉就回到结果页这一步，文件与四个去向原样都在。
 *
 * 看的仍是回执里那条签名内容链接（与页内小预览同一份 fileUrl），本层不另取文件、
 * 不调用要登录的预览签发接口，也不带 fileId / token（所以不会触发 Word 转换）。
 *
 * 控件只摆「真能做到」的：
 *   · PDF 交给本机浏览器自带的查看器，按 `page=` / `view=Fit|FitH` 打开参数重新打开；
 *   · 图片由本层按容器量出来的宽高 contain / 铺满宽度；
 *   · 翻页只在回执带了页数时放行。回执没有页数（今天的扫描链路就是这样）时，
 *     上一页 / 下一页如实不可用 —— 本页不替文件编页码，免得「第 3 页」其实停在最后一页。
 */
export type ScanPreviewFit = 'page' | 'width'

export interface ScanPreviewFile {
  name: string
  fileUrl: string
  size: string
  pages: number | null
  mimeType?: string
}

function knownPageCount(pages: number | null): number | null {
  return typeof pages === 'number' && Number.isInteger(pages) && pages >= 1 ? pages : null
}

/** 浏览器 PDF 查看器的打开参数。页数未知时不写 page=，交给查看器从头显示。 */
function scanPreviewPdfParams(fit: ScanPreviewFit, page: number, pageCount: number | null): string {
  const view = fit === 'width' ? 'view=FitH' : 'view=Fit'
  return pageCount ? `page=${page}&${view}` : view
}

/**
 * 预览层之下的整片页面 inert：点不到、Tab 不到、读屏也不会串进来。
 * 从本层往上走到 .qx-stage，把沿途每一层的兄弟节点都挂上 inert；只撤自己挂上的那些。
 */
function useInertBackground(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = ref.current
    const stage = root?.closest('.qx-stage')
    if (!root || !stage) return undefined
    const touched: Element[] = []
    let node: Element = root
    while (node !== stage && node.parentElement) {
      const parent: HTMLElement = node.parentElement
      for (const sibling of Array.from(parent.children)) {
        if (sibling === node || sibling.hasAttribute('inert')) continue
        sibling.setAttribute('inert', '')
        touched.push(sibling)
      }
      node = parent
    }
    return () => {
      for (const element of touched) element.removeAttribute('inert')
    }
  }, [ref])
}

export function ScanResultPreviewViewer({
  file,
  formatLabel,
  onClose,
}: {
  file: ScanPreviewFile
  formatLabel: string
  onClose: () => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [kind, setKind] = useState<PreviewKind | null>(null)
  const [fit, setFit] = useState<ScanPreviewFit>('page')
  const [page, setPage] = useState(1)
  const pageCount = knownPageCount(file.pages)
  const isPdf = kind === 'pdf'
  const showBar = kind === 'pdf' || kind === 'image'

  useInertBackground(rootRef)

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      // inert 在本层卸载时一起撤掉；等它撤完再把焦点还给打开预览的那个按钮。
      window.setTimeout(() => opener?.focus(), 0)
    }
  }, [onClose])

  const pageText = kind === 'image'
    ? '整图 · 共 1 页'
    : pageCount
      ? `第 ${page} 页 / 共 ${pageCount} 页`
      : '页数未知 · 在预览里上下滑动翻页'

  return (
    <div className="sw-fv" ref={rootRef} data-testid="rs-pv-scrim">
      <div className="sw-fv-shell" role="dialog" aria-modal="true" aria-label={`文件预览：${file.name}`} data-testid="rs-pv-shell">
        <div className="sw-fv-head" data-testid="rs-pv-head">
          <span className="sw-fv-ic" aria-hidden="true">
            {kind === 'image' ? <ImageIcon size={32} /> : <FileTextIcon size={32} />}
          </span>
          <span className="sw-fv-meta">
            <span className="sw-fv-name" data-testid="rs-pv-name">{file.name}</span>
            <span className="sw-fv-sub" data-testid="rs-pv-meta">
              {formatLabel} · {file.size} · 来自本次扫描 · {pageCount ? `${pageCount} 页` : '页数以文件为准'}
            </span>
          </span>
          <button
            ref={closeRef}
            type="button"
            className="sw-fv-close"
            aria-label="关闭预览，回到这一步"
            data-testid="rs-pv-close"
            onClick={onClose}
          >
            <XIcon size={32} aria-hidden />
          </button>
        </div>

        <div className="sw-fv-stage">
          <div className="sw-fv-view" data-fit={fit} data-testid="rs-pv-view">
            <FileContentPreview
              fileUrl={file.fileUrl}
              fileName={file.name}
              mimeType={file.mimeType}
              format={formatLabel}
              pdfOpenParams={scanPreviewPdfParams(fit, page, pageCount)}
              onKindChange={setKind}
            />
          </div>
        </div>

        {showBar ? (
          <div className="sw-fv-bar" data-testid="rs-pv-bar">
            <div className="sw-fv-row">
              {isPdf ? (
                <button
                  type="button"
                  className="sw-fv-btn"
                  data-testid="rs-pv-prev"
                  disabled={!pageCount || page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <ChevronLeftIcon size={22} aria-hidden />
                  上一页
                </button>
              ) : null}
              <span className="sw-fv-ind" data-testid="rs-pv-page" aria-live="polite">{pageText}</span>
              {isPdf ? (
                <button
                  type="button"
                  className="sw-fv-btn"
                  data-testid="rs-pv-next"
                  disabled={!pageCount || page >= pageCount}
                  onClick={() => setPage((current) => Math.min(pageCount ?? current, current + 1))}
                >
                  下一页
                  <ChevronRightIcon size={22} aria-hidden />
                </button>
              ) : null}
            </div>
            <div className="sw-fv-row">
              <button
                type="button"
                className="sw-fv-btn"
                data-testid="rs-pv-fit-page"
                aria-pressed={fit === 'page'}
                onClick={() => setFit('page')}
              >
                <ShrinkIcon size={22} aria-hidden />
                适应整页
              </button>
              <button
                type="button"
                className="sw-fv-btn"
                data-testid="rs-pv-fit-width"
                aria-pressed={fit === 'width'}
                onClick={() => setFit('width')}
              >
                <MoveHorizontalIcon size={22} aria-hidden />
                适应宽度
              </button>
              <span className="sw-fv-ind" data-testid="rs-pv-zoom">
                {fit === 'page' ? '当前：整页' : '当前：适应宽度'}
              </span>
            </div>
          </div>
        ) : null}

        <div className="sw-fv-foot" data-testid="rs-pv-foot">
          <p className="sw-fv-note" data-testid="rs-pv-note">
            {isPdf ? (
              <>
                翻页和缩放<b>只改这里的显示</b>：PDF 由本机浏览器自带的查看器按所选页码和版式重新打开，
                <b>不改原件，也不影响打印和 AI 识别</b>。
                {pageCount ? null : ' 回执里没有页数，本页不替文件编页码，所以翻页按钮不可用。'}
              </>
            ) : kind === 'image' ? (
              <>
                缩放<b>只改这里的显示</b>，<b>不改原件，也不影响打印和 AI 识别</b>；适应宽度后上下滑动能看到整张图。
              </>
            ) : kind ? (
              <>
                这份文件不能在本页内嵌显示，所以不摆翻页和缩放按钮。<b>预览没成功不改判扫描已完成</b>，
                也不能据此判断文件是否仍可用。
              </>
            ) : null}
          </p>
          <button type="button" className="qx-btn" data-variant="primary" data-testid="rs-pv-back" onClick={onClose}>
            关闭预览，回到这一步
          </button>
        </div>
      </div>
    </div>
  )
}
