import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2Icon, QrCodeIcon, RefreshCwIcon } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import type { LoginResult } from '../../services/auth/memberAuthApi'
import { MemberApiError } from '../../services/auth/memberAuthApi'
import { getMemberAuthDeviceId } from '../../services/auth/memberAuthDevice'
import {
  buildQrLoginUrl,
  claimQrLoginViaLocalAgent,
  createQrLoginViaLocalAgent,
  fetchQrLoginStatus,
} from '../../services/auth/memberQrLoginApi'

interface QrLoginState {
  ticketId: string
  qrValue: string
  expiresInSeconds: number
  status: 'pending' | 'confirmed'
}

export function ScanQrLoginPanel({
  returnTo,
  onLoginSuccess,
  onUsePhoneLogin,
}: {
  returnTo: string
  onLoginSuccess: (result: LoginResult) => void
  onUsePhoneLogin: () => void
}) {
  const [qr, setQr] = useState<QrLoginState | null>(null)
  const [loading, setLoading] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const claimingRef = useRef(false)

  const refresh = useCallback(async () => {
    if (loading) return
    setLoading(true)
    setClaiming(false)
    claimingRef.current = false
    setNotice(null)
    setError(null)
    try {
      const terminalName = (import.meta.env['VITE_TERMINAL_DISPLAY_NAME'] ?? '').trim()
      const deviceLabel = terminalName || `一体机 ${window.location.host}`
      const created = await createQrLoginViaLocalAgent({
        deviceId: getMemberAuthDeviceId(),
        deviceLabel,
        returnTo,
      })
      setQr({
        ticketId: created.ticketId,
        qrValue: buildQrLoginUrl(created.qrUrl),
        expiresInSeconds: created.expiresInSeconds,
        status: 'pending',
      })
    } catch (err) {
      setQr(null)
      setError(localQrErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [loading, returnTo])

  useEffect(() => {
    void refresh()
  // refresh intentionally runs once on mount for the current returnTo.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!qr?.ticketId) return undefined

    const timer = window.setInterval(() => {
      void (async () => {
        if (claimingRef.current) return
        try {
          const status = await fetchQrLoginStatus(qr.ticketId)
          setQr((current) => current && current.ticketId === qr.ticketId
            ? { ...current, status: status.status, expiresInSeconds: status.expiresInSeconds }
            : current)
          setError(null)

          if (status.status !== 'confirmed') return
          claimingRef.current = true
          setClaiming(true)
          setNotice('手机已确认，正在登录一体机...')
          const claimed = await claimQrLoginViaLocalAgent(qr.ticketId)
          onLoginSuccess(claimed)
        } catch (err) {
          const message = err instanceof MemberApiError ? err.message : '扫码登录失败，请刷新二维码重试'
          setNotice(null)
          setError(message)
          setClaiming(false)
          claimingRef.current = false
          if (err instanceof MemberApiError && (err.status === 404 || err.status === 410 || err.status === 401)) {
            setQr(null)
          }
        }
      })()
    }, 2000)

    return () => window.clearInterval(timer)
  }, [onLoginSuccess, qr?.ticketId])

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col items-center text-center">
      <div className="flex w-full max-w-[360px] items-center justify-center rounded-[8px] bg-[#e9edf3] p-1">
        <div className="min-h-[40px] w-full rounded-[8px] bg-white px-4 py-2 text-sm font-bold text-[#1677ff] shadow-sm">
          手机扫码登录
        </div>
      </div>

      <div className="mt-8 flex h-[184px] w-[184px] items-center justify-center rounded-[18px] border-2 border-[#1677ff] bg-white shadow-sm">
        {loading && <span className="text-sm font-semibold text-[#98a2b3]">生成中...</span>}
        {!loading && qr?.qrValue && <QRCodeSVG value={qr.qrValue} size={142} level="M" marginSize={1} />}
        {!loading && !qr?.qrValue && <QrCodeIcon className="h-16 w-16 text-[#c6ceda]" aria-hidden="true" />}
      </div>

      <p className="mt-4 text-base font-bold text-[#1e293b]">用手机扫描二维码</p>
      <p className="mt-1 text-sm text-[#7e8797]">
        {qr?.status === 'confirmed'
          ? '手机已确认，正在登录一体机'
          : qr?.expiresInSeconds && qr.expiresInSeconds > 0
            ? `二维码剩余 ${qr.expiresInSeconds} 秒`
            : error
              ? '请刷新二维码或使用手机号登录'
              : '二维码有效期 3 分钟'}
      </p>
      <p className="mt-2 max-w-[460px] text-xs leading-5 text-[#98a2b3]">
        手机上输入手机号和短信验证码后，本机会自动进入会员登录态；本机服务不可用时可继续使用手机号登录。
      </p>

      {notice && (
        <div className="mt-4 flex min-h-[42px] items-center justify-center gap-2 rounded-[8px] bg-emerald-50 px-4 text-sm font-semibold text-emerald-700">
          <CheckCircle2Icon className="h-4 w-4" aria-hidden="true" />
          {notice}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-[8px] bg-red-50 px-4 py-3 text-center text-sm font-semibold text-red-600">
          {error}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={refresh}
          disabled={loading || claiming}
          className="flex min-h-[44px] items-center gap-2 rounded-[8px] border border-[#dfe4ec] bg-white px-5 text-sm font-semibold text-[#667085] shadow-sm transition-colors active:bg-neutral-50 disabled:cursor-not-allowed disabled:text-[#a1a8b5]"
        >
          <RefreshCwIcon className="h-4 w-4" aria-hidden="true" />
          {claiming ? '登录中...' : loading ? '刷新中...' : '刷新二维码'}
        </button>
        <button
          type="button"
          onClick={onUsePhoneLogin}
          className="min-h-[44px] rounded-[8px] bg-[#edf5ff] px-5 text-sm font-bold text-[#1677ff] transition-colors active:bg-blue-100"
        >
          使用手机号登录
        </button>
      </div>
    </div>
  )
}

function localQrErrorMessage(error: unknown): string {
  if (!(error instanceof MemberApiError)) return '扫码登录服务不可用，请使用手机号登录'
  if (error.status === 0 || error.code === 'NETWORK_ERROR') return '本机扫码登录服务未连接，请使用手机号登录'
  if (error.code === 'LOCAL_QR_ORIGIN_FORBIDDEN') return '当前页面来源未被本机扫码登录服务允许'
  return error.message || '扫码登录服务不可用，请使用手机号登录'
}
