import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CheckCircle2Icon, ShieldCheckIcon, SmartphoneIcon } from 'lucide-react'
import { MemberApiError, sendSmsCode } from '../../services/auth/memberAuthApi'
import { confirmQrLogin, fetchQrLoginStatus } from '../../services/auth/memberQrLoginApi'

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
    <main className="min-h-screen bg-[#f3f5f9] px-5 py-8 text-[#172033]">
      <section className="mx-auto flex w-full max-w-[460px] flex-col">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-[18px] bg-gradient-to-br from-[#3185ff] via-[#7f65dc] to-[#ff6a3d] text-white shadow-lg shadow-primary-500/20">
            <SmartphoneIcon className="h-8 w-8" aria-hidden="true" />
          </div>
          <h1 className="mt-4 text-2xl font-bold">手机确认登录</h1>
          <p className="mt-2 text-sm leading-6 text-[#7e8797]">
            输入手机号和短信验证码后，一体机会自动进入会员登录态。
          </p>
          <div className="mt-4 rounded-[10px] border border-primary-100 bg-primary-50 px-4 py-3 text-sm font-semibold leading-6 text-primary-700">
            设备提示：{deviceLabel ?? '正在识别一体机'}
            <br />
            请确认它与你面前的一体机一致，再继续登录。
          </div>
        </div>

        <div className="mt-8 rounded-[10px] border border-[#dfe4ec] bg-white p-5 shadow-sm">
          <label className="block text-sm font-semibold">手机号</label>
          <div className="mt-3 flex min-h-[52px] items-center rounded-[10px] border border-[#dfe4ec] bg-[#f8fafc] px-4">
            <span className="mr-3 border-r border-[#e1e6ef] pr-3 text-sm font-semibold text-[#8a94a6]">+86</span>
            <input
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              value={phone}
              disabled={confirmed}
              onChange={(event) => setPhone(normalizeDigits(event.target.value, PHONE_LENGTH))}
              placeholder="请输入手机号"
              className="min-w-0 flex-1 bg-transparent text-base font-semibold outline-none placeholder:text-[#a1a8b5]"
            />
          </div>

          <label className="mt-5 block text-sm font-semibold">验证码</label>
          <div className="mt-3 flex gap-3">
            <div className="flex min-h-[52px] flex-1 items-center rounded-[10px] border border-[#dfe4ec] bg-[#f8fafc] px-4">
              <ShieldCheckIcon className="mr-2 h-5 w-5 text-[#98a2b3]" aria-hidden="true" />
              <input
                type="tel"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                disabled={confirmed}
                onChange={(event) => setCode(normalizeDigits(event.target.value, CODE_LENGTH))}
                placeholder="6位验证码"
                className="min-w-0 flex-1 bg-transparent text-base font-semibold tracking-[0.12em] outline-none placeholder:tracking-normal placeholder:text-[#a1a8b5]"
              />
            </div>
            <button
              type="button"
              onClick={handleSendCode}
              disabled={!canSend}
              className="min-h-[52px] min-w-[104px] rounded-[10px] bg-[#edf5ff] px-4 text-sm font-bold text-[#1677ff] disabled:cursor-not-allowed disabled:bg-[#eef1f6] disabled:text-[#a1a8b5]"
            >
              {loading ? '处理中' : countdown.seconds > 0 ? `${countdown.seconds}s` : '获取验证码'}
            </button>
          </div>

          {notice && (
            <div className="mt-4 flex min-h-[42px] items-center justify-center gap-2 rounded-[8px] bg-success-bg px-4 text-sm font-semibold text-success-fg">
              <CheckCircle2Icon className="h-4 w-4" aria-hidden="true" />
              {notice}
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-[8px] bg-error-bg px-4 py-3 text-center text-sm font-semibold text-error-fg">
              {error}
            </div>
          )}

          {error && !ready && ticketId && (
            <button
              type="button"
              onClick={loadTicketStatus}
              className="mt-4 min-h-[44px] w-full rounded-[10px] border border-[#dfe4ec] bg-white text-sm font-bold text-[#1677ff]"
            >
              重新检查二维码
            </button>
          )}

          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="mt-5 min-h-[54px] w-full rounded-[10px] bg-[#1677ff] text-base font-bold text-white shadow-lg shadow-primary-500/20 disabled:cursor-not-allowed disabled:bg-[#a9bdf5]"
          >
            {confirmed ? '已确认，请回到一体机' : loading ? '确认中...' : '确认登录一体机'}
          </button>
        </div>

        <p className="mt-5 text-center text-xs leading-5 text-[#98a2b3]">
          本页面只用于确认当前一体机登录，不会在手机或一体机长期保存登录凭证。
        </p>
      </section>
    </main>
  )
}
