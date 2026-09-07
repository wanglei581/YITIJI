import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FilePurpose, UploadSessionStatusResponse } from '@ai-job-print/shared'
import { useAuth } from '../../../auth/useAuth'
import { getTerminalId } from '../../../services/api/screensaver'
import {
  buildPhoneUploadUrl,
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

export interface UploadSessionSnapshot {
  status: UploadSessionStatusResponse['status'] | null
  loading: boolean
  confirming: boolean
  cancelling: boolean
  cancelFailed: boolean
  confirmFailed: boolean
  error: string | null
  hasQr: boolean
  pendingName: string | null
  pendingSize: string | null
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

function expiredStatus(
  qr: QrState,
  current: UploadSessionStatusResponse | null,
  purpose: FilePurpose,
): UploadSessionStatusResponse {
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

export interface UseUploadSessionOptions {
  purpose?: FilePurpose
  /** 为 false 时不签发、不轮询；等价于卸载冻结面板，不在服务端撤销（与卸载行为一致）。 */
  enabled?: boolean
  onUploaded: (file: PhoneUploadedFile) => void
}

export interface UseUploadSessionResult {
  qrUrl: string | null
  expiresLabel: string
  snapshot: UploadSessionSnapshot
  refresh: () => Promise<void>
  confirm: () => Promise<void>
  cancel: () => Promise<void>
}

export function useUploadSession({
  purpose = 'resume_upload',
  enabled = true,
  onUploaded,
}: UseUploadSessionOptions): UseUploadSessionResult {
  const { getToken, isLoggedIn } = useAuth()
  const pollFailuresRef = useRef(0)
  const qrRef = useRef<QrState | null>(null)
  const statusRef = useRef<UploadSessionStatusResponse | null>(null)
  const enabledRef = useRef(enabled)
  const onUploadedRef = useRef(onUploaded)
  const [qr, setQr] = useState<QrState | null>(null)
  const [status, setStatus] = useState<UploadSessionStatusResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelFailed, setCancelFailed] = useState(false)
  const [confirmFailed, setConfirmFailed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  enabledRef.current = enabled
  onUploadedRef.current = onUploaded

  useEffect(() => {
    qrRef.current = qr
  }, [qr])

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    if (
      !enabled ||
      !qr ||
      status?.status === 'uploaded' ||
      status?.status === 'confirmed' ||
      status?.status === 'cancelled' ||
      status?.status === 'expired'
    ) {
      return undefined
    }
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [enabled, qr, status?.status])

  useEffect(() => {
    if (
      !enabled ||
      !qr ||
      !status ||
      status.status === 'uploaded' ||
      status.status === 'confirmed' ||
      status.status === 'cancelled' ||
      status.status === 'expired'
    ) {
      return
    }
    if (new Date(qr.expiresAt).getTime() <= now) {
      setStatus((current) => expiredStatus(qr, current, purpose))
    }
  }, [enabled, now, purpose, qr, status])

  const expiresLabel = useMemo(() => {
    if (!qr) return ''
    const seconds = Math.max(0, Math.round((new Date(qr.expiresAt).getTime() - now) / 1000))
    const minutes = Math.floor(seconds / 60)
    const remain = seconds % 60
    return `${minutes}:${String(remain).padStart(2, '0')}`
  }, [now, qr])

  const refresh = useCallback(async () => {
    if (!enabledRef.current) return
    pollFailuresRef.current = 0
    setLoading(true)
    setError(null)
    setCancelFailed(false)
    setConfirmFailed(false)
    try {
      const existing = qrRef.current
      if (statusRef.current?.status === 'uploaded') {
        setError('手机端已上传文件，请先在一体机确认，或取消本次上传后重新开始。')
        return
      }
      if (existing) {
        // 新码只有在旧码已被服务端撤销（或已确认失效）时才生成，避免旁人手里的旧码继续可用。
        await revokePreviousSession(existing)
        if (!enabledRef.current) return
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
      if (!enabledRef.current) return
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
      if (!enabledRef.current) return
      setError(uploadSessionUserMessage(err, '二维码生成失败，请稍后重试。'))
    } finally {
      setLoading(false)
    }
  }, [getToken, isLoggedIn, purpose])

  useEffect(() => {
    if (!enabled) {
      setQr(null)
      setStatus(null)
      setLoading(false)
      setConfirming(false)
      setCancelling(false)
      setCancelFailed(false)
      setConfirmFailed(false)
      setError(null)
      return undefined
    }
    void refresh()
    return undefined
  }, [enabled, refresh])

  useEffect(() => {
    if (
      !enabled ||
      !qr ||
      status?.status === 'uploaded' ||
      status?.status === 'confirmed' ||
      status?.status === 'cancelled' ||
      status?.status === 'expired'
    ) {
      return undefined
    }
    const timer = window.setInterval(() => {
      getUploadSessionStatus(qr.sessionId, qr.controlToken)
        .then((next) => {
          pollFailuresRef.current = 0
          if (!enabledRef.current) return
          setStatus(next)
        })
        .catch((err) => {
          pollFailuresRef.current += 1
          const code = apiErrorCode(err)
          if (!enabledRef.current) return
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
  }, [enabled, qr, status?.status, purpose])

  const confirm = useCallback(async () => {
    if (!status?.file || !qr || confirming) return
    setConfirming(true)
    setConfirmFailed(false)
    setError(null)
    try {
      const result = await confirmUploadSession(qr.sessionId, qr.controlToken, getToken())
      const file = result.file
      onUploadedRef.current({
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
      setConfirmFailed(true)
      setError(uploadSessionUserMessage(err, '确认失败，请刷新二维码重试。'))
    } finally {
      setConfirming(false)
    }
  }, [confirming, getToken, qr, status])

  const cancel = useCallback(async () => {
    if (!qr || cancelling) return
    setCancelling(true)
    setCancelFailed(false)
    setError(null)
    try {
      await cancelUploadSession(qr.sessionId, qr.controlToken)
      setQr(null)
      setStatus((current) => ({
        sessionId: qr.sessionId,
        status: 'cancelled',
        purpose: current?.purpose ?? purpose,
        mode: current?.mode ?? 'temporary',
        file: current?.file ?? null,
        requiresKioskConfirmation: current?.requiresKioskConfirmation ?? false,
        expiresAt: current?.expiresAt ?? qr.expiresAt,
      }))
    } catch (err) {
      const code = apiErrorCode(err)
      if (code && ALREADY_REVOKED_CODES.has(code)) {
        setQr(null)
        setStatus((current) => expiredStatus(qr, current, purpose))
        return
      }
      setCancelFailed(true)
      setError(uploadSessionUserMessage(err, '这次会话没能取消，文件还留着。'))
    } finally {
      setCancelling(false)
    }
  }, [cancelling, purpose, qr])

  const snapshot: UploadSessionSnapshot = {
    status: status?.status ?? null,
    loading,
    confirming,
    cancelling,
    cancelFailed,
    confirmFailed,
    error,
    hasQr: Boolean(qr),
    pendingName: status?.file?.filename ?? null,
    pendingSize: status?.file ? formatSize(status.file.sizeBytes) : null,
  }

  return {
    qrUrl: qr?.qrUrl ?? null,
    expiresLabel,
    snapshot,
    refresh,
    confirm,
    cancel,
  }
}
