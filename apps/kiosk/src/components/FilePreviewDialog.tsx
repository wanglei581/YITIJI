import { XIcon } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { FileContentPreview } from './FileContentPreview'
import { formatRemainingSeconds, useRemainingSeconds } from '../hooks/useCountdown'

interface FilePreviewDialogProps {
  fileUrl: string
  fileName: string
  mimeType?: string | null
  format?: string | null
  phoneDownloadUrl?: string | null
  expiresAt?: string | null
  onRegenerate?: () => void
  regenerating?: boolean
  onClose: () => void
}

export function FilePreviewDialog({
  fileUrl,
  fileName,
  mimeType,
  format,
  phoneDownloadUrl,
  expiresAt,
  onRegenerate,
  regenerating = false,
  onClose,
}: FilePreviewDialogProps) {
  const remaining = useRemainingSeconds(expiresAt)
  const hasExpiry = Boolean(expiresAt) && remaining >= 0
  const expired = hasExpiry && remaining === 0
  const canRegenerate = Boolean(onRegenerate) && hasExpiry && remaining <= 30
  const showQr = Boolean(phoneDownloadUrl) && !expired

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-5">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-preview-dialog-title"
        className="flex h-[min(88vh,900px)] w-[min(94vw,980px)] flex-col overflow-hidden rounded-lg bg-white shadow-xl"
      >
        <header className="flex min-h-14 items-center gap-4 border-b border-neutral-200 px-5">
          <h2 id="file-preview-dialog-title" className="min-w-0 flex-1 truncate text-base font-semibold text-neutral-900">
            {fileName}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭文件预览"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-md text-neutral-600 hover:bg-neutral-100"
          >
            <XIcon className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>
        <div className={`min-h-0 flex-1 ${phoneDownloadUrl ? 'grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_210px]' : 'flex'}`}>
          <FileContentPreview
            className="min-h-0 flex-1 rounded-none border-0"
            fileUrl={fileUrl}
            fileName={fileName}
            mimeType={mimeType}
            format={format}
          />
          {phoneDownloadUrl && (
            <aside className="flex items-center justify-center border-t border-neutral-200 bg-neutral-50 p-5 sm:border-l sm:border-t-0">
              <div className="text-center">
                <p className="mb-3 text-sm font-semibold text-neutral-800">手机扫码保存</p>
                {showQr ? (
                  <div className="inline-flex bg-white p-2">
                    <QRCodeSVG value={phoneDownloadUrl} size={160} level="M" marginSize={0} />
                  </div>
                ) : (
                  <p className="rounded-md bg-white px-3 py-4 text-sm leading-6 text-neutral-600" role="status">
                    二维码已过期，请重新生成后再扫码带走
                  </p>
                )}
                {hasExpiry && !expired && (
                  <p className="mt-3 text-xs leading-5 text-neutral-500">
                    剩余 {formatRemainingSeconds(remaining)}，链接短时有效，请仅在本人手机上打开
                  </p>
                )}
                {expired && (
                  <p className="mt-3 text-xs leading-5 text-neutral-500">链接已过期，重新生成后可再扫码</p>
                )}
                {!hasExpiry && showQr && (
                  <p className="mt-3 text-xs leading-5 text-neutral-500">链接短时有效，请仅在本人手机上打开</p>
                )}
                {canRegenerate && (
                  <button
                    type="button"
                    className="mt-3 min-h-14 w-full rounded-md bg-primary-600 px-3 text-sm font-semibold text-white disabled:opacity-60"
                    disabled={regenerating}
                    onClick={onRegenerate}
                  >
                    {regenerating ? '正在重新生成…' : expired ? '重新生成' : '重新生成'}
                  </button>
                )}
              </div>
            </aside>
          )}
        </div>
      </section>
    </div>
  )
}
