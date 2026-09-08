// apps/kiosk/src/pages/print-scan/ConvertImagesPage.tsx
//
// 格式转换（图片→PDF），/print-scan/convert。青序流光 19-img2pdf.html。
// 本机单文件上传与手机扫码上传均为"一次一张、可继续添加"。
// 列表数组顺序就是 POST sources 顺序，也是 PDF 页序。
// 生成成功后进入 /print/material-check，不直达报价或出纸。

import { useRef, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { HomeIcon, SparklesIcon, UserIcon } from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { kioskUploadFile } from '../../services/files/filesApi'
import { getTerminalId, isTerminalKiosk } from '../../services/api/screensaver'
import { getTerminalCode } from '../../services/api/terminalConfig'
import { convertImagesToPdf } from '../../services/api/printConversion'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { savePrintMaterialSession } from '../print/printMaterialSession'
import type { PhoneUploadedFile } from '../upload/components/UploadSessionQrPanel'
import { ConvertImagesCta } from './ConvertImagesPanels'
import { ConvertImagesView } from './ConvertImagesView'
import {
  MAX_IMAGES,
  MAX_SINGLE_IMAGE_BYTES,
  classifyConvertError,
  formatBytes,
  keyForImages,
  mintIdempotencyKey,
  outputFileName,
  parseSizeBytes,
  statusForPhase,
  derivePhase,
  type ConvertError,
  type ConvertIdempotency,
  type ConvertPreview,
  type SelectedImage,
} from './convert-images-model'
import './styles/convert-images-qx.css'

const LIMIT_MESSAGE = `最多支持 ${MAX_IMAGES} 张图片，已达上限`

export function ConvertImagesPage() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const uploadGen = useRef(0)
  const [images, setImages] = useState<SelectedImage[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [rechecking, setRechecking] = useState(false)
  const [error, setError] = useState<ConvertError | null>(null)
  const [showQr, setShowQr] = useState(false)
  const [qrBusy, setQrBusy] = useState(false)
  const [usbOpen, setUsbOpen] = useState(false)
  const [result, setResult] = useState<Awaited<ReturnType<typeof convertImagesToPdf>> | null>(null)
  const [recovered, setRecovered] = useState(false)
  const [idempotency, setIdempotency] = useState<ConvertIdempotency | null>(null)
  const [lastSubmitted, setLastSubmitted] = useState<SelectedImage[] | null>(null)
  const [preview, setPreview] = useState<ConvertPreview | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  const sentRef = useRef(false)

  useBusyLock(uploading || generating || qrBusy || rechecking)

  const atLimit = images.length >= MAX_IMAGES
  const kiosk = isTerminalKiosk()
  const loggedIn = Boolean(getToken())
  const phase = derivePhase({
    usbOpen,
    uploading,
    generating,
    rechecking,
    result,
    error,
    imageCount: images.length,
  })
  const status = statusForPhase(phase, images.length, error, selected, recovered)

  const addImage = (image: SelectedImage) => {
    setImages((prev) => {
      if (prev.length >= MAX_IMAGES) {
        setError({ kind: 'generic', message: LIMIT_MESSAGE })
        return prev
      }
      setError(null)
      return [...prev, image]
    })
  }

  const handlePickLocal = () => {
    setUsbOpen(false)
    if (atLimit || uploading || generating) return
    if (kiosk) {
      setShowQr(true)
      return
    }
    inputRef.current?.click()
  }

  const handleLocalFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    e.target.value = ''
    if (!selectedFile) return
    if (!['image/jpeg', 'image/png'].includes(selectedFile.type)) {
      setError({
        kind: 'format',
        message: '仅支持 JPG / PNG 图片',
        rejected: { name: selectedFile.name, detail: selectedFile.type || '未知格式' },
      })
      return
    }
    if (selectedFile.size > MAX_SINGLE_IMAGE_BYTES) {
      setError({
        kind: 'too-large',
        message: `图片大小不能超过 ${formatBytes(MAX_SINGLE_IMAGE_BYTES)}，请压缩后重试`,
        rejected: { name: selectedFile.name, detail: formatBytes(selectedFile.size) },
      })
      return
    }
    const gen = ++uploadGen.current
    setUploading(true)
    setError(null)
    try {
      const res = await kioskUploadFile(selectedFile, getToken())
      if (gen !== uploadGen.current) return
      addImage({
        fileId: res.fileId,
        fileAccessUrl: res.signedUrl,
        name: res.filename,
        size: formatBytes(res.sizeBytes),
        sizeBytes: res.sizeBytes,
        source: 'local',
        expiresAt: res.signedUrlExpiresAt,
      })
    } catch (err) {
      if (gen !== uploadGen.current) return
      setError({
        kind: 'upload-failed',
        message: userMessageOf(err, '上传失败，请重试'),
        rejected: { name: selectedFile.name, detail: '没有拿到服务端确认' },
      })
    } finally {
      if (gen === uploadGen.current) setUploading(false)
    }
  }

  const handlePhoneUploaded = (file: PhoneUploadedFile) => {
    if (!file.fileUrl) {
      setError({ kind: 'upload-failed', message: '手机上传未返回可用的文件地址，请重试', rejected: { name: file.name, detail: '没有文件地址' } })
      return
    }
    addImage({
      fileId: file.fileId,
      fileAccessUrl: file.fileUrl,
      name: file.name,
      size: file.size,
      sizeBytes: parseSizeBytes(file.size),
      source: 'qr',
    })
    setShowQr(false)
  }

  const handleSelect = (index: number) => {
    if (generating || rechecking) return
    setSelected((prev) => (prev === index ? null : index))
  }

  const handleMove = (direction: -1 | 1) => {
    if (selected === null) return
    setImages((prev) => {
      const target = selected + direction
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      const tmp = next[selected]!
      next[selected] = next[target]!
      next[target] = tmp
      return next
    })
    setSelected((prev) => (prev === null ? prev : prev + direction))
    setResult(null)
    setRecovered(false)
  }

  const handleRemove = () => {
    if (selected === null) return
    const index = selected
    setImages((prev) => prev.filter((_, i) => i !== index))
    setSelected(null)
    setResult(null)
    setRecovered(false)
    setError((prev) => (prev?.message === LIMIT_MESSAGE ? null : prev))
  }

  const runConvert = async (
    mode: 'convert' | 'recheck',
    forceNewKey = false,
    sourceImages: SelectedImage[] = images,
  ) => {
    if (sourceImages.length === 0) {
      setError({ kind: 'generic', message: '请先添加至少一张图片' })
      return
    }
    const terminalId = getTerminalId()
    if (!terminalId) {
      setError({ kind: 'capability', message: '终端编号未配置，无法使用格式转换' })
      return
    }
    const previousKind = error?.kind
    const nextKey = forceNewKey
      ? { key: mintIdempotencyKey(), fingerprint: sourceImages.map((img) => img.fileId).join('|') }
      : keyForImages(sourceImages, idempotency)
    setIdempotency(nextKey)
    setLastSubmitted(sourceImages)
    setError(null)
    setResult(null)
    if (mode === 'recheck') setRechecking(true)
    else setGenerating(true)
    sentRef.current = true
    try {
      const converted = await convertImagesToPdf(
        {
          terminalId,
          sources: sourceImages.map((img) => ({ fileId: img.fileId, fileAccessUrl: img.fileAccessUrl })),
        },
        { token: getToken(), idempotencyKey: nextKey.key },
      )
      setRecovered(mode === 'recheck' || previousKind === 'result-unknown' || previousKind === 'in-progress')
      setResult(converted)
      setError(null)
    } catch (err) {
      const message = userMessageOf(err, '生成失败，请稍后重试')
      setError(classifyConvertError(err, sourceImages, message, sentRef.current))
      setResult(null)
    } finally {
      setGenerating(false)
      setRechecking(false)
    }
  }

  const handlePrint = () => {
    if (!result) return
    const file = {
      name: outputFileName(result.pages),
      size: formatBytes(result.sizeBytes),
      pages: result.pages,
      fileId: result.fileId,
      fileUrl: result.printFileUrl,
      fileMd5: result.fileMd5,
      mimeType: 'application/pdf',
    }
    savePrintMaterialSession({ file, source: 'document' })
    navigate('/print/material-check', {
      state: { file, source: 'document' },
    })
  }

  const handleRestoreOrder = () => {
    if (!lastSubmitted) return
    setImages(lastSubmitted)
    setSelected(null)
    void runConvert('recheck', false, lastSubmitted)
  }

  // 未登录时 PDF 不会进入「我的文档」——按登录态在 ConvertImagesView 分别渲染，游客不得看到已保存。
  const terminalLabel = getTerminalCode() ? `就业服务大厅 · ${getTerminalCode()}` : '就业服务大厅'

  return (
    <QxPageFrame
      title="图片转 PDF"
      subtitle="几张图拼成一份 PDF。顺序你自己排，一张一页。"
      status={status}
      terminalLabel={terminalLabel}
      ctabar={
        <ConvertImagesCta
          phase={phase}
          imageCount={images.length}
          error={error}
          generating={generating}
          rechecking={rechecking}
          uploading={uploading}
          loggedIn={loggedIn}
          onBack={() => navigate('/print-scan')}
          onConvert={() => void runConvert('convert')}
          onRecheck={() => void runConvert('recheck')}
          onNewKey={() => void runConvert('convert', true)}
          onRestoreOrder={handleRestoreOrder}
          onPrint={handlePrint}
          onLogin={() => navigate('/login')}
          onDocuments={() => navigate('/me/documents')}
          onHelp={() => navigate('/help')}
          onCancelUpload={() => {
            uploadGen.current += 1
            setUploading(false)
          }}
          onCloseUsb={() => {
            setUsbOpen(false)
            handlePickLocal()
          }}
          onPickLocal={handlePickLocal}
        />
      }
      navbar={
        <>
          <button type="button" className="qx-nav-item" onClick={() => navigate('/')}>
            <HomeIcon size={34} />
            <span>首页</span>
          </button>
          <button type="button" className="qx-nav-item" onClick={() => navigate('/assistant')}>
            <SparklesIcon size={34} />
            <span>AI 顾问</span>
          </button>
          <button type="button" className="qx-nav-item" onClick={() => navigate('/profile')}>
            <UserIcon size={34} />
            <span>我的</span>
          </button>
        </>
      }
    >
      <ConvertImagesView
        loggedIn={loggedIn}
        kiosk={kiosk}
        phase={phase}
        images={images}
        selected={selected}
        uploading={uploading}
        generating={generating}
        rechecking={rechecking}
        showQr={showQr}
        error={error}
        result={result}
        recovered={recovered}
        requestKey={idempotency?.key ?? null}
        preview={preview}
        previewFailed={previewFailed}
        inputRef={inputRef}
        atLimit={atLimit}
        onPickLocal={handlePickLocal}
        onLocalFile={(event) => void handleLocalFile(event)}
        onShowQr={() => { setUsbOpen(false); setShowQr(true) }}
        onPhoneUploaded={handlePhoneUploaded}
        onQrBusy={setQrBusy}
        onOpenUsb={() => { setShowQr(false); setUsbOpen(true) }}
        onCloseUsb={() => setUsbOpen(false)}
        onSelect={handleSelect}
        onMove={handleMove}
        onRemove={handleRemove}
        onPreviewInput={(index) => { setPreviewFailed(false); setPreview({ kind: 'input', index }) }}
        onPreviewOutput={(index) => { setPreviewFailed(false); setPreview({ kind: 'output', index }) }}
        onClosePreview={() => { setPreview(null); setPreviewFailed(false) }}
        onPreviewError={() => setPreviewFailed(true)}
        onCancelUpload={() => { uploadGen.current += 1; setUploading(false) }}
        onConvert={() => void runConvert('convert')}
        onRecheck={() => void runConvert('recheck')}
        onNewKey={() => void runConvert('convert', true)}
        onRestoreOrder={handleRestoreOrder}
        onPrint={handlePrint}
        onLogin={() => navigate('/login')}
        onDocuments={() => navigate('/me/documents')}
        onHelp={() => navigate('/help')}
        onBack={() => navigate('/print-scan')}
      />
    </QxPageFrame>
  )
}
