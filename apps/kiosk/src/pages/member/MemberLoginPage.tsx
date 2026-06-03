import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import { ShieldCheckIcon, SmartphoneIcon } from 'lucide-react'
import { useMemberAuth } from '../../auth/MemberAuthContext'
import { MemberApiError, sendSmsCode } from '../../services/auth/memberAuthApi'

const CN_MOBILE = /^1[3-9]\d{9}$/

interface RedirectState {
  from?: string
}

export function MemberLoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { isAuthenticated, ready, login } = useMemberAuth()

  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [sending, setSending] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)

  const from = (location.state as RedirectState | null)?.from ?? '/profile'

  // 已登录则不停留在登录页。
  useEffect(() => {
    if (ready && isAuthenticated) navigate(from, { replace: true })
  }, [ready, isAuthenticated, navigate, from])

  // 验证码冷却倒计时。
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const phoneValid = CN_MOBILE.test(phone)
  const codeValid = /^\d{6}$/.test(code)

  async function handleSendCode(): Promise<void> {
    if (!phoneValid || cooldown > 0 || sending) return
    setError(null)
    setHint(null)
    setSending(true)
    try {
      const res = await sendSmsCode(phone)
      setCooldown(res.cooldownSeconds)
      setHint('验证码已发送，5 分钟内有效')
    } catch (e) {
      setError(e instanceof MemberApiError ? e.message : '验证码发送失败，请稍后再试')
    } finally {
      setSending(false)
    }
  }

  async function handleLogin(): Promise<void> {
    if (!phoneValid || !codeValid || submitting) return
    setError(null)
    setSubmitting(true)
    try {
      await login(phone, code)
      navigate(from, { replace: true })
    } catch (e) {
      setError(e instanceof MemberApiError ? e.message : '登录失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-6">
      <PageHeader title="登录" subtitle="手机号验证码登录，用于保存你的简历和使用记录" />

      <Card className="mt-6 p-6">
        {/* 手机号 */}
        <label className="mb-2 block text-base font-medium text-neutral-800" htmlFor="member-phone">
          手机号
        </label>
        <div className="relative">
          <SmartphoneIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-400" />
          <input
            id="member-phone"
            type="tel"
            inputMode="numeric"
            autoComplete="off"
            maxLength={11}
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
            placeholder="请输入 11 位手机号"
            className="h-14 w-full rounded-lg border border-neutral-300 bg-white pl-12 pr-4 text-lg text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        {/* 验证码 */}
        <label className="mb-2 mt-5 block text-base font-medium text-neutral-800" htmlFor="member-code">
          验证码
        </label>
        <div className="flex gap-3">
          <input
            id="member-code"
            type="tel"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="6 位验证码"
            className="h-14 flex-1 rounded-lg border border-neutral-300 bg-white px-4 text-lg tracking-widest text-neutral-900 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <Button
            variant="outline"
            size="lg"
            className="whitespace-nowrap"
            disabled={!phoneValid || cooldown > 0 || sending}
            onClick={handleSendCode}
          >
            {cooldown > 0 ? `${cooldown}s 后重发` : sending ? '发送中…' : '获取验证码'}
          </Button>
        </div>

        {hint && <p className="mt-3 text-sm text-success">{hint}</p>}
        {error && <p className="mt-3 text-sm text-error">{error}</p>}

        <Button
          variant="primary"
          size="lg"
          className="mt-6 w-full"
          disabled={!phoneValid || !codeValid || submitting}
          onClick={handleLogin}
        >
          {submitting ? '登录中…' : '登录'}
        </Button>

        {/* 合规与隐私提示 */}
        <div className="mt-6 flex items-start gap-2 rounded-lg bg-neutral-50 p-4 text-sm text-neutral-600">
          <ShieldCheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-neutral-400" />
          <p>
            手机号仅用于登录验证，平台不向任何企业提供你的手机号或简历。公共设备使用完请点击退出登录，
            5 分钟无操作将自动退出。
          </p>
        </div>
      </Card>
    </div>
  )
}
