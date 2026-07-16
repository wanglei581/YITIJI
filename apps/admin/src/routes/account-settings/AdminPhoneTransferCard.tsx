import { useEffect, useState, type FormEvent } from 'react'
import { Button, Card } from '@ai-job-print/ui'
import { CircleAlertIcon, CircleCheckIcon } from 'lucide-react'
import {
  cancelAdminPhoneTransfer,
  redirectToLogin,
  startAdminPhoneTransfer,
  verifyAdminPhoneTransfer,
  type AdminPhoneTransferSourceAccount,
  type AuthedUser,
} from '../../services/auth'

const labelCls = 'block text-sm font-medium text-neutral-700 mb-1.5'
const inputCls = 'w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-400/20'
const CN_PHONE = /^1[3-9]\d{9}$/

type TransferPhase = 'identity' | 'confirmation' | 'complete'
type Message = { kind: 'error' | 'success'; text: string } | null

type Props = {
  onBound: (phone: Pick<AuthedUser, 'phoneMasked' | 'phoneVerifiedAt'>) => void
  onBack: () => void
}

/** Admin 从 Partner 转移手机号：密码、手机号、OTP 与 ticket 仅存在于组件内存。 */
export function AdminPhoneTransferCard({ onBound, onBack }: Props) {
  const [phase, setPhase] = useState<TransferPhase>('identity')
  const [currentPassword, setCurrentPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [bindTicket, setBindTicket] = useState<string | null>(null)
  const [sourceAccount, setSourceAccount] = useState<AdminPhoneTransferSourceAccount | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [cooldownSeconds, setCooldownSeconds] = useState(0)
  const [ticketExpiresAt, setTicketExpiresAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<Message>(null)

  function clearTransferState(): void {
    setPhase('identity')
    setCurrentPassword('')
    setPhone('')
    setCode('')
    setBindTicket(null)
    setSourceAccount(null)
    setAcknowledged(false)
    setCooldownSeconds(0)
    setTicketExpiresAt(null)
  }

  useEffect(() => {
    if (cooldownSeconds <= 0 && !ticketExpiresAt) return
    const timer = window.setInterval(() => {
      setCooldownSeconds((seconds) => Math.max(0, seconds - 1))
      setNow(Date.now())
      if (ticketExpiresAt && ticketExpiresAt <= Date.now()) {
        clearTransferState()
        setMessage({ kind: 'error', text: '验证码已过期，请重新输入当前密码和手机号发起转移。' })
      }
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [cooldownSeconds, ticketExpiresAt])

  async function requestCode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (phase !== 'identity' || bindTicket || submitting || cooldownSeconds > 0) return
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
      const result = await startAdminPhoneTransfer(currentPassword, phone)
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
          if (requiresKnownSmsCooldown(result.code)) setCooldownSeconds(60)
          setMessage({ kind: 'error', text: result.message || '短信服务暂不可用，请稍后重试' })
          return
        }
        if (result.code === 'AUTH_PHONE_TRANSFER_UNAVAILABLE') {
          setCurrentPassword('')
          setPhone('')
          setMessage({
            kind: 'error',
            text: `${result.message || '当前账号暂不可进行手机号安全转移'}。若刚才操作中断，请 5 分钟后再试。`,
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
        setMessage({ kind: 'error', text: '验证码已过期，请重新输入当前密码和手机号发起转移。' })
        return
      }

      const startedAt = Date.now()
      setPhase('confirmation')
      setBindTicket(result.bindTicket)
      setSourceAccount({ ...result.sourceAccount })
      setAcknowledged(false)
      setCooldownSeconds(result.cooldownSeconds)
      setTicketExpiresAt(startedAt + result.expiresInSeconds * 1_000)
      setNow(startedAt)
      setCurrentPassword('')
      setPhone('')
      setMessage({ kind: 'success', text: '验证码已发送；发码不代表转移已经完成，请确认影响后输入验证码。' })
    } finally {
      setSubmitting(false)
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (phase !== 'confirmation' || !bindTicket || submitting || !acknowledged) return
    setMessage(null)

    if (!ticketExpiresAt || ticketExpiresAt <= Date.now()) {
      clearTransferState()
      setMessage({ kind: 'error', text: '验证码已过期，请重新输入当前密码和手机号发起转移。' })
      return
    }
    if (!/^\d{6}$/.test(code)) {
      setMessage({ kind: 'error', text: '请输入 6 位数字验证码' })
      return
    }

    setSubmitting(true)
    try {
      const result = await verifyAdminPhoneTransfer(bindTicket, code)
      if (!result.ok) {
        if (requiresLoginAfterUncertainVerification(result.code, result.status)) {
          clearTransferState()
          redirectToLogin()
          return
        }
        if (result.code === 'AUTH_PHONE_TRANSFER_UNAVAILABLE') {
          clearTransferState()
          setMessage({ kind: 'error', text: '状态已变化，请重新开始。' })
          return
        }
        if (result.code === 'SMS_CODE_INVALID') {
          setMessage({ kind: 'error', text: result.message || '验证码不正确，请重新输入' })
          return
        }
        if (requiresRestartAfterVerificationFailure(result.code)) {
          clearTransferState()
          setMessage({ kind: 'error', text: `${result.message || '本次转移验证已失效'}，请重新发起手机号转移。` })
          return
        }
        setMessage({ kind: 'error', text: result.message || '验证失败，请稍后重试' })
        return
      }

      const bound = { phoneMasked: result.phoneMasked, phoneVerifiedAt: result.phoneVerifiedAt }
      clearTransferState()
      setPhase('complete')
      setMessage({ kind: 'success', text: `手机号 ${result.phoneMasked} 已安全转移并完成验证。` })
      onBound(bound)
    } finally {
      setSubmitting(false)
    }
  }

  async function returnToInitialBind(): Promise<void> {
    if (submitting) return
    setMessage(null)
    if (!bindTicket && cooldownSeconds > 0) {
      setMessage({ kind: 'error', text: '发送结果暂无法确认，请等待冷却结束后再返回首次绑定。' })
      return
    }
    if (!bindTicket) {
      clearTransferState()
      onBack()
      return
    }

    setSubmitting(true)
    try {
      const result = await cancelAdminPhoneTransfer(bindTicket)
      if (!result.ok) {
        if (requiresLoginAfterUncertainCancellation(result.code, result.status)) {
          clearTransferState()
          redirectToLogin()
          return
        }
        setMessage({ kind: 'error', text: result.message || '取消当前转移失败，请稍后重试。' })
        return
      }
      clearTransferState()
      onBack()
    } finally {
      setSubmitting(false)
    }
  }

  if (phase === 'complete') {
    return (
      <Card className="p-5">
        {message && <MessageNotice message={message} />}
      </Card>
    )
  }

  return (
    <Card className="p-5">
      <div className="mb-4">
        <p className="text-sm font-medium text-neutral-900">从机构账号安全转移手机号</p>
        <p className="mt-1 text-xs text-neutral-500">需要验证当前管理员密码和目标手机号验证码。</p>
        <p className="mt-1 text-xs text-neutral-500">密码、手机号、验证码和转移凭据仅保留在当前页面内存中。</p>
      </div>

      {phase === 'identity' ? (
        <form onSubmit={requestCode} className="space-y-4">
          <div>
            <label className={labelCls} htmlFor="admin-phone-transfer-current-password">当前密码</label>
            <input
              id="admin-phone-transfer-current-password"
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
            <label className={labelCls} htmlFor="admin-phone-transfer-number">手机号</label>
            <input
              id="admin-phone-transfer-number"
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
          <div className="flex gap-3">
            <Button type="button" variant="outline" disabled={submitting || cooldownSeconds > 0} onClick={returnToInitialBind} className="flex-1">
              返回首次绑定
            </Button>
            <Button type="submit" disabled={submitting || cooldownSeconds > 0} className="flex-1">
              {submitting ? '发送中…' : cooldownSeconds > 0 ? '暂不可重新发送' : '获取验证码'}
            </Button>
          </div>
        </form>
      ) : sourceAccount && bindTicket ? (
        <form onSubmit={verifyCode} className="space-y-4">
          {message && <MessageNotice message={message} />}
          <dl className="grid gap-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm">
            <div><dt className="text-xs text-neutral-500">机构账号</dt><dd className="mt-0.5 text-neutral-900">{sourceAccount.username}</dd></div>
            <div><dt className="text-xs text-neutral-500">所属机构</dt><dd className="mt-0.5 text-neutral-900">{sourceAccount.organizationName}</dd></div>
            <div><dt className="text-xs text-neutral-500">当前手机号</dt><dd className="mt-0.5 text-neutral-900">{sourceAccount.phoneMasked}</dd></div>
          </dl>
          <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-neutral-600">
            <li>该手机号将从上述机构账号转移到当前管理员账号。</li>
            <li>机构账号仍可使用用户名和密码登录。</li>
            <li>机构账号将无法再使用该手机号短信登录或找回密码。</li>
            <li>机构账号当前登录会话将失效；忘记密码时需由管理员重置。</li>
          </ul>
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-bg p-3">
            <input
              id="admin-phone-transfer-acknowledged"
              type="checkbox"
              checked={acknowledged}
              disabled={submitting}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-neutral-300"
            />
            <label htmlFor="admin-phone-transfer-acknowledged" className="text-xs leading-5 text-neutral-700">
              我已阅读并确认上述影响，同意将手机号转移到当前管理员账号。
            </label>
          </div>
          <div>
            <label className={labelCls} htmlFor="admin-phone-transfer-code">短信验证码</label>
            <input
              id="admin-phone-transfer-code"
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
            <Button type="button" variant="outline" disabled={submitting} onClick={returnToInitialBind} className="flex-1">
              返回首次绑定
            </Button>
            <Button type="submit" disabled={submitting || !acknowledged} className="flex-1">
              {submitting ? '转移中…' : '确认转移'}
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  )
}

function requiresRestartAfterVerificationFailure(code: string): boolean {
  return [
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

function requiresLoginAfterUncertainVerification(code: string, status: number): boolean {
  return requiresLoginAfterUncertainResult(code, status)
}

function requiresLoginAfterUncertainCancellation(code: string, status: number): boolean {
  return code === 'AUTH_PHONE_TRANSFER_UNAVAILABLE' || requiresLoginAfterUncertainResult(code, status)
}

function requiresLoginAfterUncertainResult(code: string, status: number): boolean {
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
