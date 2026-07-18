import { useState, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Button } from '@ai-job-print/ui'
import { AlertTriangleIcon, FileTextIcon, InfoIcon } from 'lucide-react'
import {
  patchPrintMaterialSession,
  printUploadPathForSource,
  readPrintMaterialSession,
  type MaterialCheckSummary,
  type PrintMaterialSource,
  type PrintFileState,
} from './printMaterialSession'
import { PrintPrototypeHeader } from './PrintPrototypeLayout'
import './print-prototype.css'

type PrintFile = PrintFileState

interface LocationState {
  file: PrintFile
  materialCheck?: MaterialCheckSummary
  source?: PrintMaterialSource
}

function inferMimeType(file: PrintFile): string {
  if (file.mimeType) return file.mimeType
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  return 'application/octet-stream'
}

function getPreviewKind(file: PrintFile): 'pdf' | 'image' | 'unavailable' {
  if (!file.fileUrl || file.fileUrl.startsWith('/mock/')) return 'unavailable'
  const mime = inferMimeType(file)
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('image/')) return 'image'
  return 'unavailable'
}

function formatFileType(file: PrintFile): string {
  const lower = file.name.toLowerCase()
  if (lower.endsWith('.pdf')) return 'A4 · PDF'
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return '图片'
  if (lower.endsWith('.doc') || lower.endsWith('.docx')) return 'Word 文档'
  return '文档'
}

/** 每页缩略图的模拟行集合（不同页展示不同段落结构）*/
const THUMB_LINE_SETS: ReadonlyArray<ReadonlyArray<string>> = [
  ['t', 'w8', 'w9', 'w7', 'w9', 'w5'],
  ['t', 'w9', 'w7', 'w9', 'w8', 'w7'],
  ['t', 'w7', 'w9', 'w5', 'w8', 'w9'],
  ['t', 'w8', 'w5', 'w9', 'w7', 'w8'],
  ['t', 'w9', 'w8', 'w7', 'w9', 'w5'],
]

function PageThumbnail({
  index,
  active,
  onClick,
}: {
  index: number
  active: boolean
  onClick: () => void
}) {
  const lines = THUMB_LINE_SETS[index % THUMB_LINE_SETS.length]!
  return (
    <button
      type="button"
      className={`pp-thumb${active ? ' on' : ''}`}
      onClick={onClick}
      aria-label={`第 ${index + 1} 页`}
      aria-pressed={active}
    >
      {lines.map((cls, i) => (
        <div key={i} className={`pp-ln ${cls}`} aria-hidden="true" />
      ))}
      <span className="pp-thumb-pg">第 {index + 1} 页</span>
    </button>
  )
}

function MockSheetLines() {
  return (
    <>
      <div className="pp-ln t" aria-hidden="true" />
      <div className="pp-ln w7" aria-hidden="true" />
      <div className="pp-ln h" aria-hidden="true" />
      <div className="pp-ln w9" aria-hidden="true" />
      <div className="pp-ln w8" aria-hidden="true" />
      <div className="pp-ln w9" aria-hidden="true" />
      <div className="pp-ln w5" aria-hidden="true" />
      <div className="pp-ln h" aria-hidden="true" />
      <div className="pp-ln w9" aria-hidden="true" />
      <div className="pp-ln w8" aria-hidden="true" />
      <div className="pp-ln w7" aria-hidden="true" />
      <div className="pp-ln w5" aria-hidden="true" />
    </>
  )
}

export function PrintPreviewPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const locationState = location.state as LocationState | null
  const restoredSession = useMemo(() => readPrintMaterialSession(), [])

  const EMPTY_FILE: PrintFile = { name: '', size: '', pages: null }
  const file = locationState?.file ?? restoredSession?.file ?? EMPTY_FILE
  const materialCheck = locationState?.materialCheck ?? restoredSession?.materialCheck
  const source = locationState?.source ?? restoredSession?.source
  const uploadPath = printUploadPathForSource(source)

  const totalPages = file.pages ?? 3
  const [currentPage, setCurrentPage] = useState(1)
  const [pageRange, setPageRange] = useState<'all' | 'custom'>('all')
  const [customRange, setCustomRange] = useState('')
  const [rangeError, setRangeError] = useState(false)

  const kind = getPreviewKind(file)
  const hasRealPreview = kind === 'pdf' || kind === 'image'

  const handleNext = () => {
    if (pageRange === 'custom' && !customRange.trim()) {
      setRangeError(true)
      return
    }
    const resolvedPageRange = pageRange === 'custom' ? customRange.trim() : 'all'
    patchPrintMaterialSession({
      file,
      materialCheck,
      source,
      printParams: {
        ...(restoredSession?.printParams ?? {
          copies: 1,
          colorMode: 'black_white',
          duplex: 'simplex',
          paperSize: 'A4',
          orientation: 'auto',
          quality: 'standard',
          scale: 'fit',
          pagesPerSheet: 1,
        }),
        pageRange: resolvedPageRange === 'all' ? undefined : resolvedPageRange,
      },
    })
    navigate('/print/params', {
      state: { file, materialCheck, source, pageRange: resolvedPageRange },
    })
  }

  // Guard: direct URL without file state — hooks already ran above
  if (!locationState?.file && !restoredSession?.file) {
    return (
      <div className="print-proto flex min-h-full flex-col">
        <PrintPrototypeHeader
          title="打印预览"
          subtitle="核对页面内容与页数，选择需要打印的页范围"
          step={3}
          backLabel="返回材料检查"
          onBack={() => navigate(-1)}
        />
        <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-warning-bg">
            <AlertTriangleIcon className="h-10 w-10 text-warning" />
          </div>
          <div className="text-center">
            <p className="text-lg font-semibold text-neutral-900">未找到文件信息</p>
            <p className="mt-2 text-sm text-neutral-500">请重新上传文件后再进行预览</p>
          </div>
          <Button size="lg" onClick={() => navigate(uploadPath)}>
            重新上传文件
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="print-proto flex min-h-full flex-col p-6">
      <PrintPrototypeHeader
        title="打印预览"
        subtitle="核对页面内容与页数，选择需要打印的页范围"
        step={3}
        backLabel="返回材料检查"
        onBack={() => navigate(-1)}
      />

      <div className="pp-split mt-4">

        {/* ── 左侧：单页放大预览 ───────────────────────────────── */}
        <section className="pp-zoom-card" aria-label="单页放大预览">
          <div className="pp-zoom-card-head">
            <div className="pp-zoom-card-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.5-4.5M8 11h6M11 8v6" />
              </svg>
            </div>
            <div>
              <h2>单页放大</h2>
              <div className="pp-sub">当前显示第 {currentPage} 页 · A4 幅面示意</div>
            </div>
          </div>

          <div className="pp-zoom-wrap">
            {hasRealPreview && (
              <span className="pp-zoom-tag" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <circle cx="12" cy="12" r="3.2" />
                  <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
                </svg>
                预览
              </span>
            )}

            <div className={`pp-sheet${hasRealPreview ? ' has-iframe' : ''}`}>
              {kind === 'pdf' && (
                <iframe
                  title={`${file.name} 第 ${currentPage} 页预览`}
                  src={`${file.fileUrl}#page=${currentPage}`}
                  className="h-full w-full"
                />
              )}
              {kind === 'image' && (
                <img src={file.fileUrl} alt={`${file.name} 预览`} />
              )}
              {kind === 'unavailable' && (
                <>
                  <MockSheetLines />
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      pointerEvents: 'none',
                    }}
                  >
                    <FileTextIcon
                      style={{ width: 40, height: 40, color: 'var(--print-line)', opacity: 0.6 }}
                      aria-hidden="true"
                    />
                    <span
                      style={{
                        fontSize: 13,
                        color: 'var(--print-muted)',
                        opacity: 0.7,
                        maxWidth: '80%',
                        textAlign: 'center',
                        wordBreak: 'break-all',
                      }}
                    >
                      {file.name || '暂不支持页内预览'}
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* 翻页控件 */}
            <div className="pp-pager">
              <button
                type="button"
                className="pp-pg-btn"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                aria-label="上一页"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                  <path d="M15 5l-7 7 7 7" />
                </svg>
              </button>
              <span className="pp-pg-num" aria-live="polite">
                {currentPage} / {totalPages}
              </span>
              <button
                type="button"
                className="pp-pg-btn"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                aria-label="下一页"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                  <path d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        </section>

        {/* ── 右侧边栏 ─────────────────────────────────────────── */}
        <div className="pp-side-col">

          {/* 页面缩略图 */}
          <section className="pp-thumbs-card" aria-label="页面缩略图">
            <b className="pp-thumbs-hd">
              页面缩略图（{file.pages === null ? '页数待识别' : `共 ${file.pages} 页`}）
            </b>
            <div className="pp-thumb-grid">
              {Array.from({ length: Math.min(totalPages, 9) }).map((_, i) => (
                <PageThumbnail
                  key={i}
                  index={i}
                  active={currentPage === i + 1}
                  onClick={() => setCurrentPage(i + 1)}
                />
              ))}
            </div>
          </section>

          {/* 页面范围 */}
          <section className="pp-range-card" aria-label="页面范围选择">
            <b className="pp-range-hd">页面范围</b>
            <span className="pp-range-sub">默认打印全部页面，也可只打部分页</span>
            <div className="pp-opt-group" role="group" aria-label="打印范围">
              <button
                type="button"
                className={`pp-opt${pageRange === 'all' ? ' on' : ''}`}
                onClick={() => { setPageRange('all'); setRangeError(false) }}
              >
                全部页面
              </button>
              <button
                type="button"
                className={`pp-opt${pageRange === 'custom' ? ' on' : ''}`}
                onClick={() => { setPageRange('custom'); setRangeError(false) }}
              >
                自定义
              </button>
            </div>
            <input
              type="text"
              inputMode="text"
              className={`pp-range-input${rangeError ? ' err' : ''}`}
              placeholder={pageRange === 'custom' ? '例：1-2, 3' : '选「自定义」后可输入'}
              disabled={pageRange !== 'custom'}
              value={customRange}
              onChange={(e) => {
                setCustomRange(e.target.value)
                setRangeError(false)
              }}
            />
            {rangeError && (
              <span className="pp-range-err" role="alert">
                请输入页面范围，例：1-3, 5, 7-9
              </span>
            )}
          </section>

          {/* 继续前核对清单 */}
          <section className="pp-chk-card" aria-label="打印前核对清单">
            <b className="pp-chk-hd">继续前请核对</b>
            <div className="pp-chk">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M4.5 12.5l5 5 10-11" />
              </svg>
              <p><b>页数完整</b>：缩略图共 {totalPages} 页，与原文件一致</p>
            </div>
            <div className="pp-chk">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M4.5 12.5l5 5 10-11" />
              </svg>
              <p><b>内容清晰</b>：放大查看文字无缺失、无乱码</p>
            </div>
            <div className="pp-chk">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M4.5 12.5l5 5 10-11" />
              </svg>
              <p><b>隐私选择</b>：已在材料检查中确认保留 / 遮挡</p>
            </div>
          </section>

          {/* 文件信息 */}
          <section className="pp-meta-card" aria-label="文件信息">
            <div className="pp-meta-row">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M7 3h8l4 4v14H7z" />
                <path d="M15 3v4h4" />
              </svg>
              <b>{file.name || '未知文件名'}</b>
            </div>
            <div className="pp-meta-chips">
              <span className="pp-chip"><b>{file.pages ?? '?'}</b> 页</span>
              {file.size ? <span className="pp-chip"><b>{file.size}</b></span> : null}
              <span className="pp-chip">{formatFileType(file)}</span>
              {materialCheck && (
                <span className="pp-chip warn">
                  已完成隐私检查 · 遮挡 {materialCheck.redactedCount} 项
                  {materialCheck.redaction?.resultFileCreated === false &&
                    materialCheck.redactedCount > 0
                    ? ' · 打印仍使用原文件'
                    : ''}
                </span>
              )}
            </div>
          </section>

          {/* 提示说明 */}
          <div className="pp-notice" role="note">
            <InfoIcon aria-hidden="true" />
            <span>
              PDF 和图片可页内预览；Word 文档暂不支持页内预览，请核对文件名和页数后继续。若预览空白，可能是文件链接过期，请返回重新上传。
            </span>
          </div>

        </div>
      </div>

      {/* 底部操作栏 */}
      <div className="pp-actionbar">
        <button type="button" className="pp-btn-ghost" onClick={() => navigate(-1)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          返回材料检查
        </button>
        <button type="button" className="pp-btn-primary" onClick={handleNext}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M9 5l7 7-7 7" />
          </svg>
          下一步 · 设置参数
        </button>
      </div>
    </div>
  )
}
