import { useEffect, useState } from 'react'
import { FileWarningIcon, Loader2Icon } from 'lucide-react'
import {
  convertDocumentToPdf,
  isWordDocument,
  useDocumentConversionCapabilities,
  WORD_CONVERSION_DISCLOSURE,
  WORD_CONVERSION_UNAVAILABLE_COPY,
} from '../services/api/documentConversion'
import { userMessageOf } from '../services/api/userErrorMessage'

type PreviewKind = 'pdf' | 'image' | 'word' | 'unsupported' | 'unavailable'

interface FileContentPreviewProps {
  fileUrl?: string | null
  fileName: string
  mimeType?: string | null
  format?: string | null
  fileId?: string | null
  token?: string | null
  className?: string
  compact?: boolean
}

function resolvePreviewKind(
  fileUrl: string | null | undefined,
  fileName: string,
  mimeType?: string | null,
  format?: string | null,
): PreviewKind {
  if (isWordDocument({ fileName, mimeType, format })) return 'word'
  if (!fileUrl || fileUrl.startsWith('/mock/')) return 'unavailable'
  const normalizedMime = mimeType?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  const normalizedFormat = format?.trim().replace(/^\./, '').toLowerCase() ?? ''
  const extension = fileName.trim().toLowerCase().match(/\.([^.]+)$/)?.[1] ?? ''
  if (normalizedMime === 'application/pdf') return 'pdf'
  if (['image/jpeg', 'image/png', 'image/webp'].includes(normalizedMime)) return 'image'
  if (normalizedMime && !['application/octet-stream', 'binary/octet-stream'].includes(normalizedMime)) return 'unsupported'
  if (normalizedFormat === 'pdf' || extension === 'pdf') return 'pdf'
  if (['jpg', 'jpeg', 'png', 'webp'].includes(normalizedFormat) || ['jpg', 'jpeg', 'png', 'webp'].includes(extension)) return 'image'
  return 'unsupported'
}

export function FileContentPreview({
  fileUrl,
  fileName,
  mimeType,
  format,
  fileId,
  token,
  className = '',
  compact = false,
}: FileContentPreviewProps) {
  const [renderFailed, setRenderFailed] = useState(false)
  const [convertedUrl, setConvertedUrl] = useState<string | null>(null)
  const [conversionError, setConversionError] = useState<string | null>(null)
  const [converting, setConverting] = useState(false)
  const { capabilities, loading: capabilitiesLoading } = useDocumentConversionCapabilities()
  const sourceKind = resolvePreviewKind(fileUrl, fileName, mimeType, format)

  useEffect(() => {
    setRenderFailed(false)
    setConvertedUrl(null)
    setConversionError(null)
  }, [fileName, fileUrl, format, mimeType])

  useEffect(() => {
    if (sourceKind !== 'word' || !capabilities.wordToPdf || !fileId) return
    let active = true
    setConverting(true)
    setConversionError(null)
    void convertDocumentToPdf(fileId, token)
      .then((result) => {
        if (active) setConvertedUrl(result.signedUrl)
      })
      .catch((error: unknown) => {
        if (active) setConversionError(userMessageOf(error, 'Word 转 PDF 失败，请稍后重试或改传 PDF 文件'))
      })
      .finally(() => {
        if (active) setConverting(false)
      })
    return () => { active = false }
  }, [capabilities.wordToPdf, fileId, sourceKind, token])

  // 引擎未开放时 Word 按诚实的「不支持」态渲染（data-file-preview-kind=unsupported，与既有走查用例一致），
  // 只有能力为真才进入 word（转换中 / 转换失败）态，转换成功后按 pdf 渲染。
  const kind = renderFailed
    ? 'unavailable'
    : sourceKind === 'word' && convertedUrl
      ? 'pdf'
      : sourceKind === 'word' && !capabilities.wordToPdf
        ? 'unsupported'
        : sourceKind
  const previewUrl = convertedUrl ?? fileUrl
  const wordUnavailableReason = capabilities.reason?.trim() || WORD_CONVERSION_UNAVAILABLE_COPY

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
            src={previewUrl ?? undefined}
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
        {kind === 'word' && (
          <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
            {converting ? (
              <Loader2Icon className="h-10 w-10 animate-spin text-primary-500" aria-hidden="true" />
            ) : (
              <FileWarningIcon className="h-10 w-10 text-neutral-300" aria-hidden="true" />
            )}
            <p className="break-all text-sm font-semibold text-neutral-800">{fileName}</p>
            <p className="max-w-lg text-xs leading-5 text-neutral-500" role="status">
              {capabilitiesLoading
                ? '正在确认 Word 转换能力，PDF 和图片仍可正常预览。'
                : !capabilities.wordToPdf
                  ? `${WORD_CONVERSION_UNAVAILABLE_COPY}。${wordUnavailableReason}`
                  : !fileId
                    ? '缺少文件标识，无法生成 Word 页内预览；文件本身是否可用以页面文件状态为准。'
                    : conversionError
                      ? `Word 页内预览生成失败：${conversionError}`
                      : '正在由转换引擎生成 PDF 预览，请稍候。'}
            </p>
            {!capabilities.wordToPdf && (
              <span aria-disabled="true" className="sr-only">
                Word 页内预览不可用：{wordUnavailableReason}
              </span>
            )}
          </div>
        )}
        {(kind === 'unsupported' || kind === 'unavailable') && (
          <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
            <FileWarningIcon className="h-10 w-10 text-neutral-300" aria-hidden="true" />
            <p className="break-all text-sm font-semibold text-neutral-800">{fileName}</p>
            {/*
              「预览失败」≠「上传失败」。
              事故原样（2026-08-18 走查）：上传页文件卡写着「已就绪」，正下方这张卡
              却说预览链接已过期、要用户再传一次。两句同屏自相矛盾，
              用户以为传失败了，于是重传一次 —— 还是这样，白跑两趟。
              本组件也用在「我的文档」「扫描结果」「敏感文件预览弹窗」上，那些地方
              根本没有「重新上传」这个动作，这句指令在那里同样是错的。
              现在只陈述预览这一件事，不指挥用户去做无用功；文件本身是否可用，
              以页面上的文件状态为准。
            */}
            <p className="max-w-lg text-xs leading-5 text-neutral-500">
              {kind === 'unsupported'
                ? sourceKind === 'word'
                  ? `Word 文档暂不能页内预览（${wordUnavailableReason}）；可扫码到手机打开原件，或另存为 PDF 后上传。`
                  : '该格式不能在当前浏览器内直接显示，请更换为 PDF、JPG、PNG 或 WebP 文件后预览。'
                : '这份文件无法在本页内嵌预览；预览失败不代表文件本身有问题，文件状态以页面上的文件卡为准。'}
            </p>
          </div>
        )}
      </div>
      {sourceKind === 'word' && capabilities.wordToPdf && (
        <p className="border-t border-primary-100 bg-primary-50 px-4 py-2 text-xs leading-5 text-primary-700">
          {WORD_CONVERSION_DISCLOSURE}
        </p>
      )}
    </section>
  )
}
