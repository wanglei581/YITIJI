import { useState } from 'react'
import { KIcon } from '../../../../components/kiosk-icon'
import { formatRemainingSeconds, useRemainingSeconds } from '../../../../hooks/useCountdown'
import {
  convertDocumentToPdf,
  isWordDocument,
  useDocumentConversionCapabilities,
  WORD_CONVERSION_DISCLOSURE,
  WORD_CONVERSION_UNAVAILABLE_COPY,
  type DocumentConversionResult,
} from '../../../../services/api/documentConversion'
import { conversionUserMessage, DOCUMENT_NOT_REPRINTABLE_COPY } from './documentReprint'

const CONVERT_LINK_EXPIRED_COPY = '链接已过期，请在列表里重新打开'

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function DocumentConvertAction({
  fileId,
  fileName,
  mimeType,
  token,
  busy,
  reprintable,
  onConverted,
  onError,
  onBusyChange,
  onPreview,
  onPrint,
}: {
  fileId: string
  fileName: string
  mimeType: string
  token: string | null
  busy: boolean
  reprintable: boolean
  onConverted: () => void
  onError: (message: string) => void
  onBusyChange: (busy: boolean) => void
  onPreview: (fileId: string) => void
  onPrint: (fileId: string) => void
}) {
  const { capabilities, loading: capabilitiesLoading } = useDocumentConversionCapabilities()
  const [converting, setConverting] = useState(false)
  const [result, setResult] = useState<DocumentConversionResult | null>(null)
  const remaining = useRemainingSeconds(result?.expiresAt)

  if (!isWordDocument({ fileName, mimeType })) return null

  const available = capabilities.wordToPdf === true
  const blocked = busy || converting || !available || capabilitiesLoading
  const linkExpired = remaining === 0
  const previewBlocked = busy || converting || linkExpired
  const printBlocked = previewBlocked || !reprintable
  const unavailableReason = available
    ? null
    : `${WORD_CONVERSION_UNAVAILABLE_COPY}${capabilities.reason?.trim() ? `；${capabilities.reason.trim()}` : ''}`

  const convert = async () => {
    if (!available || converting || busy) return
    if (!token) {
      onError('请先登录')
      return
    }
    setConverting(true)
    onBusyChange(true)
    try {
      const next = await convertDocumentToPdf(fileId, token)
      setResult(next)
      onConverted()
    } catch (error: unknown) {
      onError(conversionUserMessage(error))
    } finally {
      setConverting(false)
      onBusyChange(false)
    }
  }

  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-disabled={blocked || undefined}
        aria-describedby={unavailableReason ? `doc-convert-reason-${fileId}` : undefined}
        onClick={() => void convert()}
        title={unavailableReason ?? '将 Word 转为 PDF'}
        className={['me-ripple me-doc-action', blocked ? 'is-disabled' : ''].join(' ')}
      >
        {converting ? '转换中' : '转 PDF'}
      </button>
      {unavailableReason && (
        <p id={`doc-convert-reason-${fileId}`} className="me-row-meta mt-2" role="status">
          {unavailableReason}
        </p>
      )}
      {available && !result && (
        <p className="me-row-meta mt-2">{WORD_CONVERSION_DISCLOSURE}</p>
      )}
      {result && (
        <div className="mt-2" role="status">
          <p className="me-row-title">{result.filename}</p>
          <p className="me-row-meta">
            {result.pageCount > 0 ? `${result.pageCount} 页` : '页数未知'}
            {' · '}
            {formatBytes(result.sizeBytes)}
            {' · '}
            {remaining < 0
              ? '有效期未返回'
              : remaining === 0
                ? '预览链接已过期'
                : `预览剩余 ${formatRemainingSeconds(remaining)}`}
          </p>
          <p className="me-row-meta mt-1">{WORD_CONVERSION_DISCLOSURE}</p>
          {result.warnings.length > 0 && (
            <ul className="me-row-meta mt-1">
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              aria-disabled={previewBlocked || undefined}
              aria-describedby={linkExpired ? `doc-convert-expired-${fileId}` : undefined}
              onClick={() => { if (previewBlocked) return; onPreview(result.fileId) }}
              title={linkExpired ? CONVERT_LINK_EXPIRED_COPY : '预览转换后的 PDF'}
              style={{ minHeight: 56 }}
              className={['me-ripple me-doc-action', previewBlocked ? 'is-disabled' : ''].join(' ')}
            >
              <KIcon name="eye" />
              预览
            </button>
            <button
              type="button"
              aria-disabled={printBlocked || undefined}
              aria-describedby={
                linkExpired
                  ? `doc-convert-expired-${fileId}`
                  : reprintable
                    ? undefined
                    : `doc-convert-print-blocked-${fileId}`
              }
              onClick={() => { if (printBlocked) return; onPrint(result.fileId) }}
              title={
                linkExpired
                  ? CONVERT_LINK_EXPIRED_COPY
                  : reprintable
                    ? '打印这份 PDF'
                    : DOCUMENT_NOT_REPRINTABLE_COPY
              }
              style={{ minHeight: 56 }}
              className={['me-ripple me-doc-action', printBlocked ? 'is-disabled' : ''].join(' ')}
            >
              <KIcon name="printer" />
              打印这份 PDF
            </button>
          </div>
          {linkExpired && (
            <p id={`doc-convert-expired-${fileId}`} className="me-row-meta mt-2" role="status">
              {CONVERT_LINK_EXPIRED_COPY}
            </p>
          )}
          {!reprintable && (
            <p id={`doc-convert-print-blocked-${fileId}`} className="me-row-meta mt-2" role="status">
              {DOCUMENT_NOT_REPRINTABLE_COPY}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
