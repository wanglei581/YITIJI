import { useEffect, useState, type FormEvent } from 'react'
import { Button, Card } from '@ai-job-print/ui'
import { CircleAlertIcon, CircleCheckIcon } from 'lucide-react'
import {
  cancelAdminInitialPhoneBind,
  redirectToLogin,
  startAdminInitialPhoneBind,
  verifyAdminInitialPhoneBind,
  type AuthedUser,
} from '../../services/auth'

const labelCls = 'block text-sm font-medium text-neutral-700 mb-1.5'
const inputCls = 'w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-400/20'
const CN_PHONE = /^1[3-9]\d{9}$/

interface AdminInitialPhoneBindingCardProps {
  onBound: (phone: Pick<AuthedUser, 'phoneMasked' | 'phoneVerifiedAt'>) => void
}

type Message = { kind: 'error' | 'success'; text: string } | null

/** Admin 严格首次绑定：敏感表单字段和 ticket 只留在当前组件内存。 */
export function AdminInitialPhoneBindingCard({ onBound }: AdminInitialPhoneBindingCardProps) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [bindTicket, setBindTicket] = useState<string | null>(null)
  const [cooldownSeconds, setCooldownSeconds] = useState(0)
  const [ticketExpiresAt, setTicketExpiresAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<Message>(null)

  function clearVerificationState(): void {
    setBindTicket(null)
    setTicketExpiresAt(null)
    setCode('')
    setCooldownSeconds(0)
  }

  useEffect(() => {
    if (cooldownSeconds <= 0 && !ticketExpiresAt) return
    const timer = window.setInterval(() => {
      setCooldownSeconds((seconds) => Math.max(0, seconds - 1))
      setNow(Date.now())
      if (ticketExpiresAt && ticketExpiresAt <= Date.now()) {
        clearVerificationState()
        setMessage({ kind: 'error', text: '验证码已过期，请重新填写当前密码和手机号获取验证码。' })
      }
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [cooldownSeconds, ticketExpiresAt])

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (bindTicket || submitting || cooldownSeconds > 0) return
    setMessage(null)

    if (!currentPassword) {
      setMessage({ kind: 'error', text: '请输入当前密码以确认本人身份' })
      return
    }
    if (!CN_PHONE.test(phone)) {
      setMessage({ kind: 'error', text: '请输入有效的中国大陆手机号' })
      return
    }

    setSubmitting(true)
    try {
      const result = await startAdminInitialPhoneBind(currentPassword, phone)
      if (!result.ok) {
        if (requiresConservativeStartCooldown(result.code, result.status)) {
          setCurrentPassword('')
          setPhone('')
          setCooldownSeconds(300)
          setMessage({ kind: 'error', text: '发送结果暂无法确认，为避免重复发送，请等待 5 分钟后重试。' })
          return
        }
        if (isActionableSmsFailure(result.code)) {
          setCurrentPassword('')
          setPhone('')
          if (requiresKnownSmsCooldown(result.code)) {
            setCooldownSeconds(60)
          }
          setMessage({ kind: 'error', text: result.message || '短信服务暂不可用，请稍后重试' })
          return
        }
        if (result.code === 'AUTH_INITIAL_PHONE_BIND_UNAVAILABLE') {
          setCurrentPassword('')
          setPhone('')
          setMessage({
            kind: 'error',
            text: `${result.message || '当前账号暂不可进行首次手机号绑定'}。若刚才操作中断，请 5 分钟后再试。`,
          })
          return
        }
        setMessage({ kind: 'error', text: result.message || '验证码发送失败，请稍后重试' })
        return
      }

      if (result.expiresInSeconds === 0) {
        setCurrentPassword('')
        setPhone('')
        setCooldownSeconds(result.cooldownSeconds)
        setMessage({ kind: 'error', text: '验证码已过期，请重新填写当前密码和手机号获取验证码。' })
        return
      }

      setBindTicket(result.bindTicket)
      setCooldownSeconds(result.cooldownSeconds)
      const startedAt = Date.now()
      setNow(startedAt)
      setTicketExpiresAt(startedAt + result.expiresInSeconds * 1_000)
      setCurrentPassword('')
      setPhone('')
      setMessage({ kind: 'success', text: '验证码已发送，请查收短信。' })
    } finally {
      setSubmitting(false)
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!bindTicket || submitting) return
    setMessage(null)

    if (!ticketExpiresAt || ticketExpiresAt <= Date.now()) {
      clearVerificationState()
      setMessage({ kind: 'error', text: '验证码已过期，请重新填写当前密码和手机号获取验证码。' })
      return
    }
    if (!/^\d{6}$/.test(code)) {
      setMessage({ kind: 'error', text: '请输入 6 位数字验证码' })
      return
    }

    setSubmitting(true)
    try {
      const result = await verifyAdminInitialPhoneBind(bindTicket, code)
      if (!result.ok) {
        if (requiresLoginAfterUncertainVerification(result.code, result.status)) {
          clearVerificationState()
          redirectToLogin()
          return
        }
        if (requiresRestartAfterVerificationFailure(result.code)) {
          clearVerificationState()
          setMessage({ kind: 'error', text: `${result.message || '本次绑定验证已失效'}，请重新填写当前密码和手机号获取验证码。` })
          return
        }
        setMessage({ kind: 'error', text: result.message || '验证失败，请稍后重试' })
        return
      }

      clearVerificationState()
      onBound({ phoneMasked: result.phoneMasked, phoneVerifiedAt: result.phoneVerifiedAt })
    } finally {
      setSubmitting(false)
    }
  }

  async function restart(): Promise<void> {
    if (submitting) return
    setMessage(null)
    if (!bindTicket) {
      setCurrentPassword('')
      setPhone('')
      clearVerificationState()
      return
    }

    setSubmitting(true)
    try {
      const result = await cancelAdminInitialPhoneBind(bindTicket)
      if (!result.ok) {
        if (requiresLoginAfterUncertainCancellation(result.code, result.status)) {
          clearVerificationState()
          redirectToLogin()
          return
        }
        setMessage({ kind: 'error', text: result.message || '取消当前验证失败，请稍后重试。' })
        return
      }
      setCurrentPassword('')
      setPhone('')
      clearVerificationState()
    } finally {
      setSubmitting(false)
    }
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
            <label className={labelCls} htmlFor="admin-initial-phone-current-password">当前密码</label>
            <input
              id="admin-initial-phone-current-password"
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
            <label className={labelCls} htmlFor="admin-initial-phone-number">手机号</label>
            <input
              id="admin-initial-phone-number"
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
          {message && <MessageNotice message={message} />}
          {cooldownSeconds > 0 && <p className="text-xs text-neutral-500">请等待 {cooldownSeconds} 秒后重试。</p>}
          <Button type="submit" disabled={submitting || cooldownSeconds > 0} className="w-full">
            {submitting ? '发送中…' : cooldownSeconds > 0 ? '暂不可重新发送' : '获取验证码'}
          </Button>
        </form>
      ) : (
        <form onSubmit={verifyCode} className="space-y-4">
          {message && <MessageNotice message={message} />}
          <div>
            <label className={labelCls} htmlFor="admin-initial-phone-code">短信验证码</label>
            <input
              id="admin-initial-phone-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className={inputCls}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              required
            />
            {ticketExpiresAt && (
              <p className="mt-1.5 text-xs text-neutral-500">验证码将在 {Math.max(0, Math.ceil((ticketExpiresAt - now) / 1_000))} 秒后失效。</p>
            )}
          </div>
          <div className="flex gap-3">
            <Button type="button" variant="outline" disabled={submitting} onClick={restart} className="flex-1">重新填写</Button>
            <Button type="submit" disabled={submitting} className="flex-1">{submitting ? '验证中…' : '确认绑定'}</Button>
          </div>
        </form>
      )}
    </Card>
  )
}

function requiresRestartAfterVerificationFailure(code: string): boolean {
  return [
    'AUTH_INITIAL_PHONE_BIND_UNAVAILABLE',
    'SMS_CODE_EXPIRED',
    'SMS_CODE_LOCKED',
    'PHONE_BIND_TICKET_INVALID',
    'PHONE_BIND_CONFLICT',
    'PHONE_ALREADY_BOUND',
    'PHONE_SELF_ALREADY_BOUND',
  ].includes(code)
}

function requiresConservativeStartCooldown(code: string, status: number): boolean {
  return status === 0 || code === 'INVALID_RESPONSE' || status >= 500
}

function isActionableSmsFailure(code: string): boolean {
  return [
    'SMS_TOO_FREQUENT',
    'SMS_DAILY_LIMIT',
    'SMS_IP_LIMIT',
    'SMS_DEVICE_LIMIT',
    'SMS_PROVIDER_PHONE_DAILY_LIMIT',
    'SMS_PROVIDER_RATE_LIMIT',
  ].includes(code)
}

function requiresKnownSmsCooldown(code: string): boolean {
  return (
    code === 'SMS_TOO_FREQUENT' ||
    code === 'SMS_IP_LIMIT' ||
    code === 'SMS_DEVICE_LIMIT' ||
    code === 'SMS_PROVIDER_RATE_LIMIT'
  )
}

/** 验证请求可能已在服务端消费 ticket；重新登录才能以真实 LoginResult 恢复绑定状态。 */
function requiresLoginAfterUncertainVerification(code: string, status: number): boolean {
  return (
    status === 0 ||
    status === 401 ||
    status === 403 ||
    status >= 500 ||
    code === 'NETWORK_ERROR' ||
    code === 'INVALID_RESPONSE' ||
    code === 'AUTH_SESSION_INVALID' ||
    code === 'AUTH_TOKEN_INVALID' ||
    code === 'AUTH_MISSING_TOKEN'
  )
}

/** 取消请求未被明确确认时，不能假定服务端 ticket 已失效，改由重新登录恢复真实状态。 */
function requiresLoginAfterUncertainCancellation(code: string, status: number): boolean {
  return (
    status === 0 ||
    status === 401 ||
    status === 403 ||
    status >= 500 ||
    code === 'NETWORK_ERROR' ||
    code === 'INVALID_RESPONSE' ||
    code === 'AUTH_INITIAL_PHONE_BIND_UNAVAILABLE' ||
    code === 'AUTH_SESSION_INVALID' ||
    code === 'AUTH_TOKEN_INVALID' ||
    code === 'AUTH_MISSING_TOKEN'
  )
}

function MessageNotice({ message }: { message: Exclude<Message, null> }) {
  const isError = message.kind === 'error'
  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live="polite"
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${isError ? 'border-error/30 bg-error-bg text-error-fg' : 'border-success/30 bg-success-bg text-success-fg'}`}
    >
      {isError
        ? <CircleAlertIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
        : <CircleCheckIcon className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span>{message.text}</span>
    </div>
  )
}
