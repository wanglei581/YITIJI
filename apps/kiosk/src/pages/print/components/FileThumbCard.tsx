import { useEffect, useState, type ReactNode } from 'react'
import { PdfCanvasPreview } from '../../../components/PdfCanvasPreview'
import { QxTouchIcon } from '../../../components/qingxu/touch/QxTouchIcon'
import type { PrintFileState } from '../printMaterialSession'
import { ENCRYPTED_PDF_BLOCK_COPY, previewKindForFile } from './printPreviewKind'
import { PrintFilePreviewModal } from './PrintPreviewPanel'
import '../styles/print-desk-qx.css'

/**
 * 材料检查 / 预览与参数共用的「文档小样」卡（稿 .preview：左边文档缩略、右边文件名与页数）。
 * 缩略图是这一份文件自己的第一页（PDF 用画布、图片用原图），读不出来时退成文件图标，
 * 不拿示例简历顶替。点缩略图打开完整预览（原来的完整预览弹层，逐页看清）。
 * 预览发现打开密码时通知页面拦住下一步。
 */
export function FileThumbCard({
  file,
  token,
  size = 'sm',
  pager = false,
  onEncrypted,
  children,
}: {
  file: PrintFileState
  token: string | null
  /** sm：材料检查（高 170）；lg：预览与参数（高 212） */
  size?: 'sm' | 'lg'
  /** 预览页要翻页：在缩略图下面画「上一页 · 第 N 页 / 共 M 页 · 下一页」。 */
  pager?: boolean
  onEncrypted?: () => void
  children?: ReactNode
}) {
  const kind = previewKindForFile(file)
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState<number | null>(null)
  const [encrypted, setEncrypted] = useState(false)
  useEffect(() => {
    setPage(1)
    setPageCount(null)
    setEncrypted(false)
    setOpen(false)
  }, [file.fileId, file.fileUrl])

  const total = pageCount ?? file.pages
  const meta = encrypted
    ? `${file.size} · 打不开`
    : `${file.pages === null ? '页数待识别' : `共 ${file.pages} 页`} · ${file.size}`
  const sizeClass = size === 'lg' ? 'pdk-doc-lg' : 'pdk-doc-sm'

  return (
    <>
      <div className={`pdk-doc ${sizeClass}`} data-encrypted={encrypted ? 'true' : undefined}>
        <div className="pdk-doc-view">
          <button
            type="button"
            className="pdk-doc-thumb"
            aria-label={`打开完整预览：${file.name}`}
            disabled={encrypted || kind === 'unsupported' || kind === 'unavailable'}
            onClick={() => setOpen(true)}
          >
            {kind === 'pdf' && file.fileUrl ? (
              <PdfCanvasPreview
                className="pdk-doc-canvas"
                title={`${file.name} 预览`}
                src={file.fileUrl}
                fit="page"
                page={page}
                showPager={false}
                failureMessage="预览没生成"
                passwordMessage={ENCRYPTED_PDF_BLOCK_COPY}
                onPageChange={setPage}
                onReady={({ pageCount: count }) => setPageCount(count)}
                onPasswordRequired={() => {
                  setEncrypted(true)
                  onEncrypted?.()
                }}
              />
            ) : null}
            {kind === 'image' && file.fileUrl ? <img src={file.fileUrl} alt="" onLoad={() => setPageCount(1)} /> : null}
            {kind === 'word' || kind === 'unsupported' || kind === 'unavailable' || !file.fileUrl ? (
              <span className="pdk-doc-ph"><QxTouchIcon name="file" size={56} strokeWidth={1.8} /></span>
            ) : null}
          </button>
          {pager ? (
            <div className="pdk-pager">
              <button type="button" aria-label="上一页" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                <QxTouchIcon name="chevL" size={30} strokeWidth={2.4} />
              </button>
              <span>{total ? `第 ${page} 页 / 共 ${total} 页` : `第 ${page} 页`}</span>
              <button type="button" aria-label="下一页" disabled={!total || page >= total} onClick={() => setPage((value) => value + 1)}>
                <QxTouchIcon name="chevR" size={30} strokeWidth={2.4} />
              </button>
            </div>
          ) : null}
        </div>
        <div className="qpd-preview-meta pdk-doc-meta" aria-label="当前文件">
          <strong title={file.name}>{file.name}</strong>
          <span>{meta}</span>
          {children}
        </div>
      </div>
      {open ? <PrintFilePreviewModal file={file} token={token} onClose={() => setOpen(false)} /> : null}
    </>
  )
}
