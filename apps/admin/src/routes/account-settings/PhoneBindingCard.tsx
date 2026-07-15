import { useEffect, useState, type FormEvent } from 'react'
import { Button, Card } from '@ai-job-print/ui'
import { CircleAlertIcon, CircleCheckIcon } from 'lucide-react'
import {
  completeInitialPhoneBind,
  mergeStoredUser,
  redirectToLogin,
  startInitialPhoneBind,
  type AuthedUser,
} from '../../services/auth'

const labelCls = 'block text-sm font-medium text-neutral-700 mb-1.5'
const inputCls = 'w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-400/20'
const CN_PHONE = /^1[3-9]\d{9}$/

interface PhoneBindingCardProps {
  onBound: (phone: Pick<AuthedUser, 'phoneMasked' | 'phoneVerifiedAt'>) => void
}

/**
 * 首次绑定的密码、手机号、验证码和 ticket 仅保留在本组件内存。
 * 成功后只把脱敏展示字段交给现有会话存储与父页面。
 */
export function PhoneBindingCard({ onBound }: PhoneBindingCardProps) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [bindTicket, setBindTicket] = useState<string | null>(null)
  const [cooldownSeconds, setCooldownSeconds] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    if (cooldownSeconds <= 0) return
    const timer = window.setInterval(() => setCooldownSeconds((seconds) => Math.max(0, seconds - 1)), 1_000)
    return () => window.clearInterval(timer)
  }, [cooldownSeconds])

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setError(null)
    setSent(false)
    if (!currentPassword) {
      setError('请输入当前密码以确认本人身份')
      return
    }
    if (!CN_PHONE.test(phone)) {
      setError('请输入有效的中国大陆手机号')
      return
    }

    setSubmitting(true)
    try {
      const result = await startInitialPhoneBind(currentPassword, phone)
      if (!result.ok) {
        setError(result.message || '验证码发送失败，请稍后重试')
        return
      }
      setBindTicket(result.bindTicket)
      setCooldownSeconds(result.cooldownSeconds)
      setCurrentPassword('')
      setPhone('')
      setSent(true)
    } finally {
      setSubmitting(false)
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!bindTicket || submitting) return
    setError(null)
    if (!/^\d{6}$/.test(code)) {
      setError('请输入 6 位数字验证码')
      return
    }

    setSubmitting(true)
    try {
      const result = await completeInitialPhoneBind(bindTicket, code)
      if (!result.ok) {
        if (requiresSessionRenewal(result.code)) {
          restart()
          redirectToLogin()
          return
        }
        if (requiresRestartAfterVerificationFailure(result.code)) {
          setBindTicket(null)
          setCode('')
          setCooldownSeconds(0)
          setSent(false)
          setError(`${result.message || '本次绑定验证已失效'}，请重新填写当前密码和手机号获取验证码。`)
          return
        }
        setError(result.message || '验证失败，请稍后重试')
        return
      }
      const bound = { phoneMasked: result.phoneMasked, phoneVerifiedAt: result.phoneVerifiedAt }
      mergeStoredUser(bound)
      setCurrentPassword('')
      setPhone('')
      setCode('')
      setBindTicket(null)
      onBound(bound)
    } finally {
      setSubmitting(false)
    }
  }

  function restart(): void {
    if (submitting) return
    setCurrentPassword('')
    setPhone('')
    setCode('')
    setBindTicket(null)
    setCooldownSeconds(0)
    setError(null)
    setSent(false)
  }

  return (
    <Card className="p-5">
      <div className="mb-4">
        <p className="text-sm font-medium text-neutral-900">绑定手机号</p>
        <p className="mt-1 text-xs text-neutral-500">绑定手机号后，可用于短信登录和忘记密码。</p>
        <p className="mt-1 text-xs text-neutral-500">验证码、密码和绑定凭据不会保存到本机。</p>
      </div>

      {!bindTicket ? (
        <form onSubmit={requestCode} className="space-y-4">
          <div>
            <label className={labelCls} htmlFor="initial-phone-current-password">当前密码</label>
            <input
              id="initial-phone-current-password"
              type="password"
              autoComplete="current-password"
              maxLength={72}
              className={inputCls}
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="initial-phone-number">手机号</label>
            <input
              id="initial-phone-number"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              maxLength={11}
              className={inputCls}
              value={phone}
              onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 11))}
              required
            />
          </div>
          {error && <ErrorMessage message={error} />}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? '发送中…' : '获取验证码'}
          </Button>
        </form>
      ) : (
        <form onSubmit={verifyCode} className="space-y-4">
          <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-lg border border-success/30 bg-success-bg px-3 py-2 text-sm text-success-fg">
            <CircleCheckIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{sent ? '验证码已发送，请查收短信。' : '请输入短信验证码完成绑定。'}</span>
          </div>
          <div>
            <label className={labelCls} htmlFor="initial-phone-code">短信验证码</label>
            <input
              id="initial-phone-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className={inputCls}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              required
            />
            {cooldownSeconds > 0 && <p className="mt-1.5 text-xs text-neutral-500">{cooldownSeconds} 秒后可重新获取验证码。</p>}
          </div>
          {error && <ErrorMessage message={error} />}
          <div className="flex gap-3">
            <Button type="button" variant="outline" disabled={submitting} onClick={restart} className="flex-1">重新填写</Button>
            <Button type="submit" disabled={submitting} className="flex-1">{submitting ? '验证中…' : '确认绑定'}</Button>
          </div>
        </form>
      )}
    </Card>
  )
}

/** 后端已消费 ticket 的错误不能留在验证码页，避免让用户做无效重试。 */
function requiresRestartAfterVerificationFailure(code: string): boolean {
  return [
    'SMS_CODE_INVALID',
    'SMS_CODE_EXPIRED',
    'SMS_CODE_LOCKED',
    'PHONE_BIND_TICKET_INVALID',
    'PHONE_BIND_CONFLICT',
    'PHONE_ALREADY_BOUND',
    'PHONE_SELF_ALREADY_BOUND',
  ].includes(code)
}

/** ticket 已消费后若服务端判定会话失效，应立即清理本地状态并重新登录。 */
function requiresSessionRenewal(code: string): boolean {
  return code === 'AUTH_SESSION_INVALID'
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-center gap-2 rounded-lg border border-error/30 bg-error-bg px-3 py-2 text-sm text-error-fg">
      <CircleAlertIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  )
}
