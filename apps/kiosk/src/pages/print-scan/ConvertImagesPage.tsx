// apps/kiosk/src/pages/print-scan/ConvertImagesPage.tsx
//
// 格式转换（图片→PDF），/print-scan/convert。
// 本机单文件上传（沿用 PrintUploadPage 的 A2 桌面验证定位）与手机扫码上传
// （UploadSessionQrPanel）均为"一次一张、可继续添加"；生成后直接进 /print/confirm。

import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, KioskActionBar, KioskPageFrame, KioskPageHeader, KioskStatePanel } from '@ai-job-print/ui'
import { makePrintParams } from '@ai-job-print/shared'
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  FileType2Icon,
  ImageIcon,
  InfoIcon,
  LoaderIcon,
  PlusIcon,
  QrCodeIcon,
  TrashIcon,
  UploadIcon,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { kioskUploadFile } from '../../services/files/filesApi'
import { convertImagesToPdf } from '../../services/api/printConversion'
import { UploadSessionQrPanel, type PhoneUploadedFile } from '../upload/components/UploadSessionQrPanel'
import './styles/print-scan-fusion.css'

const MAX_IMAGES = 20
// 必须与后端 services/api/src/print-conversion/print-conversion.service.ts 的
// MAX_SINGLE_IMAGE_BYTES 保持一致：本机上传通道（/files/kiosk-upload）允许到 15MB，
// 但格式转换单张图片超过此值会在生成 PDF 时才被拒绝；这里提前校验避免无效上传。
const MAX_SINGLE_IMAGE_BYTES = 10 * 1024 * 1024

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
    if (selected.size > MAX_SINGLE_IMAGE_BYTES) {
      setError(`图片大小不能超过 ${formatBytes(MAX_SINGLE_IMAGE_BYTES)}，请压缩后重试`)
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
    <KioskPageFrame className="w2-print-scan-page">
      <div data-w2-page="print-scan-convert" className="w2-print-scan-shell flex h-full flex-col bg-canvas px-6 py-5 text-neutral-900">
      <KioskPageHeader title="格式转换" description="多张图片合并为一份 PDF，仅支持 JPG / PNG" onBack={() => navigate('/print-scan')} backLabel="返回打印扫描服务" />

      <section className="mt-4 flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex items-center gap-3 rounded-lg border border-info/30 bg-info-bg px-5 py-4 text-base leading-relaxed text-info-fg">
          <InfoIcon className="h-5 w-5 shrink-0" />
          转换生成的 PDF 会保存到「我的文档」，默认保存约 24 小时，可在「我的文档」页面手动延长保存期限；生成后直接进入确认打印。
        </div>

        {error && <KioskStatePanel compact tone="error" title="转换暂未完成" description={error} icon={<AlertCircleIcon />} />}

        <div className="flex min-h-0 flex-1 gap-5">
          <section className="flex min-w-0 flex-1 flex-col rounded-lg border border-info/30 border-t-4 border-t-info bg-surface p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-full bg-info-bg text-info-fg">
                <ImageIcon className="h-6 w-6" />
              </span>
              <div>
                <h2 className="text-[26px] font-bold">待合并图片（{images.length} / {MAX_IMAGES}）</h2>
                <p className="text-base text-neutral-500">合并顺序即页面顺序，可用右侧按钮调整或移除</p>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3">
              {images.map((img, index) => (
                <div key={img.fileId} className="flex flex-1 items-center gap-4 rounded-md border border-neutral-200 bg-canvas px-5 py-3">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] border border-neutral-200 bg-surface text-xl font-bold text-neutral-500">{index + 1}</span>
                  <span className="flex aspect-[210/297] h-[108px] shrink-0 flex-col gap-1.5 rounded border border-neutral-200 bg-white p-2.5 shadow-sm">
                    <i className="h-2.5 w-3/5 rounded bg-info-bg ring-1 ring-info/25" />
                    <i className="h-1.5 w-4/5 rounded-full bg-neutral-200" />
                    <i className="h-1.5 w-3/5 rounded-full bg-neutral-200" />
                    <i className="h-1.5 w-4/5 rounded-full bg-neutral-200" />
                    <i className="h-1.5 w-3/5 rounded-full bg-neutral-200" />
                  </span>
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[12px] bg-info-bg text-info-fg">
                    <ImageIcon className="h-6 w-6" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block break-all text-[22px] font-bold">{img.name}</b>
                    <span className="mt-1 block text-[16.5px] text-neutral-500">{img.size} · {img.name.includes('手机') ? '手机扫码上传' : '本机上传'}</span>
                  </span>
                  <span className="flex shrink-0 flex-col gap-1.5">
                    <button type="button" disabled={index === 0} onClick={() => moveImage(index, -1)} className="grid h-12 w-12 place-items-center rounded-md border border-neutral-200 bg-surface text-neutral-500 disabled:opacity-30" aria-label="上移">
                      <ArrowUpIcon className="h-5 w-5" />
                    </button>
                    <button type="button" disabled={index === images.length - 1} onClick={() => moveImage(index, 1)} className="grid h-12 w-12 place-items-center rounded-md border border-neutral-200 bg-surface text-neutral-500 disabled:opacity-30" aria-label="下移">
                      <ArrowDownIcon className="h-5 w-5" />
                    </button>
                    <button type="button" onClick={() => removeImage(index)} className="grid h-12 w-12 place-items-center rounded-md border border-error/30 bg-surface text-error-fg" aria-label="移除">
                      <TrashIcon className="h-5 w-5" />
                    </button>
                  </span>
                </div>
              ))}

              <button type="button" disabled={atLimit} onClick={() => inputRef.current?.click()} className="flex flex-1 items-center justify-center gap-3 rounded-md border-2 border-dashed border-neutral-200 bg-surface text-xl font-semibold text-neutral-500 disabled:opacity-45">
                <PlusIcon className="h-7 w-7" />
                {images.length === 0 ? '添加第一张图片' : `继续添加图片（还可添加 ${MAX_IMAGES - images.length} 张）`}
              </button>
            </div>

            <div className="mt-4 flex items-center gap-3 rounded-lg border border-info/30 bg-info-bg px-4 py-3 text-base text-info-fg">
              <InfoIcon className="h-5 w-5 shrink-0" />
              生成的 PDF 每张图片占一页，按 A4 自动排版；生成后文件名为「格式转换-{images.length || 0}张图片.pdf」。
            </div>
          </section>

          <aside className="flex w-[420px] shrink-0 flex-col gap-4">
            <section className="rounded-lg border border-neutral-200 bg-surface p-5 shadow-sm">
              <b className="mb-3 block text-xl font-bold">继续添加图片</b>
              <input ref={inputRef} type="file" accept="image/jpeg,image/png" className="sr-only" onChange={handleLocalFile} />
              <button type="button" disabled={uploading || atLimit} onClick={() => inputRef.current?.click()} className="flex min-h-[88px] w-full items-center gap-4 rounded-lg border border-info/30 bg-info-bg px-4 text-left text-info-fg disabled:opacity-45">
                <span className="grid h-12 w-12 place-items-center rounded-md bg-surface">
                  {uploading ? <LoaderIcon className="h-6 w-6 animate-spin" /> : <UploadIcon className="h-6 w-6" />}
                </span>
                <span><b className="block text-xl font-bold">本机上传一张</b><span className="mt-1 block text-base text-neutral-500">每次选择一张，可连续添加</span></span>
              </button>
              <button type="button" disabled={atLimit} onClick={() => setShowQr(true)} className="mt-3 flex min-h-[88px] w-full items-center gap-4 rounded-lg border border-neutral-200 bg-canvas px-4 text-left disabled:opacity-45">
                <span className="grid h-12 w-12 place-items-center rounded-md bg-surface text-info-fg">
                  <QrCodeIcon className="h-6 w-6" />
                </span>
                <span><b className="block text-xl font-bold">手机扫码添加</b><span className="mt-1 block text-base text-neutral-500">手机拍摄或选图，确认后加入列表</span></span>
              </button>
            </section>

            {showQr && (
              <UploadSessionQrPanel
                purpose="print_doc"
                title="手机扫码添加图片"
                description="手机扫码上传一张图片，确认后自动加入待合并列表；可重复扫码继续添加。"
                confirmLabel="确认加入待合并列表"
                onUploaded={handlePhoneUploaded}
                onBusyChange={setQrBusy}
              />
            )}

            <section className="flex flex-1 flex-col rounded-lg border border-neutral-200 bg-surface p-5 shadow-sm">
              <b className="mb-2 block text-xl font-bold">转换规则</b>
              <ul className="flex flex-1 list-disc flex-col justify-around gap-2 pl-5 text-[17.5px] leading-relaxed text-neutral-500">
                <li>仅支持 JPG / PNG 图片，单张不超过 10 MB。</li>
                <li>一次最多合并 20 张图片，生成一份 PDF。</li>
                <li>合并顺序即 PDF 页面顺序，生成前请调整好。</li>
                <li>生成后自动进入确认打印；PDF 已保存到「我的文档」。</li>
              </ul>
            </section>
          </aside>
        </div>
      </section>

      <KioskActionBar>
        <Button variant="secondary" size="lg" className="h-14 px-7 text-lg" onClick={() => navigate('/print-scan')}>
          <ArrowLeftIcon className="mr-2 h-5 w-5" />
          返回
        </Button>
        <span className="flex-1" />
        <Button size="lg" className="h-14 min-w-[460px] text-lg" disabled={generating || images.length === 0} onClick={() => void handleGenerate()}>
          {generating ? <LoaderIcon className="mr-2 h-5 w-5 animate-spin" /> : <FileType2Icon className="mr-2 h-5 w-5" />}
          {generating ? '正在生成…' : `生成 PDF（${images.length} 张）`}
        </Button>
      </KioskActionBar>
      </div>
    </KioskPageFrame>
  )
}
