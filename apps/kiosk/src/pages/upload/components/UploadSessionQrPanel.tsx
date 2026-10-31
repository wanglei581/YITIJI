import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { CheckCircleIcon, Loader2Icon, RefreshCwIcon, SmartphoneIcon, XCircleIcon } from 'lucide-react'
import type { FilePurpose, UploadSessionStatusResponse } from '@ai-job-print/shared'
import { Button, Card } from '@ai-job-print/ui'
import { useAuth } from '../../../auth/useAuth'
import { notYourFileHint, phoneUploadScanHint, uploadedFileSourceLine } from '../../../copy/miniappLinkCopy'
import { useSupportContact } from '../../../hooks/useSupportContact'
import { getTerminalId } from '../../../services/api/screensaver'
import {
  buildPhoneUploadQrUrl,
  cancelUploadSession,
  confirmUploadSession,
  createUploadSession,
  getUploadSessionStatus,
  uploadSessionUserMessage,
} from '../../../services/api/uploadSessions'

export interface PhoneUploadedFile {
  name: string
  size: string
  format: string
  fileId: string
  channel: 'phone'
  mimeType?: string
  sha256?: string
  /** resume_upload / print_doc / signature_image 确认后携带的短时签名内容 URL。 */
  fileUrl?: string
}

interface UploadSessionQrPanelProps {
  /** 会话用途,决定后端存储与保留策略;默认沿用既有简历上传行为。 */
  purpose?: FilePurpose
  title?: string
  description?: string
  confirmLabel?: string
  onUploaded: (file: PhoneUploadedFile) => void
  onBusyChange?: (busy: boolean) => void
  /** 可选。用户点「取消」、本次二维码已作废之后通知页面；页面可以换成自己的「已取消」说明。默认不传，行为不变。 */
  onCancelled?: () => void
  /** 可选。手机端传上来、等一体机确认的那份文件（没有就是 null）。页面想自己画文件卡时用。默认不传，行为不变。 */
  onReceivedChange?: (file: { filename: string; sizeBytes: number; mimeType: string } | null) => void
  /**
   * 可选。页面想把「确认」放到自己的底栏时用：有可确认的文件、且不在确认中时，面板交出一个稳定的确认函数，
   * 其余时候（没有文件、确认进行中、卸载）交 null。页面把它放进 state，底栏就会随确认进行与否重绘，
   * 不会拿着确认前的旧函数再点一遍。默认不传，行为不变。
   */
  onConfirmReady?: (confirm: (() => void) | null) => void
  /**
   * session：二维码还在（含等人扫）即报忙。
   * received：没收到文件不算忙；手机已传上或正在确认才报忙。
   */
  busyWhen?: 'session' | 'received'
}

interface QrState {
  sessionId: string
  uploadToken: string
  controlToken: string
  qrUrl: string
  expiresAt: string
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function inferFormat(mimeOrName: string): string {
  const m = mimeOrName.toLowerCase()
  if (m.includes('pdf')) return 'pdf'
  if (m.includes('word') || m.includes('doc')) return 'word'
  if (m.includes('png')) return 'png'
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg'
  if (m.includes('webp')) return 'webp'
  return 'unknown'
}

function apiErrorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    return typeof code === 'string' ? code : null
  }
  return null
}

/**
 * 服务端已经无法再用这些会话接收文件，因此「旧码已失效」这个前提已经成立：
 * 记录不在（NOT_FOUND）、已过期（EXPIRED）、已确认消费（CONFIRMED）。
 * 其余失败（网络故障、控制令牌无效）不能证明旧码已死，必须阻止签发新码。
 */
const ALREADY_REVOKED_CODES: ReadonlySet<string> = new Set([
  'UPLOAD_SESSION_NOT_FOUND',
  'UPLOAD_SESSION_EXPIRED',
  'UPLOAD_SESSION_CONFIRMED',
])

/**
 * 旧二维码必须先在服务端失效，新码才允许签发 —— 否则旁人拍到的旧码仍能往会话里传文件。
 * 只有在无法证明旧码已失效时才向外抛错，由 refresh 阻止签发新码。
 */
async function revokePreviousSession(existing: QrState): Promise<void> {
  try {
    await cancelUploadSession(existing.sessionId, existing.controlToken)
  } catch (err) {
    const code = apiErrorCode(err)
    if (code && ALREADY_REVOKED_CODES.has(code)) return
    throw err
  }
}

function expiredStatus(qr: QrState, current: UploadSessionStatusResponse | null, purpose: FilePurpose): UploadSessionStatusResponse {
  return {
    sessionId: qr.sessionId,
    status: 'expired',
    purpose: current?.purpose ?? purpose,
    mode: current?.mode ?? 'temporary',
    file: current?.file ?? null,
    requiresKioskConfirmation: current?.requiresKioskConfirmation ?? false,
    expiresAt: qr.expiresAt,
  }
}

export function UploadSessionQrPanel({
  purpose = 'resume_upload',
  title = '手机扫码上传',
  description = '手机只负责上传文件；一体机上确认后才进入 AI 诊断或优化流程。',
  confirmLabel = '确认使用这份简历',
  onUploaded,
  onBusyChange,
  onCancelled,
  onReceivedChange,
  onConfirmReady,
  busyWhen = 'session',
}: UploadSessionQrPanelProps) {
  const { getToken, isLoggedIn } = useAuth()
  const supportContact = useSupportContact()
  const pollFailuresRef = useRef(0)
  const qrRef = useRef<QrState | null>(null)
  const statusRef = useRef<UploadSessionStatusResponse | null>(null)
  // 确认的在途标记：交给页面的确认函数可能是旧一帧的闭包，闭包里的 confirming 不可靠，所以另留一个不随渲染变的标记。
  const confirmingRef = useRef(false)
  const handleConfirmRef = useRef<() => Promise<void>>(async () => undefined)
  const confirmNow = useCallback(() => { void handleConfirmRef.current() }, [])
  const [qr, setQr] = useState<QrState | null>(null)
  const [status, setStatus] = useState<UploadSessionStatusResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const active = Boolean(qr && status?.status !== 'confirmed' && status?.status !== 'cancelled' && status?.status !== 'expired')

  useEffect(() => {
    const received = status?.status === 'uploaded' || confirming
    onBusyChange?.(busyWhen === 'received' ? received : active || loading || confirming)
  }, [active, busyWhen, confirming, loading, onBusyChange, status?.status])

  // 确认后父页面会卸掉本面板。上面的 effect 只在依赖变化时上报，卸载时不会再跑，忙碌会一直留在父页面。
  useEffect(() => {
    return () => {
      onBusyChange?.(false)
    }
  }, [onBusyChange])

  const receivedFile = status?.status === 'uploaded' ? status.file : null
  useEffect(() => {
    onReceivedChange?.(receivedFile ? { filename: receivedFile.filename, sizeBytes: receivedFile.sizeBytes, mimeType: receivedFile.mimeType } : null)
  }, [onReceivedChange, receivedFile])

  useEffect(() => {
    qrRef.current = qr
  }, [qr])

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    if (!qr || status?.status === 'uploaded' || status?.status === 'confirmed' || status?.status === 'cancelled' || status?.status === 'expired') {
      return undefined
    }
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [qr, status?.status])

  useEffect(() => {
    if (!qr || !status || status.status === 'uploaded' || status.status === 'confirmed' || status.status === 'cancelled' || status.status === 'expired') {
      return
    }
    if (new Date(qr.expiresAt).getTime() <= now) {
      setStatus((current) => expiredStatus(qr, current, purpose))
    }
  }, [now, purpose, qr, status])

  const expiresLabel = useMemo(() => {
    if (!qr) return ''
    const seconds = Math.max(0, Math.round((new Date(qr.expiresAt).getTime() - now) / 1000))
    const minutes = Math.floor(seconds / 60)
    const remain = seconds % 60
    return `${minutes}:${String(remain).padStart(2, '0')}`
  }, [now, qr])

  const refresh = useCallback(async () => {
    pollFailuresRef.current = 0
    setLoading(true)
    setError(null)
    try {
      const existing = qrRef.current
      if (statusRef.current?.status === 'uploaded') {
        setError('手机端已上传文件，请先在一体机确认，或取消本次上传后重新开始。')
        return
      }
      if (existing) {
        // 新码只有在旧码已被服务端撤销（或已确认失效）时才生成，避免旁人手里的旧码继续可用。
        await revokePreviousSession(existing)
        setQr(null)
        setStatus(null)
      }
      const token = getToken()
      const memberMode = Boolean(token && isLoggedIn)
      let effectiveMemberMode = memberMode
      const created = await createUploadSession({
        purpose,
        mode: memberMode ? 'member' : 'temporary',
        channel: 'phone_h5',
        terminalId: getTerminalId() || null,
      }, token).catch(async (err) => {
        if (!memberMode || apiErrorCode(err) !== 'MEMBER_AUTH_REQUIRED') throw err
        effectiveMemberMode = false
        const fallback = await createUploadSession({
          purpose,
          mode: 'temporary',
          channel: 'phone_h5',
          terminalId: getTerminalId() || null,
        })
        setError('会员登录已过期，已切换为临时上传；本次文件仅用于当前操作，不会自动归档到会员账号。')
        return fallback
      })
      setQr({
        sessionId: created.sessionId,
        uploadToken: created.uploadToken,
        controlToken: created.controlToken,
        qrUrl: buildPhoneUploadQrUrl(created, purpose),
        expiresAt: created.expiresAt,
      })
      setStatus({
        sessionId: created.sessionId,
        status: 'pending',
        purpose,
        mode: effectiveMemberMode ? 'member' : 'temporary',
        file: null,
        requiresKioskConfirmation: effectiveMemberMode,
        expiresAt: created.expiresAt,
      })
    } catch (err) {
      setError(uploadSessionUserMessage(err, '二维码生成失败，请稍后重试。'))
    } finally {
      setLoading(false)
    }
  }, [getToken, isLoggedIn, purpose])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!qr || status?.status === 'uploaded' || status?.status === 'confirmed' || status?.status === 'cancelled' || status?.status === 'expired') {
      return undefined
    }
    const timer = window.setInterval(() => {
      getUploadSessionStatus(qr.sessionId, qr.controlToken)
        .then((next) => {
          pollFailuresRef.current = 0
          setStatus(next)
        })
        .catch((err) => {
          pollFailuresRef.current += 1
          const code = apiErrorCode(err)
          if (code === 'UPLOAD_SESSION_NOT_FOUND' || code === 'UPLOAD_SESSION_EXPIRED' || pollFailuresRef.current >= 3) {
            setStatus((current) => expiredStatus(qr, current, purpose))
            setError(code === 'UPLOAD_SESSION_NOT_FOUND' || code === 'UPLOAD_SESSION_EXPIRED'
              ? '二维码已过期，请刷新后重新上传。'
              : '二维码状态获取失败，请刷新二维码重试。')
            return
          }
          setError(uploadSessionUserMessage(err, '二维码状态获取失败，请稍后重试。'))
        })
    }, 2000)
    return () => window.clearInterval(timer)
  }, [qr, status?.status, purpose])

  const handleConfirm = async () => {
    if (!status?.file || !qr || confirming || confirmingRef.current) return
    confirmingRef.current = true
    setConfirming(true)
    setError(null)
    try {
      const result = await confirmUploadSession(qr.sessionId, qr.controlToken, getToken())
      const file = result.file
      onUploaded({
        name: file.filename,
        size: formatSize(file.sizeBytes),
        format: inferFormat(file.mimeType || file.filename),
        fileId: file.fileId,
        channel: 'phone',
        mimeType: file.mimeType,
        sha256: file.sha256,
        fileUrl: file.fileUrl ?? undefined,
      })
      setStatus({ ...status, status: 'confirmed', file })
    } catch (err) {
      setError(uploadSessionUserMessage(err, '确认失败，请刷新二维码重试。'))
    } finally {
      confirmingRef.current = false
      setConfirming(false)
    }
  }

  const handleCancel = async () => {
    if (!qr) return
    try {
      await cancelUploadSession(qr.sessionId, qr.controlToken)
    } catch {
      // best-effort only
    } finally {
      setQr(null)
      setStatus(null)
      setError(null)
      onCancelled?.()
    }
  }

  const uploadedFile = status?.status === 'uploaded' ? status.file : null
  const uploaded = Boolean(uploadedFile)
  const expired = status?.status === 'expired'
  // 小程序已发布时，码旁说明讲清「微信扫进小程序、别的扫法打开网页」；空串（未发布或读不到联系方式）就保持原句。
  const scanHint = phoneUploadScanHint(supportContact)
  // 手机传来文件后，文件名下面那一行来源（读不到来源就不写）和「不是你传的就取消」的提醒：旁人拍到屏上的码也可能抢在本人之前传，
  // 现场没有人，只能靠本人认出来、点取消。句子都来自 copy/miniappLinkCopy.ts，这里不手写。
  const sourceLine = uploadedFileSourceLine(uploadedFile?.source)
  // 最新的确认函数放进 ref（在 effect 里写，不在渲染期写）；交给页面的 confirmNow 稳定不变，点下去读到的总是最新的那个。
  useEffect(() => {
    handleConfirmRef.current = handleConfirm
  })
  useEffect(() => {
    onConfirmReady?.(uploaded && !confirming ? confirmNow : null)
  }, [confirmNow, confirming, onConfirmReady, uploaded])
  // 卸载时再交一次 null：确认成功后本面板被卸掉，页面不该还留着一个已经没用的确认函数。
  useEffect(() => {
    return () => {
      onConfirmReady?.(null)
    }
  }, [onConfirmReady])

  return (
    <Card className="p-5">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-50 text-primary-600">
          <SmartphoneIcon className="h-6 w-6" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold text-neutral-900">{title}</h2>
            {status?.mode === 'member' && purpose !== 'signature_image' && <span className="rounded-full bg-success-bg px-2.5 py-1 text-xs font-bold text-success-fg">会员文件确认后归档</span>}
          </div>
          <p className="mt-1 text-sm leading-relaxed text-neutral-600">
            {description}
          </p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-[180px_1fr]">
        <div className="flex min-h-[180px] items-center justify-center rounded-2xl border border-neutral-200 bg-white">
          {qr && !loading ? (
            <QRCodeSVG value={qr.qrUrl} size={150} level="M" marginSize={1} />
          ) : (
            <Loader2Icon className="h-8 w-8 animate-spin text-primary-500" aria-hidden="true" />
          )}
        </div>

        <div className="flex min-w-0 flex-col justify-between rounded-2xl bg-neutral-50 p-4">
          <div>
            <p className="text-sm font-bold text-neutral-900">
              {uploaded ? '手机端已上传文件' : expired ? '二维码已过期' : (scanHint || '请用手机微信或浏览器扫码')}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-neutral-600">
              {uploaded
                ? `${uploadedFile?.filename ?? '已上传文件'} · ${formatSize(uploadedFile?.sizeBytes ?? 0)}`
                : expired
                  ? '请刷新二维码后重新上传，旧二维码不再接收文件。'
                  : `二维码有效期 ${expiresLabel || '10:00'}，文件最大 10MB。`}
            </p>
            {uploaded && sourceLine ? <p className="mt-1 text-sm leading-relaxed text-neutral-600">{sourceLine}</p> : null}
            {uploaded ? <p className="mt-1 text-sm font-semibold leading-relaxed text-neutral-700">{notYourFileHint()}</p> : null}
            {error && (
              <div className="mt-3 flex items-start gap-2 rounded-xl bg-error-bg px-3 py-2 text-sm font-semibold text-error-fg">
                <XCircleIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}
            {uploaded && (
              <div className="mt-3 flex items-center gap-2 rounded-xl bg-success-bg px-3 py-2 text-sm font-semibold text-success-fg">
                <CheckCircleIcon className="h-4 w-4" aria-hidden="true" />
                回到一体机确认后继续
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={loading || confirming || uploaded} onClick={refresh}>
              <RefreshCwIcon className="mr-1 h-4 w-4" aria-hidden="true" />
              刷新二维码
            </Button>
            {qr && (
              <Button size="sm" variant="secondary" disabled={confirming} onClick={handleCancel}>
                取消
              </Button>
            )}
            <Button size="sm" disabled={!uploaded || confirming} onClick={handleConfirm}>
              {confirming ? '确认中...' : confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}
