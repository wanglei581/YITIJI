// apps/kiosk/src/pages/print-scan/IdPhotoPage.tsx
//
// 证件照打印（/print-scan/id-photo）。设计：docs/superpowers/specs/2026-07-12-id-photo-design.md
// 流程：选规格 → 本机/扫码取图 → 浏览器内 cover 裁剪+预览（原图不出浏览器，本机路径原图不上传）
//   → 上传裁剪产物(id_scan) → 生成 A4 整版排版 PDF → /print/confirm（证件照专用参数契约，固定彩色）。
// 隐私：裁剪产物与排版 PDF 高敏 1h TTL；打印建单后服务端自动删源；页面提供「立即删除照片」。

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, ComplianceBanner, PageHeader } from '@ai-job-print/ui'
import {
  ID_PHOTO_SPECS,
  makePrintParams,
  canCreateFormalPrintScanTask,
  type IdPhotoSpec,
} from '@ai-job-print/shared'
import { AlertCircleIcon, LoaderIcon, QrCodeIcon, TrashIcon, UploadIcon, UserSquareIcon } from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { kioskUploadFile } from '../../services/api/files'
import { getConfiguredCapabilities } from '../../services/api/printScanCapabilities'
import { getTerminalId } from '../../services/api/screensaver'
import { deleteIdPhotoFile, generateIdPhotoLayout, resolveFileContentUrl } from '../../services/api/idPhoto'
import { cropToSpec } from './idPhotoCrop'
import { UploadSessionQrPanel, type PhoneUploadedFile } from '../upload/components/UploadSessionQrPanel'

interface CroppedState {
  fileId: string
  fileAccessUrl: string
  previewUrl: string
  lowResolution: boolean
  /** 游客场景 layout 响应回填，手动删除用 */
  deleteToken?: string
  /** 扫码路径的原图 fileId（裁剪产物上传成功后即删原图，best-effort） */
  phoneOriginalFileId?: string
}

export function IdPhotoPage() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [unavailableNote, setUnavailableNote] = useState<string | null>(null)
  const [spec, setSpec] = useState<IdPhotoSpec>(ID_PHOTO_SPECS[0]!)
  const [copies, setCopies] = useState(1)
  const [cropped, setCropped] = useState<CroppedState | null>(null)
  const [busy, setBusy] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showQr, setShowQr] = useState(false)
  const [qrBusy, setQrBusy] = useState(false)

  useBusyLock(busy || generating || qrBusy)

  // 能力开关 fail-closed（设计 §4.8）：配置为非 available → 诚实不可用态；
  // 未配置 → 放行进入（生产 strict 模式由服务端 layout 门禁兜底拒绝）。
  useEffect(() => {
    let cancelled = false
    void getConfiguredCapabilities().then((map) => {
      if (cancelled) return
      const conf = map['id_photo']
      if (!conf) {
        setAvailable(true)
        return
      }
      const ok = canCreateFormalPrintScanTask(conf.status)
      setAvailable(ok)
      if (!ok) setUnavailableNote(conf.note ?? '本终端证件照服务未开放')
    })
    return () => {
      cancelled = true
    }
  }, [])

  // 离开页面 best-effort 清理预览对象 URL
  useEffect(() => {
    return () => {
      if (cropped?.previewUrl) URL.revokeObjectURL(cropped.previewUrl)
    }
  }, [cropped?.previewUrl])

  const resetPhoto = () => {
    if (cropped?.previewUrl) URL.revokeObjectURL(cropped.previewUrl)
    setCropped(null)
  }

  /** 核心：源 Blob → 浏览器裁剪 → 上传裁剪产物（id_scan）。原图不上传（本机路径）。 */
  const cropAndUpload = async (source: Blob, phoneOriginalFileId?: string) => {
    setBusy(true)
    setError(null)
    try {
      const result = await cropToSpec(source, spec)
      if (!result.ok) {
        setError(
          result.reason === 'resolution_too_low'
            ? `照片分辨率不足（该规格需至少 ${spec.widthPx}×${spec.heightPx}px 的有效区域），打印会模糊，请更换更清晰的照片`
            : '照片无法识别，请更换 JPG / PNG 格式的照片',
        )
        return
      }
      const file = new File([result.blob], `id-photo-crop-${Date.now()}.jpg`, { type: 'image/jpeg' })
      const uploaded = await kioskUploadFile(file, 'id_scan', getToken())
      resetPhoto()
      setCropped({
        fileId: uploaded.fileId,
        fileAccessUrl: uploaded.signedUrl,
        previewUrl: URL.createObjectURL(result.blob),
        lowResolution: result.scaleRatio < 2,
        phoneOriginalFileId,
      })
      // 扫码路径：裁剪产物已入库，原图即刻删除（best-effort，1h TTL 兜底；设计 §二.6）
      if (phoneOriginalFileId) {
        void deleteIdPhotoFile(phoneOriginalFileId, { token: getToken() }).catch(() => undefined)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '照片处理失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  const handleLocalFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    e.target.value = ''
    if (!selected) return
    if (!['image/jpeg', 'image/png'].includes(selected.type)) {
      setError('仅支持 JPG / PNG 照片')
      return
    }
    await cropAndUpload(selected)
  }

  const handlePhoneUploaded = async (file: PhoneUploadedFile) => {
    setShowQr(false)
    if (!file.fileUrl) {
      setError('手机上传结果异常，请重试')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(resolveFileContentUrl(file.fileUrl))
      if (!res.ok) throw new Error('获取手机照片失败，请重新扫码上传')
      const blob = await res.blob()
      await cropAndUpload(blob, file.fileId)
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取手机照片失败')
      setBusy(false)
    }
  }

  const handleManualDelete = async () => {
    if (!cropped) return
    setBusy(true)
    try {
      await deleteIdPhotoFile(cropped.fileId, { token: getToken(), deleteToken: cropped.deleteToken })
      resetPhoto()
      setError(null)
    } catch {
      // 删除失败也清本地引用；服务端 1h TTL 兜底
      resetPhoto()
    } finally {
      setBusy(false)
    }
  }

  const handleGenerate = async () => {
    if (!cropped) return
    setGenerating(true)
    setError(null)
    try {
      const idempotencyKey = `idphoto-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      const result = await generateIdPhotoLayout(
        {
          source: { fileId: cropped.fileId, fileAccessUrl: cropped.fileAccessUrl },
          specId: spec.specId,
          terminalId: getTerminalId() || 'kiosk-dev',
        },
        { token: getToken(), idempotencyKey },
      )
      if (result.sourceDeleteToken) {
        setCropped((prev) => (prev ? { ...prev, deleteToken: result.sourceDeleteToken } : prev))
      }
      // 设计 §六：证件照专用参数契约在此定死（/print/confirm 只展示不编辑）；固定彩色，不提供黑白。
      navigate('/print/confirm', {
        state: {
          file: {
            name: `证件照-${spec.label}-整版${result.layoutCount}张.pdf`,
            size: formatBytes(result.sizeBytes),
            pages: result.pages,
            fileId: result.fileId,
            fileUrl: result.printFileUrl,
            fileMd5: result.fileMd5,
            mimeType: 'application/pdf',
          },
          params: makePrintParams({
            copies,
            color: 'color',
            scale: 'actual',
            duplex: 'single',
            orientation: 'portrait',
            paperSize: 'A4',
          }),
          source: 'document',
        },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败，请稍后重试')
    } finally {
      setGenerating(false)
    }
  }

  if (available === false) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-neutral-100">
          <UserSquareIcon className="h-10 w-10 text-neutral-400" />
        </div>
        <h1 className="mt-6 text-xl font-semibold text-neutral-900">证件照服务暂不可用</h1>
        <p className="mt-2 text-sm text-neutral-500">{unavailableNote}</p>
        <Button className="mt-8" size="lg" onClick={() => navigate('/print-scan')}>
          返回打印扫描服务
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col px-6 pt-6">
      <PageHeader
        title="证件照打印"
        subtitle="常见规格 A4 整版排版，彩色激光打印"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/print-scan')}>
            返回打印扫描服务
          </Button>
        }
      />

      <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto pb-28">
        {/* 设计 §九：隐私 + 能力 + 质量 + 规格四条诚实文案 */}
        <ComplianceBanner tone="success" title="隐私保护">
          证件照仅用于本次排版打印，最迟 1 小时内自动删除，不长期保存，不用于其他用途；本机选择的原始照片不会上传，仅裁剪结果用于生成打印文件。
        </ComplianceBanner>
        <ComplianceBanner tone="info">
          本服务不提供自动抠图/换底色，请上传纯色底（白/蓝/红）标准证件照片。彩色激光打印效果，适合临时应急使用，非照相馆冲印质量。各受理机构对照片可能有特殊要求，请以受理机构要求为准。
        </ComplianceBanner>

        <Card className="p-4">
          <p className="mb-3 text-sm font-medium text-neutral-700">1. 选择规格</p>
          <div className="grid grid-cols-2 gap-3">
            {ID_PHOTO_SPECS.map((s) => (
              <button
                key={s.specId}
                type="button"
                onClick={() => {
                  setSpec(s)
                  resetPhoto()
                }}
                className={[
                  'flex min-h-[64px] flex-col items-center justify-center rounded-xl border-2 px-3 py-2',
                  spec.specId === s.specId ? 'border-primary-500 bg-primary-50' : 'border-neutral-200 bg-white',
                ].join(' ')}
              >
                <span className="text-base font-semibold text-neutral-900">{s.label}</span>
                <span className="text-xs text-neutral-500">
                  {s.widthMm}×{s.heightMm}mm
                </span>
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          <p className="mb-3 text-sm font-medium text-neutral-700">2. 上传照片（{spec.label}）</p>
          {cropped ? (
            <div className="flex items-center gap-4">
              <img
                src={cropped.previewUrl}
                alt="裁剪预览"
                className="h-40 rounded-lg border border-neutral-200 object-contain"
                style={{ aspectRatio: `${spec.widthPx} / ${spec.heightPx}` }}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <p className="text-sm text-neutral-600">已按 {spec.label} 居中裁剪，请确认构图（人像应完整居中）。</p>
                {cropped.lowResolution && (
                  <p className="text-xs text-warning-fg">照片分辨率一般，打印可能不够清晰，建议更换更清晰的照片。</p>
                )}
                <Button size="lg" variant="secondary" disabled={busy} onClick={handleManualDelete}>
                  <TrashIcon className="mr-1.5 h-5 w-5" />
                  删除照片重新选择
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <input ref={inputRef} type="file" accept="image/jpeg,image/png" className="sr-only" onChange={handleLocalFile} />
              <Button size="lg" variant="secondary" disabled={busy} onClick={() => inputRef.current?.click()}>
                {busy ? <LoaderIcon className="mr-1.5 h-5 w-5 animate-spin" /> : <UploadIcon className="mr-1.5 h-5 w-5" />}
                本机上传照片
              </Button>
              <Button size="lg" variant="secondary" disabled={busy} onClick={() => setShowQr(true)}>
                <QrCodeIcon className="mr-1.5 h-5 w-5" />
                手机扫码上传
              </Button>
            </div>
          )}
        </Card>

        {showQr && !cropped && (
          <Card className="p-4">
            <UploadSessionQrPanel
              purpose="id_scan"
              title="手机扫码上传证件照"
              description="手机扫码上传一张纯色底标准证件照片，确认后一体机自动按所选规格裁剪。"
              confirmLabel="确认使用这张照片"
              onUploaded={(file) => void handlePhoneUploaded(file)}
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

        {cropped && (
          <Card className="p-4">
            <p className="mb-3 text-sm font-medium text-neutral-700">3. 打印份数（每份 A4 整版）</p>
            <div className="flex items-center gap-4">
              <Button size="lg" variant="secondary" disabled={copies <= 1} onClick={() => setCopies((c) => Math.max(1, c - 1))}>
                −
              </Button>
              <span className="min-w-[48px] text-center text-xl font-semibold">{copies}</span>
              <Button size="lg" variant="secondary" disabled={copies >= 9} onClick={() => setCopies((c) => Math.min(9, c + 1))}>
                ＋
              </Button>
            </div>
          </Card>
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-white via-white/95 to-transparent px-6 pb-6 pt-10">
        <Button size="lg" className="pointer-events-auto w-full" disabled={!cropped || busy || generating} onClick={() => void handleGenerate()}>
          {generating ? <LoaderIcon className="mr-1.5 h-5 w-5 animate-spin" /> : null}
          生成排版并去打印（彩色）
        </Button>
      </div>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
