import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckCircle2Icon, ShieldCheckIcon, SmartphoneIcon } from 'lucide-react'
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

  return (
    <main className="service-desk k1-mobile-qr-login" data-visual-theme="service-desk" data-ux-density="touch">
      <section className="k1-mobile-qr-content">
        <div className="k1-mobile-qr-intro">
          <div className="k1-mobile-qr-icon">
            <SmartphoneIcon aria-hidden="true" />
          </div>
          <h1>手机确认登录</h1>
          <p>
            输入手机号和短信验证码后，一体机会自动进入会员登录态。
          </p>
          <div className="k1-mobile-qr-device">
            设备提示：{deviceLabel ?? '正在识别一体机'}
            <br />
            请确认它与你面前的一体机一致，再继续登录。
          </div>
        </div>

        <div className="k1-mobile-qr-card">
          <label className="k1-mobile-qr-label">手机号</label>
          <div className="k1-mobile-qr-field">
            <span className="k1-mobile-qr-prefix">+86</span>
            <input
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

          <label className="k1-mobile-qr-label k1-mobile-qr-code-label">验证码</label>
          <div className="k1-mobile-qr-code-row">
            <div className="k1-mobile-qr-field k1-mobile-qr-code-field">
              <ShieldCheckIcon aria-hidden="true" />
              <input
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

          {error && !ready && ticketId && (
            <button
              type="button"
              onClick={loadTicketStatus}
              className="k1-mobile-qr-retry"
            >
              重新检查二维码
            </button>
          )}

          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="k1-mobile-qr-confirm"
          >
            {confirmed ? '已确认，请回到一体机' : loading ? '确认中...' : '确认登录一体机'}
          </button>
        </div>

        <p className="k1-mobile-qr-footer">
          本页面只用于确认当前一体机登录，不会在手机或一体机长期保存登录凭证。
        </p>
      </section>
    </main>
  )
}
