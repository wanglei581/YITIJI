import { useState } from 'react'
import { ExternalLinkIcon, FileWarningIcon } from 'lucide-react'

type PreviewKind = 'pdf' | 'image' | 'unsupported' | 'unavailable'

interface FileContentPreviewProps {
  fileUrl?: string | null
  fileName: string
  mimeType?: string | null
  format?: string | null
  className?: string
  compact?: boolean
}

function resolvePreviewKind(
  fileUrl: string | null | undefined,
  fileName: string,
  mimeType?: string | null,
  format?: string | null,
): PreviewKind {
  if (!fileUrl || fileUrl.startsWith('/mock/')) return 'unavailable'
  const normalized = `${mimeType ?? ''} ${format ?? ''} ${fileName}`.toLowerCase()
  if (normalized.includes('pdf') || normalized.endsWith('.pdf')) return 'pdf'
  if (/image\/(jpeg|png|webp)/.test(normalized) || /\.(jpe?g|png|webp)$/.test(normalized)) return 'image'
  return 'unsupported'
}

export function FileContentPreview({
  fileUrl,
  fileName,
  mimeType,
  format,
  className = '',
  compact = false,
}: FileContentPreviewProps) {
  const [renderFailed, setRenderFailed] = useState(false)
  const kind = renderFailed ? 'unavailable' : resolvePreviewKind(fileUrl, fileName, mimeType, format)

  return (
    <section
      className={`relative flex min-w-0 flex-col overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 ${compact ? 'min-h-[240px]' : 'min-h-[360px]'} ${className}`}
      aria-label={`${fileName} 文件预览`}
      data-file-preview-kind={kind}
    >
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-white">
        {kind === 'pdf' && (
          <iframe
            title={`${fileName} 预览`}
            src={fileUrl ?? undefined}
            className={`h-full w-full bg-white ${compact ? 'min-h-[240px]' : 'min-h-[360px]'}`}
            onError={() => setRenderFailed(true)}
          />
        )}
        {kind === 'image' && (
          <img
            src={fileUrl ?? undefined}
            alt={`${fileName} 预览`}
            className={`h-full w-full object-contain ${compact ? 'max-h-[320px]' : 'max-h-[560px]'}`}
            onError={() => setRenderFailed(true)}
          />
        )}
        {(kind === 'unsupported' || kind === 'unavailable') && (
          <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
            <FileWarningIcon className="h-10 w-10 text-neutral-300" aria-hidden="true" />
            <p className="break-all text-sm font-semibold text-neutral-800">{fileName}</p>
            <p className="max-w-lg text-xs leading-5 text-neutral-500">
              {kind === 'unsupported'
                ? '该格式不能在当前浏览器内直接显示，请在新窗口核对原文件。'
                : '预览链接不可用或已过期，请重新上传文件。'}
            </p>
          </div>
        )}
      </div>
      {fileUrl && !fileUrl.startsWith('/mock/') && (
        <a
          href={fileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-12 items-center justify-center gap-2 border-t border-neutral-200 bg-white px-4 text-sm font-semibold text-primary-700 hover:bg-primary-50"
        >
          <ExternalLinkIcon className="h-4 w-4" aria-hidden="true" />
          在新窗口打开原文件
        </a>
      )}
    </section>
  )
}
