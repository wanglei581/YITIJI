// apps/kiosk/src/pages/print-scan/SignStampPage.tsx
//
// 签名盖章（图形排版），/print-scan/sign。四步：选文档 → 传签名/印章图 →
// 选位置（页码网格 + 九宫格 + 大小档）→ 合成结果预览（iframe）。
// 入口：/print-scan 服务中心卡片；MyDocumentsPage「签名盖章」动作携
// location.state.presetDocument 直达（跳过选文档）。
// 合规：全程展示 KIOSK_PRINT_SCAN_ESIGN_NOTICE；生成前必须勾选图片使用授权。

import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Card, ComplianceBanner, PageHeader } from '@ai-job-print/ui'
import {
  COMPLIANCE_COPY,
  makePrintParams,
  type SignStampPosition,
  type SignStampSize,
} from '@ai-job-print/shared'
import {
  AlertCircleIcon,
  FileTextIcon,
  ImageIcon,
  LoaderIcon,
  PenToolIcon,
  PrinterIcon,
  QrCodeIcon,
  RotateCcwIcon,
  StampIcon,
  UploadIcon,
} from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { kioskUploadFile } from '../../services/api/files'
import { getTerminalId } from '../../services/api/screensaver'
import { signCompose, signInspect } from '../../services/api/printSign'
import { UploadSessionQrPanel, type PhoneUploadedFile } from '../upload/components/UploadSessionQrPanel'

const MAX_DOC_BYTES = 15 * 1024 * 1024
const MAX_STAMP_BYTES = 10 * 1024 * 1024

/** 授权勾选文案；改动必须同步后端 AUTHORIZATION_NOTICE_VERSION（print-sign.service.ts） */
const AUTHORIZATION_LABEL = '我确认本人拥有该签名/印章图片的使用授权，仅用于本人材料的版式整理'

interface PickedFile {
  fileId: string
  fileAccessUrl: string
  name: string
  size: string
}

interface ComposeResult {
  fileId: string
  printFileUrl: string
  fileMd5: string
  sizeBytes: number
  pages: number
  name: string
}

interface PresetDocumentState {
  presetDocument?: { fileId: string; fileAccessUrl: string; name: string; sizeBytes: number }
}

const POSITIONS: { key: SignStampPosition; label: string }[] = [
  { key: 'top-left', label: '左上' }, { key: 'top-center', label: '上' }, { key: 'top-right', label: '右上' },
  { key: 'middle-left', label: '左' }, { key: 'center', label: '中' }, { key: 'middle-right', label: '右' },
  { key: 'bottom-left', label: '左下' }, { key: 'bottom-center', label: '下' }, { key: 'bottom-right', label: '右下' },
]

const SIZES: { key: SignStampSize; label: string }[] = [
  { key: 'small', label: '小' }, { key: 'medium', label: '中' }, { key: 'large', label: '大' },
]

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function friendlyError(err: unknown, fallback: string, loggedIn: boolean): string {
  const code = (err as { code?: string })?.code
  if (code === 'SIGN_SOURCE_NOT_FOUND') {
    return loggedIn
      ? '文件访问凭证已过期或文件已清理，请重新选择文件'
      : '文件访问凭证已过期（有效期约 30 分钟），请重新上传'
  }
  return err instanceof Error ? err.message : fallback
}

export function SignStampPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const docInputRef = useRef<HTMLInputElement>(null)
  const stampInputRef = useRef<HTMLInputElement>(null)

  const [document, setDocument] = useState<PickedFile | null>(null)
  const [pages, setPages] = useState<number | null>(null)
  const [stamp, setStamp] = useState<PickedFile | null>(null)
  const [page, setPage] = useState(1)
  const [position, setPosition] = useState<SignStampPosition>('bottom-right')
  const [size, setSize] = useState<SignStampSize>('medium')
  const [authorized, setAuthorized] = useState(false)
  const [result, setResult] = useState<ComposeResult | null>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showQr, setShowQr] = useState<'document' | 'stamp' | null>(null)
  const [qrBusy, setQrBusy] = useState(false)

  useBusyLock(busy || qrBusy || showQr !== null)

  // 我的文档入口：presetDocument 直达（只消费一次）
  useEffect(() => {
    const preset = (location.state as PresetDocumentState | null)?.presetDocument
    if (preset && !document) {
      void acceptDocument({
        fileId: preset.fileId,
        fileAccessUrl: preset.fileAccessUrl,
        name: preset.name,
        size: formatBytes(preset.sizeBytes),
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const acceptDocument = async (picked: PickedFile) => {
    const terminalId = getTerminalId()
    if (!terminalId) {
      setError('终端编号未配置，无法使用签名盖章')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await signInspect(
        { terminalId, document: { fileId: picked.fileId, fileAccessUrl: picked.fileAccessUrl } },
        { token: getToken() },
      )
      setDocument(picked)
      setPages(res.pages)
      setPage(res.pages) // 默认最后一页（签名通常在末页）
      setResult(null)
    } catch (err) {
      setError(friendlyError(err, '文档检查失败，请重试', Boolean(getToken())))
    } finally {
      setBusy(false)
    }
  }

  const handleLocalDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    e.target.value = ''
    if (!selected) return
    if (selected.type !== 'application/pdf') {
      setError('仅支持 PDF 文档；图片请先用「格式转换」转成 PDF')
      return
    }
    if (selected.size > MAX_DOC_BYTES) {
      setError(`文档大小不能超过 ${formatBytes(MAX_DOC_BYTES)}`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await kioskUploadFile(selected, 'print_doc', getToken())
      await acceptDocument({ fileId: res.fileId, fileAccessUrl: res.signedUrl, name: res.filename, size: formatBytes(res.sizeBytes) })
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  const handleLocalStamp = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    e.target.value = ''
    if (!selected) return
    if (!['image/jpeg', 'image/png'].includes(selected.type)) {
      setError('签名/印章图片仅支持 JPG / PNG')
      return
    }
    if (selected.size > MAX_STAMP_BYTES) {
      setError(`图片大小不能超过 ${formatBytes(MAX_STAMP_BYTES)}`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await kioskUploadFile(selected, 'signature_image', getToken())
      setStamp({ fileId: res.fileId, fileAccessUrl: res.signedUrl, name: res.filename, size: formatBytes(res.sizeBytes) })
      setResult(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  const handlePhoneUploaded = (target: 'document' | 'stamp') => (file: PhoneUploadedFile) => {
    if (!file.fileUrl) {
      setError('手机上传未返回可用的文件地址，请重试')
      return
    }
    const picked: PickedFile = { fileId: file.fileId, fileAccessUrl: file.fileUrl, name: file.name, size: file.size }
    setShowQr(null)
    if (target === 'document') {
      void acceptDocument(picked)
    } else {
      setStamp(picked)
      setResult(null)
    }
  }

  const handleCompose = async () => {
    if (!document || !stamp || pages === null) return
    const terminalId = getTerminalId()
    if (!terminalId) {
      setError('终端编号未配置，无法使用签名盖章')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const idempotencyKey = `sign-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
      const res = await signCompose(
        {
          terminalId,
          document: { fileId: document.fileId, fileAccessUrl: document.fileAccessUrl },
          stamp: { fileId: stamp.fileId, fileAccessUrl: stamp.fileAccessUrl },
          placement: { page, position, size },
          authorizationConfirmed: true,
        },
        { token: getToken(), idempotencyKey },
      )
      setResult({ ...res, name: `${document.name.replace(/\.pdf$/i, '')}-签章合成.pdf` })
    } catch (err) {
      setError(friendlyError(err, '生成失败，请稍后重试', Boolean(getToken())))
    } finally {
      setBusy(false)
    }
  }

  const goPrint = () => {
    if (!result) return
    navigate('/print/confirm', {
      state: {
        file: {
          name: result.name,
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
  }

  const addAnother = () => {
    if (!result) return
    // 合成产物作为下一轮输入文档；printFileUrl 与上传凭证同构（设计 §2.6）
    setDocument({ fileId: result.fileId, fileAccessUrl: result.printFileUrl, name: result.name, size: formatBytes(result.sizeBytes) })
    setPages(result.pages)
    setPage(result.pages)
    setStamp(null)
    setAuthorized(false)
    setResult(null)
  }

  const redoPlacement = () => {
    setResult(null) // 保留 document/stamp，回选位；下次生成自动换新 Idempotency-Key
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-6 pt-6 pb-8">
      <PageHeader
        title="签名盖章"
        subtitle="在 PDF 上叠加签名/印章图片（版式合成）"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/print-scan')}>
            返回打印扫描服务
          </Button>
        }
      />

      <div className="mt-4">
        <ComplianceBanner tone="info">{COMPLIANCE_COPY.KIOSK_PRINT_SCAN_ESIGN_NOTICE}</ComplianceBanner>
      </div>

      {error && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-error/30 bg-error-bg px-3 py-2 text-sm text-error-fg">
          <AlertCircleIcon className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {result === null ? (
        <div className="mt-4 flex flex-col gap-4">
          {/* 第 1 步：文档 */}
          <Card className="p-4">
            <p className="mb-3 text-sm font-medium text-neutral-700">第 1 步 · 选择 PDF 文档</p>
            {document ? (
              <div className="flex items-center gap-3 rounded-xl border border-neutral-100 px-3 py-2.5">
                <FileTextIcon className="h-6 w-6 shrink-0 text-primary-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-neutral-900">{document.name}</p>
                  <p className="text-xs text-neutral-400">{document.size}{pages !== null ? ` · 共 ${pages} 页` : ''}</p>
                </div>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setDocument(null); setPages(null); setStamp(null); setAuthorized(false); setError(null) }}>
                  重新选择
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <input ref={docInputRef} type="file" accept="application/pdf" className="sr-only" onChange={(e) => void handleLocalDoc(e)} />
                <Button size="lg" variant="secondary" disabled={busy} onClick={() => docInputRef.current?.click()}>
                  {busy ? <LoaderIcon className="mr-1.5 h-5 w-5 animate-spin" /> : <UploadIcon className="mr-1.5 h-5 w-5" />}
                  本机上传 PDF
                </Button>
                <Button size="lg" variant="secondary" disabled={busy} onClick={() => setShowQr('document')}>
                  <QrCodeIcon className="mr-1.5 h-5 w-5" />
                  手机扫码上传
                </Button>
              </div>
            )}
            {showQr === 'document' && (
              <div className="mt-3">
                <UploadSessionQrPanel
                  purpose="print_doc"
                  title="手机扫码上传 PDF 文档"
                  description="手机扫码上传一份 PDF，确认后自动进入下一步。"
                  confirmLabel="确认使用该文档"
                  onUploaded={handlePhoneUploaded('document')}
                  onBusyChange={setQrBusy}
                />
              </div>
            )}
          </Card>

          {/* 第 2 步：签名/印章图片 */}
          {document && (
            <Card className="p-4">
              <p className="mb-1 text-sm font-medium text-neutral-700">第 2 步 · 上传签名或印章图片</p>
              <p className="mb-3 text-xs text-neutral-400">建议上传白底或透明底 PNG；若图片方向不对，请在手机上旋转后重新上传。</p>
              {stamp ? (
                <div className="flex items-center gap-3 rounded-xl border border-neutral-100 px-3 py-2.5">
                  <StampIcon className="h-6 w-6 shrink-0 text-primary-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-900">{stamp.name}</p>
                    <p className="text-xs text-neutral-400">{stamp.size}</p>
                  </div>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => { setStamp(null); setAuthorized(false); setError(null) }}>
                    重新上传
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <input ref={stampInputRef} type="file" accept="image/jpeg,image/png" className="sr-only" onChange={(e) => void handleLocalStamp(e)} />
                  <Button size="lg" variant="secondary" disabled={busy} onClick={() => stampInputRef.current?.click()}>
                    {busy ? <LoaderIcon className="mr-1.5 h-5 w-5 animate-spin" /> : <ImageIcon className="mr-1.5 h-5 w-5" />}
                    本机上传图片
                  </Button>
                  <Button size="lg" variant="secondary" disabled={busy} onClick={() => setShowQr('stamp')}>
                    <QrCodeIcon className="mr-1.5 h-5 w-5" />
                    手机扫码上传
                  </Button>
                </div>
              )}
              {showQr === 'stamp' && (
                <div className="mt-3">
                  <UploadSessionQrPanel
                    purpose="signature_image"
                    title="手机扫码上传签名/印章图片"
                    description="手机拍摄或选择签名/印章图片（JPG/PNG），确认后自动进入下一步。"
                    confirmLabel="确认使用该图片"
                    onUploaded={handlePhoneUploaded('stamp')}
                    onBusyChange={setQrBusy}
                  />
                </div>
              )}
            </Card>
          )}

          {/* 第 3 步：位置 */}
          {document && stamp && pages !== null && (
            <Card className="p-4">
              <p className="mb-3 text-sm font-medium text-neutral-700">第 3 步 · 选择叠加位置</p>

              <p className="mb-2 text-xs text-neutral-500">页码（共 {pages} 页）</p>
              <div className="mb-4 grid grid-cols-6 gap-2">
                {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPage(p)}
                    className={[
                      'flex h-12 items-center justify-center rounded-lg border text-sm font-medium',
                      p === page ? 'border-primary-500 bg-primary-50 text-primary-600' : 'border-neutral-200 text-neutral-600',
                    ].join(' ')}
                  >
                    {p}
                  </button>
                ))}
              </div>

              <p className="mb-2 text-xs text-neutral-500">位置（对应纸面方向）</p>
              <div className="mx-auto mb-4 grid w-full max-w-xs grid-cols-3 gap-2">
                {POSITIONS.map((pos) => (
                  <button
                    key={pos.key}
                    type="button"
                    onClick={() => setPosition(pos.key)}
                    className={[
                      'flex h-14 items-center justify-center rounded-lg border text-sm font-medium',
                      pos.key === position ? 'border-primary-500 bg-primary-50 text-primary-600' : 'border-neutral-200 text-neutral-600',
                    ].join(' ')}
                  >
                    {pos.label}
                  </button>
                ))}
              </div>

              <p className="mb-2 text-xs text-neutral-500">大小</p>
              <div className="grid grid-cols-3 gap-2">
                {SIZES.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setSize(s.key)}
                    className={[
                      'flex h-12 items-center justify-center rounded-lg border text-sm font-medium',
                      s.key === size ? 'border-primary-500 bg-primary-50 text-primary-600' : 'border-neutral-200 text-neutral-600',
                    ].join(' ')}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </Card>
          )}

          {/* 授权确认 + 生成 */}
          {document && stamp && pages !== null && (
            <Card className="p-4">
              <label className="flex min-h-12 cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={authorized}
                  onChange={(e) => setAuthorized(e.target.checked)}
                  className="mt-1 h-6 w-6 shrink-0 accent-primary-500"
                />
                <span className="text-sm leading-relaxed text-neutral-700">{AUTHORIZATION_LABEL}</span>
              </label>
              <p className="mt-2 text-xs leading-relaxed text-neutral-400">
                伪造、变造印章或冒用他人签名属违法行为，责任由使用者自负。本功能仅做图片版式合成，每次生成会产生一份新文件，按短期策略自动清理。
              </p>
              <Button size="lg" className="mt-4 h-14 w-full text-base" disabled={busy || !authorized} onClick={() => void handleCompose()}>
                {busy ? (
                  <>
                    <LoaderIcon className="mr-2 h-5 w-5 animate-spin" />
                    正在生成…
                  </>
                ) : (
                  <>
                    <PenToolIcon className="mr-1.5 h-5 w-5" />
                    生成合成 PDF
                  </>
                )}
              </Button>
            </Card>
          )}
        </div>
      ) : (
        /* 第 4 步：结果预览 */
        <div className="mt-4 flex flex-col gap-4">
          <Card className="p-4">
            <p className="mb-3 text-sm font-medium text-neutral-700">合成完成 · 预览</p>
            <div className="h-[480px] overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50">
              <iframe title={`${result.name} 预览`} src={result.printFileUrl} className="h-full w-full bg-white" />
            </div>
            <p className="mt-2 text-xs text-neutral-400">
              {result.name} · {formatBytes(result.sizeBytes)} · 共 {result.pages} 页
            </p>
          </Card>
          <Button size="lg" className="h-14 w-full text-base" onClick={goPrint}>
            <PrinterIcon className="mr-1.5 h-5 w-5" />
            去打印
          </Button>
          <div className="grid grid-cols-2 gap-3">
            <Button size="lg" variant="secondary" onClick={addAnother}>
              <StampIcon className="mr-1.5 h-5 w-5" />
              再加一处签名/印章
            </Button>
            <Button size="lg" variant="secondary" onClick={redoPlacement}>
              <RotateCcwIcon className="mr-1.5 h-5 w-5" />
              重新选位置
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
