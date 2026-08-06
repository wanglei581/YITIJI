import { XIcon } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { FileContentPreview } from './FileContentPreview'

interface FilePreviewDialogProps {
  fileUrl: string
  fileName: string
  mimeType?: string | null
  format?: string | null
  phoneDownloadUrl?: string | null
  onClose: () => void
}

export function FilePreviewDialog({
  fileUrl,
  fileName,
  mimeType,
  format,
  phoneDownloadUrl,
  onClose,
}: FilePreviewDialogProps) {
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
                <div className="inline-flex bg-white p-2">
                  <QRCodeSVG value={phoneDownloadUrl} size={160} level="M" marginSize={0} />
                </div>
                <p className="mt-3 text-xs leading-5 text-neutral-500">链接短时有效，请仅在本人手机上打开</p>
              </div>
            </aside>
          )}
        </div>
      </section>
    </div>
  )
}
