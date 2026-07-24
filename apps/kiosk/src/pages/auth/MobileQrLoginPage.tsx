import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckCircle2Icon, CircleAlertIcon, LoaderCircleIcon, MonitorIcon, QrCodeIcon, ShieldCheckIcon } from 'lucide-react'
import { MemberApiError, sendSmsCode } from '../../services/auth/memberAuthApi'
import { confirmQrLogin, fetchQrLoginStatus } from '../../services/auth/memberQrLoginApi'
import './mobile-qr-service-desk.css'

const PHONE_LENGTH = 11
const CODE_LENGTH = 6

function normalizeDigits(raw: string, maxLength: number): string {
  return raw.replace(/\D/g, '').slice(0, maxLength)
}

function formatPhone(raw: string): string {
  if (raw.length <= 3) return raw
  if (raw.length <= 7) return `${raw.slice(0, 3)} ${raw.slice(3)}`
  return `${raw.slice(0, 3)} ${raw.slice(3, 7)} ${raw.slice(7)}`
}

function useCountdown() {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (seconds <= 0) return undefined
    const timer = window.setTimeout(() => setSeconds((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [seconds])
  return { seconds, start: setSeconds }
}

export function MobileQrLoginPage() {
  const [params] = useSearchParams()
  const ticketId = params.get('ticketId') ?? ''
  const countdown = useCountdown()

  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [deviceLabel, setDeviceLabel] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadTicketStatus = useCallback(() => {
    if (!ticketId) {
      setError('二维码缺少登录票据，请回到一体机刷新二维码')
      return
    }
    setReady(false)
    setError(null)
    setNotice(null)
    let cancelled = false
    fetchQrLoginStatus(ticketId)
      .then((status) => {
        if (cancelled) return
        setDeviceLabel(status.deviceLabel ?? null)
        setReady(true)
        if (status.status === 'confirmed') {
          setConfirmed(true)
          setNotice('该二维码已确认，请回到一体机继续')
        }
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof MemberApiError ? err.message : '二维码已失效，请回到一体机刷新')
      })
    return () => {
      cancelled = true
    }
  }, [ticketId])

  useEffect(() => loadTicketStatus(), [loadTicketStatus])

  const handleSendCode = useCallback(async () => {
    if (phone.length !== PHONE_LENGTH || loading || countdown.seconds > 0 || confirmed) return
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const result = await sendSmsCode(phone)
      countdown.start(result.cooldownSeconds > 0 ? result.cooldownSeconds : 60)
      setNotice(`验证码已发送至 ${formatPhone(phone)}`)
    } catch (err) {
      setError(err instanceof MemberApiError ? err.message : '发送失败，请重试')
    } finally {
      setLoading(false)
    }
  }, [confirmed, countdown, loading, phone])

  const handleConfirm = useCallback(async () => {
    if (!ticketId || phone.length !== PHONE_LENGTH || code.length !== CODE_LENGTH || loading || confirmed) return
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      await confirmQrLogin(ticketId, phone, code)
      setConfirmed(true)
      setNotice('登录已确认，请回到一体机继续使用')
    } catch (err) {
      setError(err instanceof MemberApiError ? err.message : '确认失败，请重试')
      setCode('')
    } finally {
      setLoading(false)
    }
  }, [code, confirmed, loading, phone, ticketId])

  const canSend = ready && phone.length === PHONE_LENGTH && countdown.seconds === 0 && !loading && !confirmed
  const canConfirm = ready && phone.length === PHONE_LENGTH && code.length === CODE_LENGTH && !loading && !confirmed
  const recoveryMessage = !ticketId ? '二维码缺少登录票据，请回到一体机刷新二维码后重新扫码。' : error

  return (
    <main className="service-desk k1-mobile-qr-login" data-visual-theme="service-desk" data-ux-density="touch" data-kiosk-presentation="fusion-youth" data-kiosk-viewport="mobile">
      <section className="k1-mobile-qr-content">
        <header className="k1-mobile-qr-brand">
          <span><QrCodeIcon aria-hidden="true" /></span>
          <div><strong>AI求职打印服务终端</strong><small>手机确认登录</small></div>
        </header>
        <div className="k1-mobile-qr-intro">
          <div className="k1-mobile-qr-icon">
            <MonitorIcon aria-hidden="true" />
          </div>
          <h1>{deviceLabel ?? '就业服务大厅 · 当前一体机'}</h1>
          <p>
            该一体机正在请求登录你的账号。请确认是你本人在现场操作，再完成手机号验证。
          </p>
          {!ready && !recoveryMessage && (
            <div className="k1-mobile-qr-device" role="status" aria-live="polite">
              正在识别一体机，请稍候…
            </div>
          )}
          {ready && (
            <div className="k1-mobile-qr-device">
              二维码 <b>3 分钟</b>内有效 · 到期请在一体机上刷新
            </div>
          )}
        </div>

        <div className="k1-mobile-qr-card">
          {!ready ? (
            recoveryMessage ? (
              <div className="k1-mobile-qr-invalid" role="alert" aria-live="polite">
                <CircleAlertIcon aria-hidden="true" />
                <h2>暂时无法确认登录</h2>
                <p>{recoveryMessage}</p>
                {ticketId && (
                  <button type="button" onClick={loadTicketStatus} className="k1-mobile-qr-retry">
                    重新检查二维码
                  </button>
                )}
              </div>
            ) : (
              <div className="k1-mobile-qr-checking" role="status" aria-live="polite">
                <LoaderCircleIcon aria-hidden="true" />
                <p>正在检查二维码是否有效…</p>
              </div>
            )
          ) : (
            <>
              <label className="k1-mobile-qr-label" htmlFor="k1-mobile-qr-phone">手机号</label>
              <div className="k1-mobile-qr-field">
                <span className="k1-mobile-qr-prefix">+86</span>
                <input
                  id="k1-mobile-qr-phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  value={phone}
                  disabled={confirmed}
                  onChange={(event) => setPhone(normalizeDigits(event.target.value, PHONE_LENGTH))}
                  placeholder="请输入手机号"
                  className="k1-mobile-qr-input"
                />
              </div>

              <label className="k1-mobile-qr-label k1-mobile-qr-code-label" htmlFor="k1-mobile-qr-code">验证码</label>
              <div className="k1-mobile-qr-code-row">
                <div className="k1-mobile-qr-field k1-mobile-qr-code-field">
                  <ShieldCheckIcon aria-hidden="true" />
                  <input
                    id="k1-mobile-qr-code"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    disabled={confirmed}
                    onChange={(event) => setCode(normalizeDigits(event.target.value, CODE_LENGTH))}
                    placeholder="6位验证码"
                    className="k1-mobile-qr-input k1-mobile-qr-code-input"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={!canSend}
                  className="k1-mobile-qr-send"
                >
                  {loading ? '处理中' : countdown.seconds > 0 ? `${countdown.seconds}s` : '获取验证码'}
                </button>
              </div>

              {notice && (
                <div className="k1-mobile-qr-notice" role="status" aria-live="polite">
                  <CheckCircle2Icon aria-hidden="true" />
                  {notice}
                </div>
              )}

              {error && (
                <div className="k1-mobile-qr-error" role="alert" aria-live="polite">
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={handleConfirm}
                disabled={!canConfirm}
                className="k1-mobile-qr-confirm"
              >
                {confirmed ? '已确认，请回到一体机' : loading ? '确认中...' : '确认登录一体机'}
              </button>
            </>
          )}
        </div>

        <p className="k1-mobile-qr-footer">
          确认后请回到一体机继续使用；离开时请记得在一体机上退出登录。手机号在系统中加密存储，页面展示时脱敏。
        </p>
      </section>
    </main>
  )
}
