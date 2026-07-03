// Admin 登录页 — 密码 / 短信验证码双模式 + 找回密码 + 登录后手机号本人验证
//
// 接口接线（保持不变）：
//   密码登录 POST /auth/login · 发码 POST /auth/sms-code · 短信登录 POST /auth/login/sms
//   找回密码 POST /auth/password/reset/{start,verify,complete}
//   本人验证 POST /auth/phone/{code,verify}
// 协议勾选未通过时阻断登录 / 发码。视觉对齐 login-trio-v1 原型 ②（样式见 ./login.css）。

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CheckIcon,
  CircleAlertIcon,
  EyeIcon,
  EyeOffIcon,
  LockKeyholeIcon,
  MessageSquareTextIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  UserRoundIcon,
  XIcon,
} from 'lucide-react'
import {
  type AuthedUser,
  completePasswordReset,
  getToken,
  login,
  loginWithSms,
  sendLoginSmsCode,
  sendOwnPhoneCode,
  startPasswordReset,
  verifyOwnPhone,
  verifyPasswordReset,
} from '../../services/auth'
import { LegalDocsModal, type LegalDocKind } from './LegalDocsModal'
import './login.css'

type LoginMode = 'password' | 'sms'
type ResetStep = 'identity' | 'code' | 'password'

const REMEMBER_KEY = 'admin_login_prefill_v1'
const SUCCESS_OVERLAY_MS = 900

function useCountdown() {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (seconds <= 0) return undefined
    const timer = window.setTimeout(() => setSeconds((v) => Math.max(0, v - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [seconds])
  return { seconds, start: setSeconds }
}

function readRememberedLoginId(): string {
  try {
    return localStorage.getItem(REMEMBER_KEY) ?? ''
  } catch {
    return ''
  }
}

function persistRememberedLoginId(remember: boolean, loginId: string): void {
  try {
    if (remember && loginId) localStorage.setItem(REMEMBER_KEY, loginId)
    else localStorage.removeItem(REMEMBER_KEY)
  } catch {
    /* ignore */
  }
}

/** 触控涟漪：命中 .ripple-host 的元素按压时扩散水纹（纯视觉，事件委托） */
function useRipple(rootRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null
      const host = target?.closest?.('.ripple-host') as HTMLElement | null
      if (!host || (host as HTMLButtonElement).disabled) return
      const rect = host.getBoundingClientRect()
      const rip = document.createElement('span')
      rip.className = 'ripple'
      const size = Math.max(rect.width, rect.height) * 1.6
      rip.style.width = `${size}px`
      rip.style.height = `${size}px`
      rip.style.left = `${e.clientX - rect.left - size / 2}px`
      rip.style.top = `${e.clientY - rect.top - size / 2}px`
      host.appendChild(rip)
      window.setTimeout(() => rip.remove(), 540)
    }
    root.addEventListener('pointerdown', onDown)
    return () => root.removeEventListener('pointerdown', onDown)
  }, [rootRef])
}

export default function LoginPage() {
  const nav = useNavigate()
  const smsCountdown = useCountdown()
  const resetCountdown = useCountdown()
  const phoneVerifyCountdown = useCountdown()
  const rootRef = useRef<HTMLElement>(null)
  useRipple(rootRef)

  const [mode, setMode] = useState<LoginMode>('password')
  const [agreed, setAgreed] = useState(false)
  const [remember, setRemember] = useState(() => readRememberedLoginId() !== '')
  const [loginId, setLoginId] = useState(() => readRememberedLoginId())
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shaking, setShaking] = useState(false)
  const [successVisible, setSuccessVisible] = useState(false)
  const [legalDoc, setLegalDoc] = useState<LegalDocKind | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetStep, setResetStep] = useState<ResetStep>('identity')
  const [resetIdentity, setResetIdentity] = useState('')
  const [resetCode, setResetCode] = useState('')
  const [resetTicket, setResetTicket] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [resetError, setResetError] = useState<string | null>(null)
  const [phoneVerifyUser, setPhoneVerifyUser] = useState<AuthedUser | null>(null)
  const [phoneVerifyCode, setPhoneVerifyCode] = useState('')
  const [phoneVerifyError, setPhoneVerifyError] = useState<string | null>(null)
  const [phoneVerifyBusy, setPhoneVerifyBusy] = useState(false)

  useEffect(() => {
    if (getToken()) nav('/', { replace: true })
  }, [nav])

  const raiseError = useCallback((message: string) => {
    setError(message)
    setShaking(true)
    window.setTimeout(() => setShaking(false), 400)
  }, [])

  function requireAgreement(setter: (message: string) => void): boolean {
    if (agreed) return true
    setter('请先阅读并同意用户服务协议和隐私政策')
    return false
  }

  /** 登录成功统一收口：记住账号 → 手机号未验证先弹本人验证，否则播过场进工作台 */
  function completeLogin(user: AuthedUser, usedLoginId: string) {
    persistRememberedLoginId(remember, usedLoginId)
    if (user.phoneMasked && !user.phoneVerifiedAt) {
      setPhoneVerifyUser(user)
      setPhoneVerifyCode('')
      setPhoneVerifyError(null)
      return
    }
    setSuccessVisible(true)
    window.setTimeout(() => nav('/', { replace: true }), SUCCESS_OVERLAY_MS)
  }

  async function submitPassword(e: FormEvent) {
    e.preventDefault()
    if (loading) return
    if (!requireAgreement(raiseError)) return
    setLoading(true)
    setError(null)
    const r = await login(loginId.trim(), password)
    setLoading(false)
    if (r.ok) completeLogin(r.user, loginId.trim())
    else raiseError(r.message || '登录失败')
  }

  async function submitSms(e: FormEvent) {
    e.preventDefault()
    if (loading) return
    if (!requireAgreement(raiseError)) return
    setLoading(true)
    setError(null)
    const r = await loginWithSms(phone.trim(), code.trim())
    setLoading(false)
    if (r.ok) completeLogin(r.user, phone.trim())
    else raiseError(r.message || '登录失败')
  }

  async function sendCode() {
    if (smsCountdown.seconds > 0 || phone.trim().length !== 11) return
    if (!requireAgreement(raiseError)) return
    setError(null)
    const r = await sendLoginSmsCode(phone.trim())
    if (r.ok) smsCountdown.start(r.cooldownSeconds || 60)
    else raiseError(r.message || '验证码发送失败')
  }

  async function startReset(e: FormEvent) {
    e.preventDefault()
    setResetError(null)
    if (!requireAgreement(setResetError)) return
    const r = await startPasswordReset(resetIdentity.trim())
    if (!r.ok) {
      setResetError(r.message || '验证码发送失败')
      return
    }
    resetCountdown.start(r.cooldownSeconds || 60)
    setResetStep('code')
  }

  async function verifyReset(e: FormEvent) {
    e.preventDefault()
    setResetError(null)
    const r = await verifyPasswordReset(resetIdentity.trim(), resetCode.trim())
    if (!r.ok) {
      setResetError(r.message || '验证码校验失败')
      return
    }
    setResetTicket(r.resetTicket)
    setResetStep('password')
  }

  async function completeReset(e: FormEvent) {
    e.preventDefault()
    setResetError(null)
    const r = await completePasswordReset(resetTicket, newPassword)
    if (!r.ok) {
      setResetError(r.message || '密码重置失败')
      return
    }
    setResetOpen(false)
    setMode('password')
    setLoginId(resetIdentity)
    setPassword('')
  }

  async function sendPhoneVerificationCode() {
    if (!phoneVerifyUser || phoneVerifyCountdown.seconds > 0 || phoneVerifyBusy) return
    setPhoneVerifyBusy(true)
    setPhoneVerifyError(null)
    const r = await sendOwnPhoneCode()
    setPhoneVerifyBusy(false)
    if (r.ok) phoneVerifyCountdown.start(r.cooldownSeconds || 60)
    else setPhoneVerifyError(r.message || '验证码发送失败')
  }

  async function confirmPhoneVerification(e: FormEvent) {
    e.preventDefault()
    if (!phoneVerifyUser || phoneVerifyBusy || phoneVerifyCode.length !== 6) return
    setPhoneVerifyBusy(true)
    setPhoneVerifyError(null)
    const r = await verifyOwnPhone(phoneVerifyCode)
    setPhoneVerifyBusy(false)
    if (r.ok) {
      setPhoneVerifyUser(null)
      setSuccessVisible(true)
      window.setTimeout(() => nav('/', { replace: true }), SUCCESS_OVERLAY_MS)
    } else setPhoneVerifyError(r.message || '手机号验证失败')
  }

  function openReset() {
    setResetOpen(true)
    setResetStep('identity')
    setResetError(null)
    setResetCode('')
    setResetTicket('')
    setNewPassword('')
  }

  return (
    <main className="clogin" ref={rootRef}>
      <aside className="c-left">
        <span className="deco-ring" />
        <span className="vert">值守 · 审核 · 运营</span>
        <div className="c-brand">
          <div className="c-logo">
            <ShieldCheckIcon size={25} aria-hidden="true" />
          </div>
          <div>
            <strong>AI求职打印一体机</strong>
            <span>管理员后台 · Admin Console</span>
          </div>
        </div>
        <div className="c-tagline">
          <h1 className="serif">
            值守每一台终端，
            <br />
            看清每一次<em>服务</em>
          </h1>
          <p>终端与打印机状态、订单与文件、岗位与招聘会信息源审核、告警与日志审计，都从这里开始。</p>
        </div>
        <div className="c-illus">
          <svg className="c-flow" viewBox="0 0 470 230" aria-hidden="true">
            <circle className="mv" r="3.5" style={{ offsetPath: "path('M430 30 C 330 40, 250 90, 150 150')" }} />
            <circle className="mv d2" r="3.5" style={{ offsetPath: "path('M450 110 C 370 120, 280 150, 160 180')" }} />
            <circle className="mv d3" r="3" style={{ offsetPath: "path('M430 70 C 340 80, 260 120, 155 165')" }} />
            <path d="M430 30 C 330 40, 250 90, 150 150" />
            <path d="M450 110 C 370 120, 280 150, 160 180" />
            <path d="M430 70 C 340 80, 260 120, 155 165" />
          </svg>
          <div className="c-kioskshape">
            <div className="screen" />
            <span className="beam" />
            <div className="stand" />
            <div className="base" />
          </div>
        </div>
      </aside>

      <section className="c-right">
        <div className={`c-card${shaking ? ' shake' : ''}`}>
          <div className="folio">
            <span>
              <b>管理员登录</b>
            </span>
            <span>操作留痕 · 审计可查</span>
          </div>
          <h2 className="serif">管理员登录</h2>
          <p className="sub">支持账号或手机号登录，登录行为将记录审计日志</p>

          <div className="c-mode">
            <button
              type="button"
              className={`ripple-host${mode === 'password' ? ' on' : ''}`}
              onClick={() => {
                setMode('password')
                setError(null)
              }}
            >
              密码登录
            </button>
            <button
              type="button"
              className={`ripple-host${mode === 'sms' ? ' on' : ''}`}
              onClick={() => {
                setMode('sms')
                setError(null)
              }}
            >
              验证码登录
            </button>
          </div>

          {mode === 'password' ? (
            <form className="c-pane" onSubmit={submitPassword}>
              <div className="c-field">
                <label htmlFor="admin-login-id">
                  <b className="fno">01</b>账号 / 手机号
                </label>
                <div className="c-inputwrap">
                  <UserRoundIcon className="lead" size={18} aria-hidden="true" />
                  <input
                    id="admin-login-id"
                    type="text"
                    placeholder="请输入管理员账号或手机号"
                    autoComplete="username"
                    value={loginId}
                    onChange={(e) => setLoginId(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="c-field">
                <label htmlFor="admin-password">
                  <b className="fno">02</b>密码
                </label>
                <div className="c-inputwrap">
                  <LockKeyholeIcon className="lead" size={18} aria-hidden="true" />
                  <input
                    id="admin-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="请输入密码"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="c-eye"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                  >
                    {showPassword ? <EyeOffIcon size={18} aria-hidden="true" /> : <EyeIcon size={18} aria-hidden="true" />}
                  </button>
                </div>
              </div>
              <div className="c-row2">
                <button
                  type="button"
                  className={`c-remember${remember ? ' checked' : ''}`}
                  onClick={() => setRemember((v) => !v)}
                  role="checkbox"
                  aria-checked={remember}
                >
                  <span className="box">
                    <CheckIcon size={13} aria-hidden="true" />
                  </span>
                  记住账号
                </button>
                <button type="button" className="c-forgot" onClick={openReset}>
                  忘记密码？找回 / 重置
                </button>
              </div>
              <AgreementRow agreed={agreed} onToggle={() => setAgreed((v) => !v)} onOpenDoc={setLegalDoc} />
              {error && <ErrorBar message={error} />}
              <button type="submit" className={`c-cta ripple-host${loading ? ' loading' : ''}`} disabled={loading}>
                <span className="label">登 录</span>
                <LoadingDots />
              </button>
            </form>
          ) : (
            <form className="c-pane" onSubmit={submitSms}>
              <div className="c-field">
                <label htmlFor="admin-sms-phone">
                  <b className="fno">01</b>手机号
                </label>
                <div className="c-inputwrap">
                  <SmartphoneIcon className="lead" size={18} aria-hidden="true" />
                  <input
                    id="admin-sms-phone"
                    type="text"
                    inputMode="numeric"
                    placeholder="请输入账号绑定的手机号"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                    required
                  />
                </div>
              </div>
              <div className="c-field">
                <label htmlFor="admin-sms-code">
                  <b className="fno">02</b>短信验证码
                </label>
                <div className="c-inputwrap">
                  <MessageSquareTextIcon className="lead" size={18} aria-hidden="true" />
                  <input
                    id="admin-sms-code"
                    type="text"
                    inputMode="numeric"
                    placeholder="6 位数字，5 分钟内有效"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    required
                  />
                  <button
                    type="button"
                    className="c-send"
                    onClick={() => void sendCode()}
                    disabled={smsCountdown.seconds > 0 || phone.length !== 11}
                  >
                    {smsCountdown.seconds > 0 ? `${smsCountdown.seconds}s 后重发` : '获取验证码'}
                  </button>
                </div>
              </div>
              <div className="c-hint">
                <ShieldCheckIcon size={14} aria-hidden="true" />
                验证码登录仅支持已完成本人验证手机号的管理员账号
              </div>
              <AgreementRow agreed={agreed} onToggle={() => setAgreed((v) => !v)} onOpenDoc={setLegalDoc} />
              {error && <ErrorBar message={error} />}
              <button
                type="submit"
                className={`c-cta ripple-host${loading ? ' loading' : ''}`}
                disabled={loading || code.length !== 6}
              >
                <span className="label">登 录</span>
                <LoadingDots />
              </button>
            </form>
          )}

          <div className="c-cardfoot">
            <span>无法登录？联系超级管理员协助处理</span>
            <span>验证码 5 分钟内有效</span>
          </div>
        </div>
        <div className="c-legal">仅限授权运营人员使用 · 所有操作均有日志审计 · © 2026 AI求职打印服务终端</div>
      </section>

      {resetOpen && (
        <div className="c-modal" role="dialog" aria-modal="true" aria-label="找回密码">
          <div className="c-modal-card">
            <div className="c-modal-head">
              <div>
                <h3>找回密码</h3>
                <p>验证账号绑定的手机号后设置新密码</p>
              </div>
              <button type="button" className="close-btn" onClick={() => setResetOpen(false)} aria-label="关闭">
                <XIcon size={18} aria-hidden="true" />
              </button>
            </div>

            {resetStep === 'identity' && (
              <form onSubmit={startReset}>
                <div className="c-field">
                  <label htmlFor="admin-reset-identity">
                    <b className="fno">01</b>账号 / 手机号
                  </label>
                  <div className="c-inputwrap">
                    <UserRoundIcon className="lead" size={18} aria-hidden="true" />
                    <input
                      id="admin-reset-identity"
                      type="text"
                      placeholder="请输入账号或绑定手机号"
                      value={resetIdentity}
                      onChange={(e) => setResetIdentity(e.target.value)}
                      required
                    />
                  </div>
                </div>
                <AgreementRow agreed={agreed} onToggle={() => setAgreed((v) => !v)} onOpenDoc={setLegalDoc} />
                {resetError && <ErrorBar message={resetError} />}
                <button type="submit" className="c-cta ripple-host">
                  <span className="label">发送验证码</span>
                </button>
              </form>
            )}

            {resetStep === 'code' && (
              <form onSubmit={verifyReset}>
                <div className="c-field">
                  <label htmlFor="admin-reset-code">
                    <b className="fno">02</b>短信验证码
                  </label>
                  <div className="c-inputwrap">
                    <MessageSquareTextIcon className="lead" size={18} aria-hidden="true" />
                    <input
                      id="admin-reset-code"
                      type="text"
                      inputMode="numeric"
                      placeholder="6 位数字，5 分钟内有效"
                      value={resetCode}
                      onChange={(e) => setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      required
                    />
                  </div>
                </div>
                {resetError && <ErrorBar message={resetError} />}
                <button type="submit" className="c-cta ripple-host">
                  <span className="label">校验验证码</span>
                </button>
                <button
                  type="button"
                  className="c-resend"
                  disabled={resetCountdown.seconds > 0}
                  onClick={() =>
                    void startPasswordReset(resetIdentity).then((r) => {
                      if (r.ok) resetCountdown.start(r.cooldownSeconds || 60)
                    })
                  }
                >
                  {resetCountdown.seconds > 0 ? `${resetCountdown.seconds}s 后可重新发送` : '重新发送验证码'}
                </button>
              </form>
            )}

            {resetStep === 'password' && (
              <form onSubmit={completeReset}>
                <div className="c-field">
                  <label htmlFor="admin-reset-password">
                    <b className="fno">03</b>新密码
                  </label>
                  <div className="c-inputwrap">
                    <LockKeyholeIcon className="lead" size={18} aria-hidden="true" />
                    <input
                      id="admin-reset-password"
                      type="password"
                      autoComplete="new-password"
                      placeholder="8 位以上新密码"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                      minLength={8}
                    />
                  </div>
                </div>
                {resetError && <ErrorBar message={resetError} />}
                <button type="submit" className="c-cta ripple-host">
                  <span className="label">完成重置</span>
                </button>
              </form>
            )}

            <div className="c-modal-foot">
              无法自助找回？联系<b>超级管理员</b>在后台重置，重置操作将记录审计日志。
            </div>
          </div>
        </div>
      )}

      {phoneVerifyUser && (
        <div className="c-modal" role="dialog" aria-modal="true" aria-label="手机号本人验证">
          <form className="c-modal-card" onSubmit={confirmPhoneVerification}>
            <div className="c-modal-head">
              <div>
                <h3>手机号本人验证</h3>
                <p>
                  账号 {phoneVerifyUser.name} 已绑定 {phoneVerifyUser.phoneMasked}
                  ，本人验证后才可使用手机号登录和找回密码。
                </p>
              </div>
              <button type="button" className="close-btn" onClick={() => nav('/', { replace: true })} aria-label="稍后验证">
                <XIcon size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="c-field">
              <label htmlFor="admin-phone-verify-code">
                <b className="fno">01</b>短信验证码
              </label>
              <div className="c-inputwrap">
                <MessageSquareTextIcon className="lead" size={18} aria-hidden="true" />
                <input
                  id="admin-phone-verify-code"
                  type="text"
                  inputMode="numeric"
                  placeholder="6 位数字，5 分钟内有效"
                  value={phoneVerifyCode}
                  onChange={(e) => setPhoneVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  required
                />
                <button
                  type="button"
                  className="c-send"
                  onClick={() => void sendPhoneVerificationCode()}
                  disabled={phoneVerifyBusy || phoneVerifyCountdown.seconds > 0}
                >
                  {phoneVerifyCountdown.seconds > 0 ? `${phoneVerifyCountdown.seconds}s 后重发` : '获取验证码'}
                </button>
              </div>
            </div>
            {phoneVerifyError && <ErrorBar message={phoneVerifyError} />}
            <button
              type="submit"
              className={`c-cta ripple-host${phoneVerifyBusy ? ' loading' : ''}`}
              disabled={phoneVerifyBusy || phoneVerifyCode.length !== 6}
            >
              <span className="label">确认验证</span>
              <LoadingDots />
            </button>
            <div className="c-modal-foot">
              也可以点右上角<b>稍后验证</b>直接进入工作台，下次登录时再完成本人验证。
            </div>
          </form>
        </div>
      )}

      {legalDoc && <LegalDocsModal initialDoc={legalDoc} onClose={() => setLegalDoc(null)} />}

      {successVisible && (
        <div className="c-success" role="status">
          <div className="wipe" />
          <div className="inner">
            <div className="box">
              <svg className="check" viewBox="0 0 100 100" aria-hidden="true">
                <path d="M24 52 44 72 78 30" />
              </svg>
              <p>欢迎回来，正在进入工作台…</p>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

function AgreementRow({
  agreed,
  onToggle,
  onOpenDoc,
}: {
  agreed: boolean
  onToggle: () => void
  onOpenDoc: (doc: LegalDocKind) => void
}) {
  return (
    <button type="button" className={`c-agree${agreed ? ' checked' : ''}`} onClick={onToggle} role="checkbox" aria-checked={agreed}>
      <span className="box">
        <CheckIcon size={13} aria-hidden="true" />
      </span>
      <span>
        我已阅读并同意
        <span
          className="doclink"
          role="link"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation()
            onOpenDoc('terms')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onOpenDoc('terms')
          }}
        >
          《用户服务协议》
        </span>
        和
        <span
          className="doclink"
          role="link"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation()
            onOpenDoc('privacy')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onOpenDoc('privacy')
          }}
        >
          《隐私政策》
        </span>
      </span>
    </button>
  )
}

function ErrorBar({ message }: { message: string }) {
  return (
    <div className="c-error" role="alert">
      <CircleAlertIcon size={16} aria-hidden="true" />
      <span>{message}</span>
    </div>
  )
}

function LoadingDots() {
  return (
    <span className="load">
      <i />
      <i />
      <i />
    </span>
  )
}
