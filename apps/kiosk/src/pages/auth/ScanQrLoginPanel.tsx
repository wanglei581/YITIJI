// ScanQrLoginPanel — 手机扫码确认一体机登录
//
// 真实链路：本机 Terminal Agent 创建登录票据 → 手机扫码打开 H5 完成手机号验证 →
// 本机轮询到 confirmed 后 claim 登录。二维码为单通道 H5 链接（微信/相机扫码均可打开），
// 不区分微信/支付宝通道。视觉对齐 login-trio-v1 原型 ① 扫码面板（样式见 ./login.css）。

import { useCallback, useEffect, useRef, useState } from 'react'
import { CircleCheckIcon, QrCodeIcon, RefreshCwIcon, ShieldCheckIcon, SmartphoneIcon } from 'lucide-react'
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
  agreed,
  onAgreementRequired,
  onLoginSuccess,
  onUsePhoneLogin,
}: {
  returnTo: string
  agreed: boolean
  onAgreementRequired: () => void
  onLoginSuccess: (result: LoginResult) => void
  onUsePhoneLogin: () => void
}) {
  const [qr, setQr] = useState<QrLoginState | null>(null)
  const [loading, setLoading] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [displaySeconds, setDisplaySeconds] = useState<number | null>(null)
  const claimingRef = useRef(false)

  const refresh = useCallback(async () => {
    if (loading) return
    if (!agreed) {
      setQr(null)
      setNotice(null)
      setError('请先勾选用户服务协议和隐私政策')
      onAgreementRequired()
      return
    }
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
  }, [agreed, loading, onAgreementRequired, returnTo])

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

          if (status.status !== 'confirmed') return
          claimingRef.current = true
          setClaiming(true)
          setNotice('手机已确认，正在登录一体机...')
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
  }, [agreed, onAgreementRequired, onLoginSuccess, qr?.ticketId])

  const showScanline = !!qr && qr.status === 'pending' && !loading

  return (
    <div className="service-desk k1-scan-qr-login k-pane">
      <div className="k-scan">
        <div className="k-qrwrap">
          <div className="k-qrframe">
            <span className="corner tl" />
            <span className="corner tr" />
            <span className="corner bl" />
            <span className="corner br" />
            {loading && <span className="k-qr-loading">二维码生成中…</span>}
            {!loading && qr?.qrValue && <QRCodeSVG value={qr.qrValue} size={252} level="M" marginSize={1} />}
            {!loading && !qr?.qrValue && <QrCodeIcon className="k-qr-placeholder" size={72} aria-hidden="true" />}
            {showScanline && <div className="scanline" />}
          </div>
          <div className="k-qrmeta">
            {qr && displaySeconds !== null && displaySeconds > 0 ? (
              <span>
                二维码 <b>{displaySeconds}</b>s 后过期
              </span>
            ) : qr ? (
              <span>二维码已过期，请刷新</span>
            ) : (
              <span>二维码有效期 3 分钟</span>
            )}
            <button type="button" className="k-refresh ripple-host" onClick={() => void refresh()} disabled={loading || claiming}>
              <RefreshCwIcon size={15} aria-hidden="true" />
              {claiming ? '登录中…' : loading ? '刷新中…' : '刷新'}
            </button>
          </div>
        </div>

        <div className="k-scan-right">
          <div className="k-steps">
            <div className="k-step">
              <div className="rail-v">
                <span className="no">1</span>
                <span className="vline" />
              </div>
              <div className="txt">
                打开手机<b>相机</b>或微信「扫一扫」，扫描左侧二维码
              </div>
            </div>
            <div className="k-step">
              <div className="rail-v">
                <span className="no">2</span>
                <span className="vline" />
              </div>
              <div className="txt">
                在手机页面输入<b>手机号和短信验证码</b>完成验证
              </div>
            </div>
            <div className="k-step">
              <div className="rail-v">
                <span className="no">3</span>
              </div>
              <div className="txt">
                本机自动进入登录态，<b>无需再操作屏幕</b>
              </div>
            </div>
          </div>

          {notice && (
            <div className="k-notice" role="status" aria-live="polite">
              <CircleCheckIcon size={20} aria-hidden="true" />
              <span>{notice}</span>
            </div>
          )}
          {error && (
            <div className="k-error" role="alert" aria-live="polite">
              <span>{error}</span>
            </div>
          )}

          <button type="button" className="k-scan-fallback ripple-host" onClick={onUsePhoneLogin}>
            <SmartphoneIcon size={16} aria-hidden="true" />
            本机服务不可用？改用手机号登录
          </button>

          <div className="k-scan-note">
            <ShieldCheckIcon size={19} aria-hidden="true" />
            <span>登录凭证只保存在本终端本机，离开前请在「我的」中退出登录。</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function localQrErrorMessage(error: unknown): string {
  if (!(error instanceof MemberApiError)) return '扫码登录服务不可用，请使用手机号登录'
  if (error.status === 0 || error.code === 'NETWORK_ERROR') return '本机扫码登录服务未连接，请使用手机号登录'
  if (error.code === 'LOCAL_QR_ORIGIN_FORBIDDEN') return '当前页面来源未被本机扫码登录服务允许'
  if (error.code === 'LOCAL_QR_BRIDGE_TOKEN_INVALID') return '本机扫码登录服务未正确配置，请使用手机号登录'
  return error.message || '扫码登录服务不可用，请使用手机号登录'
}
