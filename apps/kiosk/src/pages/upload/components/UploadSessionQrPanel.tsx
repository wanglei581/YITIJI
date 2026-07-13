import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { CheckCircleIcon, Loader2Icon, RefreshCwIcon, SmartphoneIcon, XCircleIcon } from 'lucide-react'
import type { FilePurpose, UploadSessionStatusResponse } from '@ai-job-print/shared'
import { Button, Card } from '@ai-job-print/ui'
import { useAuth } from '../../../auth/useAuth'
import { getTerminalId } from '../../../services/api/screensaver'
import {
  buildPhoneUploadUrl,
  cancelUploadSession,
  confirmUploadSession,
  createUploadSession,
  getUploadSessionStatus,
} from '../../../services/api/uploadSessions'

export interface PhoneUploadedFile {
  name: string
  size: string
  format: string
  fileId: string
  channel: 'phone'
  mimeType?: string
  sha256?: string
  /** print_doc / id_scan 用途携带:本系统签名内容 URL,供打印任务创建 / 证件照排版取源复用。 */
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
}: UploadSessionQrPanelProps) {
  const { getToken, isLoggedIn } = useAuth()
  const pollFailuresRef = useRef(0)
  const [qr, setQr] = useState<QrState | null>(null)
  const [status, setStatus] = useState<UploadSessionStatusResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const active = Boolean(qr && status?.status !== 'confirmed' && status?.status !== 'cancelled' && status?.status !== 'expired')

  useEffect(() => {
    onBusyChange?.(active || loading || confirming)
  }, [active, confirming, loading, onBusyChange])

  const expiresLabel = useMemo(() => {
    if (!qr) return ''
    const seconds = Math.max(0, Math.round((new Date(qr.expiresAt).getTime() - Date.now()) / 1000))
    const minutes = Math.floor(seconds / 60)
    const remain = seconds % 60
    return `${minutes}:${String(remain).padStart(2, '0')}`
  }, [qr])

  const refresh = useCallback(async () => {
    pollFailuresRef.current = 0
    setLoading(true)
    setError(null)
    try {
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
        qrUrl: buildPhoneUploadUrl(created.uploadUrl, created.sessionId, created.uploadToken, purpose),
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
      setError(err instanceof Error ? err.message : '二维码生成失败，请重试')
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
          setError(err instanceof Error ? err.message : '二维码状态获取失败')
        })
    }, 2000)
    return () => window.clearInterval(timer)
  }, [qr, status?.status, purpose])

  const handleConfirm = async () => {
    if (!status?.file || !qr || confirming) return
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
      setError(err instanceof Error ? err.message : '确认失败，请刷新二维码重试')
    } finally {
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
    }
  }

  const uploadedFile = status?.status === 'uploaded' ? status.file : null
  const uploaded = Boolean(uploadedFile)
  const expired = status?.status === 'expired'

  return (
    <Card className="p-5">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-50 text-primary-600">
          <SmartphoneIcon className="h-6 w-6" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold text-neutral-900">{title}</h2>
            {status?.mode === 'member' && <span className="rounded-full bg-success-bg px-2.5 py-1 text-xs font-bold text-success-fg">会员文件确认后归档</span>}
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
              {uploaded ? '手机端已上传文件' : expired ? '二维码已过期' : '请用手机微信或浏览器扫码'}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-neutral-600">
              {uploaded
                ? `${uploadedFile?.filename ?? '已上传文件'} · ${formatSize(uploadedFile?.sizeBytes ?? 0)}`
                : expired
                  ? '请刷新二维码后重新上传，旧二维码不再接收文件。'
                  : `二维码有效期 ${expiresLabel || '10:00'}，文件最大 10MB。`}
            </p>
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
            <Button size="sm" variant="secondary" disabled={loading || confirming} onClick={refresh}>
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
