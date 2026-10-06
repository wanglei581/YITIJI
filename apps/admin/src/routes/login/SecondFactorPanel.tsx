// 管理员登录第二步：账号密码通过后，输入发到绑定手机号的短信验证码（P1-4，2026-09-29）。
//
// 只在服务端开启 ADMIN_LOGIN_SECOND_FACTOR=sms 时出现。换凭证 POST /auth/login/second-factor，
// 重发 POST /auth/login/second-factor/resend。凭证作废、开关关闭、账号没绑手机、网络不在名单内时
// 回到账号密码并如实说明原因；验证码错 / 过期 / 被锁时留在本步，改码或重发即可。

import { useEffect, useState, type FormEvent } from 'react'
import { MessageSquareTextIcon, ShieldCheckIcon } from 'lucide-react'
import { type AuthedUser, completeAdminSecondFactor, resendAdminSecondFactor } from '../../services/auth'
import {
  type AdminSecondFactorChallenge,
  secondFactorFailureAction,
  secondFactorFallbackMessage,
} from '../../services/auth/secondFactor'
import { ErrorBar, LoadingDots } from './LoginBits'
import { userMessageOf } from '../../services/api/userErrorMessage'

interface Props {
  challenge: AdminSecondFactorChallenge
  onSuccess: (user: AuthedUser) => void
  /** 回到账号密码；message 为空表示用户主动返回。 */
  onRestart: (message: string | null) => void
}

function useSecondsLeft(deadline: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  return Math.max(0, Math.ceil((deadline - now) / 1000))
}

function formatMinutes(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function SecondFactorPanel({ challenge, onSuccess, onRestart }: Props) {
  const [expiresAt] = useState(() => Date.now() + challenge.expiresInSeconds * 1000)
  const [resendAt, setResendAt] = useState(() => Date.now() + challenge.cooldownSeconds * 1000)
  const [codeSent, setCodeSent] = useState(challenge.codeSent)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [resending, setResending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const expiresIn = useSecondsLeft(expiresAt)
  const resendIn = useSecondsLeft(resendAt)

  useEffect(() => {
    if (expiresIn === 0) onRestart('本次验证已超时，请重新输入账号密码')
  }, [expiresIn, onRestart])

  function handleFailure(failure: { code: string; message: string }) {
    const message = userMessageOf(failure, secondFactorFallbackMessage(failure.code))
    if (secondFactorFailureAction(failure.code) === 'retry') {
      setError(message)
      return
    }
    onRestart(message)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy || code.length !== 6) return
    setBusy(true)
    setError(null)
    const r = await completeAdminSecondFactor(challenge.challengeTicket, code)
    setBusy(false)
    if (r.ok && 'user' in r) {
      onSuccess(r.user)
      return
    }
    if (!r.ok) {
      setCode('')
      handleFailure(r)
      return
    }
    onRestart('登录响应无效，请重新输入账号密码')
  }

  async function resend() {
    if (resending || resendIn > 0) return
    setResending(true)
    setError(null)
    setNotice(null)
    const r = await resendAdminSecondFactor(challenge.challengeTicket)
    setResending(false)
    if (!r.ok) {
      handleFailure(r)
      return
    }
    setResendAt(Date.now() + (r.cooldownSeconds || 60) * 1000)
    setCodeSent(r.codeSent || codeSent)
    setNotice(r.codeSent ? `新的验证码已发送至 ${challenge.phoneMasked}` : '该号码刚收到过验证码，请使用最近一条短信中的验证码，或稍后再重新发送')
  }

  return (
    <form className="c-pane c-2fa" onSubmit={submit} aria-label="短信第二步验证">
      <div className="c-hint" role="status">
        <ShieldCheckIcon size={14} aria-hidden="true" />
        {codeSent
          ? `账号密码已通过，验证码已发送至 ${challenge.phoneMasked}`
          : `账号密码已通过。${challenge.phoneMasked} 刚收到过验证码，可直接使用最近一条短信中的验证码，或倒计时结束后重新发送`}
      </div>
      <div className="c-field">
        <label htmlFor="admin-2fa-code">
          <b className="fno">03</b>短信验证码
        </label>
        <div className="c-inputwrap">
          <MessageSquareTextIcon className="lead" size={18} aria-hidden="true" />
          <input
            id="admin-2fa-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="6 位数字验证码"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            autoFocus
            required
          />
          <button type="button" className="c-send" onClick={() => void resend()} disabled={resending || resendIn > 0}>
            {resendIn > 0 ? `${resendIn}s 后重发` : '重新发送'}
          </button>
        </div>
      </div>
      {notice && !error && (
        <div className="c-hint" role="status">
          <ShieldCheckIcon size={14} aria-hidden="true" />
          {notice}
        </div>
      )}
      {error && <ErrorBar message={error} />}
      <button type="submit" className={`c-cta ripple-host${busy ? ' loading' : ''}`} disabled={busy || code.length !== 6}>
        <span className="label">确认登录</span>
        <LoadingDots />
      </button>
      <div className="c-row2">
        <span className="c-2fa-expiry">本次验证 {formatMinutes(expiresIn)} 内有效</span>
        <button type="button" className="c-forgot" onClick={() => onRestart(null)}>
          返回重新输入账号密码
        </button>
      </div>
    </form>
  )
}
