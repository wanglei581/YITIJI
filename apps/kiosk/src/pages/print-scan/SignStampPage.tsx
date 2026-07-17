// apps/kiosk/src/pages/print-scan/SignStampPage.tsx
//
// 签名盖章（图形排版），/print-scan/sign。四步：选文档 → 传签名/印章图 →
// 选位置（页码网格 + 九宫格 + 大小档）→ 合成结果预览（iframe）。
// 入口：/print-scan 服务中心卡片；MyDocumentsPage「签名盖章」动作携
// location.state.presetDocument 直达（跳过选文档）。
// 合规：全程展示 KIOSK_PRINT_SCAN_ESIGN_NOTICE；生成前必须勾选图片使用授权。

import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@ai-job-print/ui'
import {
  COMPLIANCE_COPY,
  makePrintParams,
  type SignStampPosition,
  type SignStampSize,
} from '@ai-job-print/shared'
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  FileTextIcon,
  ImageIcon,
  InfoIcon,
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
    <div className="flex h-full flex-col bg-canvas px-6 py-5 text-neutral-900">
      <header className="flex h-[72px] shrink-0 items-center justify-between rounded-lg bg-dark px-6 text-surface shadow-sm">
        <div>
          <b className="block text-[21px] font-bold">就业服务大厅 · 01号机</b>
          <span className="mt-1 block text-sm text-neutral-100">AI求职打印服务终端</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-base text-neutral-100">2026年7月17日 10:24</span>
          <span className="inline-flex h-10 items-center gap-2 rounded-full bg-success-bg px-4 text-base font-semibold text-success-fg">
            <span className="h-2.5 w-2.5 rounded-full bg-current" />
            打印机正常 · A4纸充足
          </span>
        </div>
      </header>

      <div className="mt-5 flex shrink-0 items-center gap-5">
        <button type="button" onClick={() => navigate('/print-scan')} className="inline-flex h-14 items-center gap-2 rounded-md border border-neutral-200 bg-surface px-5 text-lg font-semibold text-neutral-700">
          <ArrowLeftIcon className="h-5 w-5" />
          返回打印扫描服务
        </button>
        <div>
          <h1 className="font-serif text-[42px] font-black leading-tight tracking-normal">签名盖章</h1>
          <p className="mt-1 text-xl text-neutral-500">在 PDF 上叠加签名 / 印章图片（版式合成）</p>
        </div>
      </div>

      <main className="mt-4 flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning-bg px-5 py-4 text-lg leading-relaxed text-warning-fg">
          <InfoIcon className="h-6 w-6 shrink-0" />
          {COMPLIANCE_COPY.KIOSK_PRINT_SCAN_ESIGN_NOTICE}
        </div>
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-error/30 bg-error-bg px-4 py-3 text-base text-error-fg">
            <AlertCircleIcon className="h-5 w-5 shrink-0" />
            {error}
          </div>
        )}

        <div className="flex min-h-0 flex-1 gap-5">
          <section className="flex min-w-0 flex-1 flex-col gap-4">
            <div className="rounded-lg border border-warning/30 bg-surface p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-warning-bg text-lg font-bold text-warning-fg">1</span>
                <b className="text-[21px] font-bold">选择 PDF 文档</b>
                {document && <span className="ml-auto rounded-full bg-success-bg px-3 py-1 text-sm font-semibold text-success-fg">已选择</span>}
              </div>
              {document ? (
                <div className="flex items-center gap-3 rounded-md border border-neutral-200 bg-canvas px-4 py-3">
                  <FileTextIcon className="h-7 w-7 shrink-0 text-warning-fg" />
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[19px] font-bold">{document.name}</b>
                    <span className="mt-0.5 block text-[15.5px] text-neutral-500">{document.size}{pages !== null ? ` · 共 ${pages} 页` : ''}</span>
                  </span>
                  <button type="button" disabled={busy} onClick={() => { setDocument(null); setPages(null); setStamp(null); setAuthorized(false); setError(null) }} className="h-12 rounded-md border border-neutral-200 bg-surface px-4 text-base font-semibold">
                    重新选择
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <input ref={docInputRef} type="file" accept="application/pdf" className="sr-only" onChange={(e) => void handleLocalDoc(e)} />
                  <Button size="lg" variant="secondary" className="h-14" disabled={busy} onClick={() => docInputRef.current?.click()}>
                    {busy ? <LoaderIcon className="mr-2 h-5 w-5 animate-spin" /> : <UploadIcon className="mr-2 h-5 w-5" />}
                    本机上传 PDF
                  </Button>
                  <Button size="lg" variant="secondary" className="h-14" disabled={busy} onClick={() => setShowQr('document')}>
                    <QrCodeIcon className="mr-2 h-5 w-5" />
                    手机扫码上传
                  </Button>
                </div>
              )}
              {showQr === 'document' && (
                <div className="mt-3">
                  <UploadSessionQrPanel purpose="print_doc" title="手机扫码上传 PDF 文档" description="手机扫码上传一份 PDF，确认后自动进入下一步。" confirmLabel="确认使用该文档" onUploaded={handlePhoneUploaded('document')} onBusyChange={setQrBusy} />
                </div>
              )}
            </div>

            <div className="rounded-lg border border-warning/30 bg-surface p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-warning-bg text-lg font-bold text-warning-fg">2</span>
                <b className="text-[21px] font-bold">签名画布 / 上传签名或印章图片</b>
                {stamp && <span className="ml-auto rounded-full bg-success-bg px-3 py-1 text-sm font-semibold text-success-fg">已上传</span>}
              </div>
              {stamp ? (
                <div className="flex items-center gap-3 rounded-md border border-neutral-200 bg-canvas px-4 py-3">
                  <StampIcon className="h-7 w-7 shrink-0 text-warning-fg" />
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[19px] font-bold">{stamp.name}</b>
                    <span className="mt-0.5 block text-[15.5px] text-neutral-500">{stamp.size}</span>
                  </span>
                  <button type="button" disabled={busy} onClick={() => { setStamp(null); setAuthorized(false); setError(null) }} className="h-12 rounded-md border border-neutral-200 bg-surface px-4 text-base font-semibold">
                    重新上传
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-[1fr_180px_180px] gap-3">
                  <div className="flex min-h-[88px] flex-col items-center justify-center rounded-md border-2 border-dashed border-warning/30 bg-warning-bg/50 px-4 text-center">
                    <span className="text-[18px] font-semibold text-warning-fg">签名画布预留区</span>
                    <span className="mt-1 text-sm leading-relaxed text-neutral-500">本批次请上传签名 / 印章图片；触屏手写将在校准后开放</span>
                  </div>
                  <input ref={stampInputRef} type="file" accept="image/jpeg,image/png" className="sr-only" onChange={(e) => void handleLocalStamp(e)} />
                  <Button size="lg" variant="secondary" className="h-full" disabled={busy || !document} onClick={() => stampInputRef.current?.click()}>
                    {busy ? <LoaderIcon className="mr-2 h-5 w-5 animate-spin" /> : <ImageIcon className="mr-2 h-5 w-5" />}
                    本机上传
                  </Button>
                  <Button size="lg" variant="secondary" className="h-full" disabled={busy || !document} onClick={() => setShowQr('stamp')}>
                    <QrCodeIcon className="mr-2 h-5 w-5" />
                    手机扫码
                  </Button>
                </div>
              )}
              {showQr === 'stamp' && (
                <div className="mt-3">
                  <UploadSessionQrPanel purpose="signature_image" title="手机扫码上传签名/印章图片" description="手机拍摄或选择签名/印章图片（JPG/PNG），确认后自动进入下一步。" confirmLabel="确认使用该图片" onUploaded={handlePhoneUploaded('stamp')} onBusyChange={setQrBusy} />
                </div>
              )}
            </div>

            <div className="flex min-h-0 flex-1 flex-col rounded-lg border border-warning/30 bg-surface p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-warning-bg text-lg font-bold text-warning-fg">3</span>
                <b className="text-[21px] font-bold">选择叠加位置</b>
              </div>
              <div className="mb-3 text-base text-neutral-500">页码（共 {pages ?? 1} 页，默认最后一页）</div>
              <div className="grid grid-cols-6 gap-2">
                {Array.from({ length: pages ?? 1 }, (_, i) => i + 1).map((p) => (
                  <button key={p} type="button" disabled={!document || !stamp || pages === null} onClick={() => setPage(p)} className={['h-[54px] rounded-md border-2 text-lg font-semibold disabled:opacity-40', p === page ? 'border-warning bg-warning-bg text-warning-fg' : 'border-neutral-200 bg-surface text-neutral-500'].join(' ')}>
                    {p}
                  </button>
                ))}
              </div>
              <div className="mt-4 flex flex-1 gap-5">
                <div>
                  <div className="mb-2 text-base text-neutral-500">位置（对应纸面方向）</div>
                  <div className="grid grid-cols-3 gap-2">
                    {POSITIONS.map((pos) => (
                      <button key={pos.key} type="button" disabled={!document || !stamp} onClick={() => setPosition(pos.key)} className={['h-[58px] w-[92px] rounded-md border-2 text-base font-semibold disabled:opacity-40', pos.key === position ? 'border-warning bg-warning-bg text-warning-fg' : 'border-neutral-200 bg-surface text-neutral-500'].join(' ')}>
                        {pos.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-2 text-base text-neutral-500">大小</div>
                  <div className="grid grid-cols-3 gap-2">
                    {SIZES.map((s) => (
                      <button key={s.key} type="button" disabled={!document || !stamp} onClick={() => setSize(s.key)} className={['h-[52px] rounded-md border-2 text-base font-semibold disabled:opacity-40', s.key === size ? 'border-warning bg-warning-bg text-warning-fg' : 'border-neutral-200 bg-surface text-neutral-500'].join(' ')}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-4 text-base leading-relaxed text-neutral-500">每次生成产生一份新文件，按短期策略自动清理；生成后可预览、去打印，或再加一处签名 / 印章。</p>
                </div>
              </div>
            </div>
          </section>

          <aside className="flex w-[400px] shrink-0 flex-col gap-4">
            <section className="rounded-lg border border-neutral-200 bg-surface p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-3">
                <b className="text-xl font-bold">{result ? '合成 PDF 预览' : '叠加效果示意'}</b>
                <span className="ml-auto rounded-full bg-neutral-50 px-3 py-1 text-sm font-semibold text-neutral-500">第 {page} 页 · {POSITIONS.find((p) => p.key === position)?.label} · {SIZES.find((s) => s.key === size)?.label}</span>
              </div>
              {result ? (
                <div className="h-[360px] overflow-hidden rounded-md border border-neutral-200 bg-neutral-50">
                  <iframe title={`${result.name} 预览`} src={result.printFileUrl} className="h-full w-full bg-white" />
                </div>
              ) : (
                <div className="relative mx-auto flex aspect-[210/297] w-[240px] flex-col gap-2 rounded-md border border-neutral-200 bg-white p-4 shadow-md">
                  <i className="h-3 w-1/2 rounded-full bg-neutral-800/70" />
                  <i className="h-1.5 w-4/5 rounded-full bg-neutral-200" />
                  <i className="h-1.5 w-3/5 rounded-full bg-neutral-200" />
                  <i className="h-1.5 w-4/5 rounded-full bg-neutral-200" />
                  <span className="absolute bottom-4 right-4 grid h-[58px] w-[58px] rotate-[-12deg] place-items-center rounded-full border-[3px] border-error/60 text-xs font-bold text-error/70">签名区</span>
                </div>
              )}
              <p className="mt-3 text-center text-[15.5px] text-neutral-500">{result ? `${result.name} · ${formatBytes(result.sizeBytes)} · 共 ${result.pages} 页` : '实际效果以生成后的 PDF 预览为准'}</p>
            </section>

            <section className="rounded-lg border border-warning/30 bg-surface p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-warning-bg text-lg font-bold text-warning-fg">4</span>
                <b className="text-[21px] font-bold">确认授权并生成</b>
              </div>
              <label className="flex min-h-12 cursor-pointer items-start gap-3">
                <input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} className="mt-1 h-6 w-6 shrink-0 accent-warning" />
                <span className="text-[17px] leading-relaxed text-neutral-700">{AUTHORIZATION_LABEL}</span>
              </label>
              <p className="mt-3 text-[15px] leading-relaxed text-neutral-500">伪造、变造印章或冒用他人签名属违法行为，责任由使用者自负。</p>
            </section>

            <section className="flex flex-1 flex-col rounded-lg border border-neutral-200 bg-surface p-5 shadow-sm">
              <b className="mb-3 block text-xl font-bold">生成后你可以</b>
              <div className="flex flex-1 flex-col gap-2.5">
                <button type="button" disabled={!result} onClick={goPrint} className="flex flex-1 items-center gap-3 rounded-lg border border-warning/30 bg-warning-bg px-4 text-left text-warning-fg disabled:opacity-45">
                  <PrinterIcon className="h-6 w-6" />
                  <span><b className="block text-lg font-bold">去打印</b><span className="text-sm text-neutral-500">预览合成 PDF 后进入确认打印</span></span>
                </button>
                <button type="button" disabled={!result} onClick={addAnother} className="flex flex-1 items-center gap-3 rounded-lg border border-neutral-200 bg-canvas px-4 text-left disabled:opacity-45">
                  <StampIcon className="h-6 w-6 text-warning-fg" />
                  <span><b className="block text-lg font-bold">再加一处签名 / 印章</b><span className="text-sm text-neutral-500">以合成结果为底继续叠加</span></span>
                </button>
                <button type="button" disabled={!result} onClick={redoPlacement} className="flex flex-1 items-center gap-3 rounded-lg border border-neutral-200 bg-canvas px-4 text-left disabled:opacity-45">
                  <RotateCcwIcon className="h-6 w-6 text-warning-fg" />
                  <span><b className="block text-lg font-bold">重新选位置</b><span className="text-sm text-neutral-500">不满意可回到本步重新生成</span></span>
                </button>
              </div>
            </section>
          </aside>
        </div>
      </main>

      <div className="mt-5 flex h-[76px] shrink-0 items-center gap-4 border-t border-neutral-200 bg-canvas pt-4">
        <Button variant="secondary" size="lg" className="h-14 px-7 text-lg" onClick={() => navigate('/print-scan')}>
          <ArrowLeftIcon className="mr-2 h-5 w-5" />
          返回
        </Button>
        <span className="flex-1" />
        {result ? (
          <Button size="lg" className="h-14 min-w-[460px] text-lg" onClick={goPrint}>
            <PrinterIcon className="mr-2 h-5 w-5" />
            去打印
          </Button>
        ) : (
          <Button size="lg" className="h-14 min-w-[460px] text-lg" disabled={busy || !document || !stamp || pages === null || !authorized} onClick={() => void handleCompose()}>
            {busy ? <LoaderIcon className="mr-2 h-5 w-5 animate-spin" /> : <PenToolIcon className="mr-2 h-5 w-5" />}
            {busy ? '正在生成…' : authorized ? '生成合成 PDF' : '生成合成 PDF（请先确认授权）'}
          </Button>
        )}
      </div>
    </div>
  )
}
