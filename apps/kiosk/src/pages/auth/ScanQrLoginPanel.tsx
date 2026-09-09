// ScanQrLoginPanel — 手机扫码确认一体机登录
//
// 真实链路：本机 Terminal Agent 创建登录票据 → 手机扫码打开 H5 完成手机号验证 →
// 本机轮询到 confirmed 后 claim 登录。二维码为单通道 H5 链接（微信/相机扫码均可打开），
// 不区分微信/支付宝通道。视觉对齐 login-trio-v1 原型 ① 扫码面板（样式见 ./login.css）。

import { useCallback, useEffect, useRef, useState } from 'react'
import { QrCodeIcon } from 'lucide-react'
import { deriveQrGateState, type LoginQrState } from './loginGateModel'
import { QRCodeSVG } from 'qrcode.react'
import {
  type LoginResult,
  MemberApiError,
  resolveMemberApiErrorMessage,
} from '../../services/auth/memberAuthApi'
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
  agreed,
  onAgreementRequired,
  onLoginSuccess,
  onUsePhoneLogin,
  onPhaseChange,
  onRegisterRefresh,
}: {
  returnTo: string
  agreed: boolean
  onAgreementRequired: () => void
  onLoginSuccess: (result: LoginResult) => void
  onUsePhoneLogin: () => void
  onPhaseChange?: (phase: LoginQrState) => void
  onRegisterRefresh?: (refresh: () => void) => void
}) {
  const [qr, setQr] = useState<QrLoginState | null>(null)
  const [loading, setLoading] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
  const [displaySeconds, setDisplaySeconds] = useState<number | null>(null)
  const claimingRef = useRef(false)
  const refreshingRef = useRef(false)

  const refresh = useCallback(async () => {
    if (refreshingRef.current) return
    if (!agreed) {
      setQr(null)
      setNotice(null)
      setError('请先勾选用户服务协议和隐私政策')
      onAgreementRequired()
      return
    }
    refreshingRef.current = true
    setLoading(true)
    setClaiming(false)
    claimingRef.current = false
    setNotice(null)
    setError(null)
    setErrorStatus(null)
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
      setErrorStatus(err instanceof MemberApiError ? err.status : 0)
    } finally {
      refreshingRef.current = false
      setLoading(false)
    }
  }, [agreed, onAgreementRequired, returnTo])

  useEffect(() => {
    onRegisterRefresh?.(() => { void refresh() })
  }, [onRegisterRefresh, refresh])

  useEffect(() => {
    void refresh()
  // refresh intentionally runs once on mount for the current returnTo.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 用户在扫码页勾选协议后自动生成二维码，免去再点一次「刷新」。
  useEffect(() => {
    if (agreed && !qr && !loading) void refresh()
  // only re-run when agreement flips; refresh identity churn would retry-loop on failure.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agreed])

  // 展示用的秒级倒计时：以轮询返回的 expiresInSeconds 为准，本地每秒递减补帧。
  useEffect(() => {
    setDisplaySeconds(qr ? qr.expiresInSeconds : null)
  }, [qr])
  useEffect(() => {
    if (displaySeconds === null || displaySeconds <= 0) return undefined
    const timer = window.setTimeout(
      () => setDisplaySeconds((s) => (s === null ? null : Math.max(0, s - 1))),
      1000,
    )
    return () => window.clearTimeout(timer)
  }, [displaySeconds])

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
          setErrorStatus(null)

          if (status.status !== 'confirmed') return
          claimingRef.current = true
          setClaiming(true)
          setNotice('手机已确认，正在换取登录态')
          const claimed = await claimQrLoginViaLocalAgent(qr.ticketId)
          if (!agreed) {
            setNotice(null)
            setError('请先勾选用户服务协议和隐私政策')
            onAgreementRequired()
            setClaiming(false)
            claimingRef.current = false
            return
          }
          onLoginSuccess(claimed)
        } catch (err) {
          const message = resolveMemberApiErrorMessage(err, '扫码登录状态获取失败，请刷新二维码重试')
          setNotice(null)
          setError(message)
          setErrorStatus(err instanceof MemberApiError ? err.status : 0)
          setClaiming(false)
          claimingRef.current = false
          if (err instanceof MemberApiError && (err.status === 404 || err.status === 410 || err.status === 401)) {
            setQr(null)
          }
        }
      })()
    }, 2000)

    return () => window.clearInterval(timer)
  }, [agreed, onAgreementRequired, onLoginSuccess, qr?.ticketId])

  const phase = deriveQrGateState({
    agreed,
    loading,
    claiming,
    hasTicket: Boolean(qr?.qrValue),
    displaySeconds,
    errorStatus,
    hasError: Boolean(error),
  })

  useEffect(() => {
    onPhaseChange?.(phase)
  }, [onPhaseChange, phase])

  const slotTitle = phase === 'qr-ready'
    ? '请用手机扫描'
    : phase === 'qr-expired'
      ? '二维码已失效'
      : phase === 'qr-confirmed'
        ? '手机已确认'
        : phase === 'qr-error'
          ? '扫码登录暂不可用'
          : '等待你勾选协议'
  const slotDesc = phase === 'qr-ready'
    ? (displaySeconds !== null && displaySeconds > 0 ? `二维码 ${displaySeconds}s 后过期` : '请刷新后重扫')
    : phase === 'qr-loading'
      ? '没有勾选协议之前，这台机器不会向服务端申请票据，这里也不会出现任何可扫的图形。'
      : phase === 'qr-confirmed'
        ? '这台机器正在换取登录态，换成功才算登录。'
        : phase === 'qr-error'
          ? '申请票据或查询状态的请求没有成功。本页不显示一张可能已经失效的二维码。'
          : '重新生成后，新的二维码会显示在这里。'

  return (
    <div className="service-desk k1-scan-qr-login lg-qrwrap">
      <div className="lg-qrslot k-qrframe" data-testid="login-gate-qr-slot" role="group" aria-label={slotTitle}>
        {phase === 'qr-ready' && qr?.qrValue ? (
          <QRCodeSVG value={qr.qrValue} size={280} level="M" marginSize={1} />
        ) : (
          <QrCodeIcon className="k-qr-placeholder" size={72} aria-hidden="true" />
        )}
        <b id="qr-slot-title">{slotTitle}</b>
        <span id="qr-slot-desc">{slotDesc}</span>
      </div>
      <div className="qrside">
        <ol className="lg-steps">
          <li><span className="sn">1</span><span>勾选下面的协议，这台机器才会去申请登录票据。</span></li>
          <li><span className="sn">2</span><span>用手机相机或微信扫左边的二维码，在手机上完成手机号验证并确认。</span></li>
          <li><span className="sn">3</span><span>手机确认不等于已经登录；还要这台机器再换一次登录态。</span></li>
        </ol>
        {notice ? <p className="lg-echo" role="status">{notice}</p> : null}
        {error ? <p className="lg-reason" role="alert">{error}</p> : null}
        <button type="button" className="qx-btn" data-variant="ghost" onClick={onUsePhoneLogin}>
          改用手机号登录
        </button>
      </div>
    </div>
  )
}

function localQrErrorMessage(error: unknown): string {
  if (!(error instanceof MemberApiError)) return '扫码登录服务不可用，请使用手机号登录'
  if (error.code === 'LOCAL_QR_BRIDGE_TOKEN_MISSING') return '当前终端版本未配置扫码登录，请联系管理员或使用手机号登录'
  if (error.code === 'LOCAL_QR_ORIGIN_FORBIDDEN') return '当前页面来源未被本机扫码登录服务允许'
  if (error.code === 'LOCAL_QR_BRIDGE_TOKEN_INVALID') return '本机扫码登录服务未正确配置，请使用手机号登录'
  if (error.status === 0 || error.code === 'NETWORK_ERROR') return '本机扫码登录服务未连接，请使用手机号登录'
  return resolveMemberApiErrorMessage(error, '扫码登录服务不可用，请使用手机号登录')
}
