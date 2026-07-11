// apps/kiosk/src/pages/print-scan/ConvertImagesPage.tsx
//
// 格式转换（图片→PDF），/print-scan/convert。
// 本机单文件上传（沿用 PrintUploadPage 的 A2 桌面验证定位）与手机扫码上传
// （UploadSessionQrPanel）均为"一次一张、可继续添加"；生成后直接进 /print/confirm。

import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, ComplianceBanner, PageHeader } from '@ai-job-print/ui'
import { makePrintParams } from '@ai-job-print/shared'
import {
  AlertCircleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  FileType2Icon,
  ImageIcon,
  LoaderIcon,
  QrCodeIcon,
  TrashIcon,
  UploadIcon,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { kioskUploadFile } from '../../services/files/filesApi'
import { convertImagesToPdf } from '../../services/api/printConversion'
import { UploadSessionQrPanel, type PhoneUploadedFile } from '../upload/components/UploadSessionQrPanel'

const MAX_IMAGES = 20

interface SelectedImage {
  fileId: string
  fileAccessUrl: string
  name: string
  size: string
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ConvertImagesPage() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const [images, setImages] = useState<SelectedImage[]>([])
  const [uploading, setUploading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showQr, setShowQr] = useState(false)
  const [qrBusy, setQrBusy] = useState(false)

  // 手机扫码上传面板打开期间（用户可能拿着手机离开一体机去扫码/选图/上传/确认，
  // 整个过程很容易超过待机屏的无操作阈值）必须持锁，否则待机屏会打断并清空
  // 未持久化的 images state（见 KioskBusyContext 顶部注释）。
  useBusyLock(uploading || generating || qrBusy)

  const atLimit = images.length >= MAX_IMAGES

  const addImage = (image: SelectedImage) => {
    if (atLimit) {
      setError(`最多支持 ${MAX_IMAGES} 张图片，已达上限`)
      return
    }
    setError(null)
    setImages((prev) => [...prev, image])
  }

  const handleLocalFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    e.target.value = ''
    if (!selected) return
    if (!['image/jpeg', 'image/png'].includes(selected.type)) {
      setError('仅支持 JPG / PNG 图片')
      return
    }
    setUploading(true)
    setError(null)
    try {
      const res = await kioskUploadFile(selected, getToken())
      addImage({ fileId: res.fileId, fileAccessUrl: res.signedUrl, name: res.filename, size: formatBytes(res.sizeBytes) })
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败，请重试')
    } finally {
      setUploading(false)
    }
  }

  const handlePhoneUploaded = (file: PhoneUploadedFile) => {
    if (!file.fileUrl) {
      setError('手机上传未返回可用的文件地址，请重试')
      return
    }
    addImage({ fileId: file.fileId, fileAccessUrl: file.fileUrl, name: file.name, size: file.size })
    setShowQr(false)
  }

  const moveImage = (index: number, direction: -1 | 1) => {
    setImages((prev) => {
      const target = index + direction
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      const tmp = next[index]!
      next[index] = next[target]!
      next[target] = tmp
      return next
    })
  }

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index))
    // 删除一张后如果之前是"已达上限"提示，随即失效，避免继续挂在页面上迷惑用户
    setError((prev) => (prev === `最多支持 ${MAX_IMAGES} 张图片，已达上限` ? null : prev))
  }

  const handleGenerate = async () => {
    if (images.length === 0) {
      setError('请先添加至少一张图片')
      return
    }
    setGenerating(true)
    setError(null)
    try {
      const idempotencyKey = `convert-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      const result = await convertImagesToPdf(
        { sources: images.map((img) => ({ fileId: img.fileId, fileAccessUrl: img.fileAccessUrl })) },
        { token: getToken(), idempotencyKey },
      )
      navigate('/print/confirm', {
        state: {
          file: {
            name: `格式转换-${images.length}张图片.pdf`,
            size: formatBytes(result.sizeBytes),
            pages: result.pages,
            fileId: result.fileId,
            fileUrl: result.printFileUrl,
            fileMd5: result.fileMd5,
            mimeType: 'application/pdf',
          },
          params: makePrintParams({ copies: 1, duplex: 'single', color: 'bw' }),
          source: 'document',
        },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败，请稍后重试')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="flex h-full flex-col px-6 pt-6">
      <PageHeader
        title="格式转换"
        subtitle="多张图片合并为一份 PDF，仅支持 JPG / PNG"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/print-scan')}>
            返回打印扫描服务
          </Button>
        }
      />

      <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto pb-28">
        <ComplianceBanner tone="info">
          转换生成的 PDF 会保存到「我的文档」，默认保存约 24 小时，可在「我的文档」页面手动延长保存期限。
        </ComplianceBanner>

        <div className="grid grid-cols-2 gap-3">
          <input ref={inputRef} type="file" accept="image/jpeg,image/png" className="sr-only" onChange={handleLocalFile} />
          <Button size="lg" variant="secondary" disabled={uploading || atLimit} onClick={() => inputRef.current?.click()}>
            {uploading ? <LoaderIcon className="mr-1.5 h-5 w-5 animate-spin" /> : <UploadIcon className="mr-1.5 h-5 w-5" />}
            本机上传一张
          </Button>
          <Button size="lg" variant="secondary" disabled={atLimit} onClick={() => setShowQr(true)}>
            <QrCodeIcon className="mr-1.5 h-5 w-5" />
            手机扫码添加
          </Button>
        </div>

        {showQr && (
          <Card className="p-4">
            <UploadSessionQrPanel
              purpose="print_doc"
              title="手机扫码添加图片"
              description="手机扫码上传一张图片，确认后自动加入待合并列表；可重复扫码继续添加。"
              confirmLabel="确认加入待合并列表"
              onUploaded={handlePhoneUploaded}
              onBusyChange={setQrBusy}
            />
          </Card>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-error/30 bg-error-bg px-3 py-2 text-sm text-error-fg">
            <AlertCircleIcon className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <Card className="p-4">
          <p className="mb-3 text-sm font-medium text-neutral-700">
            待合并图片（{images.length}/{MAX_IMAGES}）
          </p>
          {images.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-neutral-400">
              <ImageIcon className="h-10 w-10" />
              <p className="text-sm">还没有添加图片</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {images.map((img, index) => (
                <div key={img.fileId} className="flex items-center gap-3 rounded-xl border border-neutral-100 px-3 py-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-xs font-semibold text-neutral-500">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-900">{img.name}</p>
                    <p className="text-xs text-neutral-400">{img.size}</p>
                  </div>
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => moveImage(index, -1)}
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-neutral-400 disabled:opacity-30"
                    aria-label="上移"
                  >
                    <ArrowUpIcon className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    disabled={index === images.length - 1}
                    onClick={() => moveImage(index, 1)}
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-neutral-400 disabled:opacity-30"
                    aria-label="下移"
                  >
                    <ArrowDownIcon className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeImage(index)}
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-error-fg"
                    aria-label="移除"
                  >
                    <TrashIcon className="h-5 w-5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="absolute inset-x-0 bottom-0 border-t border-neutral-100 bg-white/95 px-6 py-4 backdrop-blur">
        <Button size="lg" className="h-14 w-full text-base" disabled={generating || images.length === 0} onClick={() => void handleGenerate()}>
          {generating ? (
            <>
              <LoaderIcon className="mr-2 h-5 w-5 animate-spin" />
              正在生成…
            </>
          ) : (
            <>
              <FileType2Icon className="mr-1.5 h-5 w-5" />
              生成 PDF（{images.length} 张）
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
