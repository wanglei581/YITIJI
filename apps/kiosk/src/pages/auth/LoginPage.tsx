// LoginPage — Kiosk 顶级全屏会员登录
//
// 路由：/login（顶级路由，不嵌套在 KioskRoot 内）
// 会话：通过 useAuth().login() 写入纯内存 AuthContext，不写任何浏览器存储
// 已接入：手机号 + 短信验证码（未注册手机号验证后自动创建账号）
// 已接入：手机扫描二维码确认一体机登录（claimToken 只保存在 Terminal Agent 本机代理）
// 邮箱登录为预留入口，未接入前只展示说明，不伪造流程。
//
// 公共一体机无系统软键盘：手机号 / 验证码全部由页面内嵌虚拟数字键盘驱动。
// 视觉对齐 .workbuddy/prototypes/login-trio-v1.html ①（样式见 ./login.css）。

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  HomeIcon,
  MailIcon,
  ScanLineIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  UserRoundIcon,
} from 'lucide-react'
import { isSafeInternalPath } from '../../auth/returnPath'
import { clearKioskSensitiveSession } from '../../auth/kioskSensitiveSession'
import { useAuth } from '../../auth/useAuth'
import { useIdleTimer } from '../../hooks/useIdleTimer'
import {
  type LoginResult,
  MemberApiError,
  memberLogin,
  sendSmsCode,
} from '../../services/auth/memberAuthApi'
import { getMemberAuthDeviceId } from '../../services/auth/memberAuthDevice'
import { ScanQrLoginPanel } from './ScanQrLoginPanel'
import './login.css'

const PHONE_LENGTH = 11
const CODE_LENGTH = 6
const DEFAULT_LOGIN_IDLE_SEC = 180
const SUCCESS_OVERLAY_MS = 950
const RING_CIRCUMFERENCE = 59.7

type LoginTab = 'phone' | 'scan' | 'email'
type ActiveNumberInput = 'phone' | 'code'

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function formatPhone(raw: string): string {
  if (raw.length <= 3) return raw
  if (raw.length <= 7) return `${raw.slice(0, 3)} ${raw.slice(3)}`
  return `${raw.slice(0, 3)} ${raw.slice(3, 7)} ${raw.slice(7)}`
}

function resolveLoginIdleMs(): number {
  const raw = Number(import.meta.env.VITE_KIOSK_LOGOUT_IDLE_SEC)
  const sec = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LOGIN_IDLE_SEC
  return sec * 1000
}

function useCountdown() {
  const [seconds, setSeconds] = useState(0)
  const [total, setTotal] = useState(60)

  useEffect(() => {
    if (seconds <= 0) return undefined
    const timer = window.setTimeout(() => setSeconds((v) => Math.max(0, v - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [seconds])

  const start = useCallback((value: number) => {
    setTotal(value > 0 ? value : 60)
    setSeconds(value)
  }, [])

  return { seconds, total, start }
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

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15000)
    return () => window.clearInterval(timer)
  }, [])
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const date = `${now.getMonth() + 1}月${now.getDate()}日 · ${WEEKDAYS[now.getDay()]}`
  return { time, date }
}

interface MemberLoginPayload {
  id: string
  phoneMasked: string
  nickname: string | null
  token: string
  method: 'phone'
}

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, isLoggedIn } = useAuth()
  const countdown = useCountdown()
  const rootRef = useRef<HTMLDivElement>(null)
  useRipple(rootRef)

  const fromState = (location.state as { from?: unknown } | null)?.from
  const queryFrom = new URLSearchParams(location.search).get('from')
  const safeQueryFrom = typeof queryFrom === 'string' && isSafeInternalPath(queryFrom) ? queryFrom : null
  const returnTo =
    typeof fromState === 'string' && isSafeInternalPath(fromState)
      ? fromState
      : safeQueryFrom ?? '/'

  const [tab, setTab] = useState<LoginTab>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [activeInput, setActiveInput] = useState<ActiveNumberInput>('phone')
  const prevPhoneLenRef = useRef(0)
  const [shaking, setShaking] = useState(false)
  const [successVisible, setSuccessVisible] = useState(false)
  const pendingLoginRef = useRef<MemberLoginPayload | null>(null)

  const goToReturn = useCallback(() => navigate(returnTo), [navigate, returnTo])
  const handleLoginIdle = useCallback(() => {
    clearKioskSensitiveSession()
    navigate('/', { replace: true })
  }, [navigate])

  useEffect(() => {
    if (isLoggedIn) navigate(returnTo, { replace: true })
  }, [isLoggedIn, navigate, returnTo])

  useIdleTimer({
    timeoutMs: resolveLoginIdleMs(),
    enabled: !loading && !successVisible,
    onIdle: handleLoginIdle,
  })

  const raiseError = useCallback((message: string) => {
    setNotice(null)
    setError(message)
    setShaking(true)
    window.setTimeout(() => setShaking(false), 400)
  }, [])

  // 手机号刚好补满 11 位时自动切到验证码（只在 10→11 的输入瞬间触发，
  // 重新点回手机号框修改时不会被弹走）
  useEffect(() => {
    if (prevPhoneLenRef.current < PHONE_LENGTH && phone.length === PHONE_LENGTH) {
      setActiveInput('code')
    }
    prevPhoneLenRef.current = phone.length
  }, [phone])

  /* 数字键盘统一走函数式更新：快速连点也不会因渲染批处理丢键 */
  const handleDigit = useCallback(
    (digit: string) => {
      if (activeInput === 'code') {
        setCode((prev) => (prev.length < CODE_LENGTH ? prev + digit : prev))
        return
      }
      setPhone((prev) => (prev + digit).slice(0, PHONE_LENGTH))
    },
    [activeInput],
  )

  const handleDelete = useCallback(() => {
    if (activeInput === 'code') {
      if (code.length === 0) setActiveInput('phone')
      else setCode((prev) => prev.slice(0, -1))
      return
    }
    setPhone((prev) => prev.slice(0, -1))
  }, [activeInput, code.length])

  const handleClear = useCallback(() => {
    if (activeInput === 'code') setCode('')
    else setPhone('')
  }, [activeInput])

  const switchTab = useCallback((next: LoginTab) => {
    setTab(next)
    setError(null)
    setNotice(null)
    if (next === 'phone') setActiveInput('phone')
  }, [])

  const requireMemberAgreement = useCallback(() => {
    raiseError('请先阅读并同意用户服务协议和隐私政策')
  }, [raiseError])

  /** 登录成功统一收口：先播 ≤1s 成功过场，再写入会话（isLoggedIn 生效后自动跳转） */
  const finishWithSuccess = useCallback(
    (res: LoginResult) => {
      pendingLoginRef.current = {
        id: res.user.id,
        phoneMasked: res.user.phoneMasked,
        nickname: res.user.nickname,
        token: res.token,
        method: 'phone',
      }
      setError(null)
      setNotice(null)
      setSuccessVisible(true)
      window.setTimeout(() => {
        if (pendingLoginRef.current) {
          login(pendingLoginRef.current)
          pendingLoginRef.current = null
        }
      }, SUCCESS_OVERLAY_MS)
    },
    [login],
  )

  const handleSendCode = useCallback(async () => {
    if (phone.length !== PHONE_LENGTH || loading || countdown.seconds > 0) return
    if (!agreed) {
      requireMemberAgreement()
      return
    }
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const deviceId = getMemberAuthDeviceId()
      const res = await sendSmsCode(phone, deviceId)
      countdown.start(res.cooldownSeconds > 0 ? res.cooldownSeconds : 60)
      setNotice(`验证码已发送至 ${formatPhone(phone)}`)
      setActiveInput('code')
    } catch (e) {
      raiseError(e instanceof MemberApiError ? e.message : '发送失败，请重试')
    } finally {
      setLoading(false)
    }
  }, [phone, loading, agreed, countdown, raiseError, requireMemberAgreement])

  const handleLogin = useCallback(async () => {
    if (phone.length !== PHONE_LENGTH || code.length !== CODE_LENGTH || loading) return
    if (!agreed) {
      requireMemberAgreement()
      return
    }
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const deviceId = getMemberAuthDeviceId()
      const res = await memberLogin(phone, code, deviceId)
      finishWithSuccess(res)
    } catch (e) {
      raiseError(e instanceof MemberApiError ? e.message : '验证失败，请重试')
      setCode('')
    } finally {
      setLoading(false)
    }
  }, [code, phone, loading, agreed, finishWithSuccess, raiseError, requireMemberAgreement])

  const handleQrLoginSuccess = useCallback(
    (res: LoginResult) => {
      if (!agreed) {
        requireMemberAgreement()
        return
      }
      finishWithSuccess(res)
    },
    [agreed, finishWithSuccess, requireMemberAgreement],
  )

  const clock = useClock()
  const idleSeconds = Math.round(resolveLoginIdleMs() / 1000)
  const terminalName = (import.meta.env['VITE_TERMINAL_DISPLAY_NAME'] ?? '').trim()

  return (
    <div className="klogin" ref={rootRef}>
      <header className="topbar">
        <span className="brand-mark">AI</span>
        <div className="brand-copy">
          <strong>AI求职打印一体机</strong>
          <span>登录 · 保存你的服务记录</span>
        </div>
        <button type="button" className="back-home ripple-host" onClick={goToReturn}>
          <HomeIcon size={17} aria-hidden="true" />
          {returnTo === '/' ? '返回首页' : '返 回'}
        </button>
      </header>

      <section className="login-screen">
        <div className="login-inner">
          {terminalName && (
            <div className="mast">
              <span>就业服务自助终端</span>
              <i />
              <span>{terminalName}</span>
            </div>
          )}

          <section className="hero">
            <div className="hero-copy">
              <div className="hero-eyebrow">
                <ShieldCheckIcon size={17} aria-hidden="true" />
                就业服务 · 一体机自助办理
              </div>
              <h1 className="serif">
                登录后，简历和记录
                <br />
                都替你存好
              </h1>
              <p>AI 简历报告、打印订单、岗位与招聘会浏览记录自动保存到「我的」，下次来直接继续。</p>
            </div>
            <div className="hero-clock">
              <div className="time">{clock.time}</div>
              <div className="date">{clock.date}</div>
            </div>
          </section>

          <section className={`login-card${shaking ? ' shake' : ''}`}>
            <div className="folio">
              <span>
                <b>会员登录</b>
              </span>
              <span>凭证仅存本机 · 离开请退出</span>
            </div>
            <div className="card-head">
              <span className="chi">
                <UserRoundIcon size={28} aria-hidden="true" />
              </span>
              <div>
                <h3 className="serif">选择登录方式</h3>
                <p>手机号验证码或手机扫码，全程不超过 3 步</p>
              </div>
            </div>

            <div className="k-tabs">
              <button
                type="button"
                className={`k-tab ripple-host${tab === 'phone' ? ' on' : ''}`}
                onClick={() => switchTab('phone')}
              >
                <SmartphoneIcon size={22} aria-hidden="true" />
                手机号
              </button>
              <button
                type="button"
                className={`k-tab ripple-host${tab === 'scan' ? ' on' : ''}`}
                onClick={() => switchTab('scan')}
              >
                <ScanLineIcon size={22} aria-hidden="true" />
                扫码登录
              </button>
              <button
                type="button"
                className={`k-tab ripple-host${tab === 'email' ? ' on' : ''}`}
                onClick={() => switchTab('email')}
              >
                <MailIcon size={22} aria-hidden="true" />
                邮箱
              </button>
            </div>

            <button
              type="button"
              className={`k-agree${agreed ? ' checked' : ''}`}
              onClick={() => setAgreed((v) => !v)}
              role="checkbox"
              aria-checked={agreed}
            >
              <span className="box">
                <CheckIcon size={18} aria-hidden="true" />
              </span>
              <span>
                我已阅读并同意
                <span
                  className="doclink"
                  role="link"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation()
                    navigate('/legal/terms')
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') navigate('/legal/terms')
                  }}
                >
                  《用户服务协议》
                </span>
                与
                <span
                  className="doclink"
                  role="link"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation()
                    navigate('/legal/privacy')
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') navigate('/legal/privacy')
                  }}
                >
                  《隐私政策》
                </span>
              </span>
            </button>

            {tab === 'phone' && (
              <PhoneLoginPane
                phone={phone}
                code={code}
                loading={loading}
                countdown={countdown.seconds}
                countdownTotal={countdown.total}
                activeInput={activeInput}
                onActiveInputChange={setActiveInput}
                onDigit={handleDigit}
                onDelete={handleDelete}
                onClear={handleClear}
                onSendCode={() => void handleSendCode()}
                onLogin={() => void handleLogin()}
                notice={notice}
                error={error}
              />
            )}

            {tab === 'scan' && (
              <>
                <ScanQrLoginPanel
                  returnTo={returnTo}
                  agreed={agreed}
                  onAgreementRequired={requireMemberAgreement}
                  onUsePhoneLogin={() => switchTab('phone')}
                  onLoginSuccess={handleQrLoginSuccess}
                />
                {error && (
                  <div className="k-error" role="alert">
                    <CircleAlertIcon size={20} aria-hidden="true" />
                    <span>{error}</span>
                  </div>
                )}
              </>
            )}

            {tab === 'email' && <EmailReservedPane />}
          </section>

          <div className="push-bottom" />

          <div className="k-helpline">
            <span>
              无操作 <b>{idleSeconds}</b> 秒后自动返回首页
            </span>
          </div>
          <div className="compliance">
            <ShieldCheckIcon size={15} aria-hidden="true" />
            登录仅用于保存你的简历、订单与浏览记录；敏感文件设有效期并自动清理，本终端不向任何企业提供简历。
          </div>
        </div>
      </section>

      {successVisible && (
        <div className="k-success" role="status">
          <span className="inkdot" />
          <div className="check-wrap">
            <div className="check-circle">
              <svg className="check" viewBox="0 0 100 100" aria-hidden="true">
                <path d="M24 52 44 72 78 30" />
              </svg>
            </div>
          </div>
          <div className="msg serif">登录成功，正在进入…</div>
        </div>
      )}
    </div>
  )
}

function PhoneLoginPane({
  phone,
  code,
  loading,
  countdown,
  countdownTotal,
  activeInput,
  onActiveInputChange,
  onDigit,
  onDelete,
  onClear,
  onSendCode,
  onLogin,
  notice,
  error,
}: {
  phone: string
  code: string
  loading: boolean
  countdown: number
  countdownTotal: number
  activeInput: ActiveNumberInput
  onActiveInputChange: (input: ActiveNumberInput) => void
  onDigit: (digit: string) => void
  onDelete: () => void
  onClear: () => void
  onSendCode: () => void
  onLogin: () => void
  notice: string | null
  error: string | null
}) {
  const canSend = phone.length === PHONE_LENGTH && countdown === 0 && !loading
  const canLogin = phone.length === PHONE_LENGTH && code.length === CODE_LENGTH && !loading
  const ringOffset = countdownTotal > 0 ? RING_CIRCUMFERENCE * (1 - countdown / countdownTotal) : 0
  const activeValue = activeInput === 'code' ? code : phone

  return (
    <div className="k-pane">
      <div className="field-label">
        <b className="fno">01</b>手机号 <i>未注册的手机号验证后将自动创建账号</i>
      </div>
      <button
        type="button"
        className={`k-input${activeInput === 'phone' ? ' focus' : ''}`}
        onClick={() => onActiveInputChange('phone')}
        aria-label="手机号"
      >
        <SmartphoneIcon size={22} aria-hidden="true" />
        {phone ? <span>{formatPhone(phone)}</span> : <span className="ph">使用下方键盘输入 11 位手机号</span>}
        {activeInput === 'phone' && phone.length < PHONE_LENGTH && <span className="caret" />}
        <span
          role="button"
          aria-disabled={!canSend}
          className="k-send ripple-host"
          style={!canSend ? { opacity: 0.42, boxShadow: 'none', cursor: 'default' } : undefined}
          onClick={(e) => {
            e.stopPropagation()
            if (canSend) onSendCode()
          }}
        >
          {countdown > 0 && (
            <svg className="ring" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="bg" cx="12" cy="12" r="9.5" />
              <circle
                cx="12"
                cy="12"
                r="9.5"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={ringOffset}
              />
            </svg>
          )}
          <span>{loading && countdown === 0 ? '发送中' : countdown > 0 ? `${countdown}s 后重发` : '获取验证码'}</span>
        </span>
      </button>

      <div className="field-label">
        <b className="fno">02</b>短信验证码 <i>输入 6 位数字，5 分钟内有效</i>
      </div>
      <div
        className="k-cells"
        onClick={() => onActiveInputChange('code')}
        role="button"
        tabIndex={0}
        aria-label="短信验证码"
        onKeyDown={(e) => {
          if (e.key === 'Enter') onActiveInputChange('code')
        }}
      >
        {Array.from({ length: CODE_LENGTH }, (_, i) => {
          const filled = i < code.length
          const next = activeInput === 'code' && i === code.length
          return (
            <div key={i} className={`k-cell${filled ? ' filled' : ''}${next ? ' next' : ''}`}>
              {filled && <span>{code[i]}</span>}
            </div>
          )
        })}
      </div>

      {notice && (
        <div className="k-notice" role="status">
          <CircleCheckIcon size={20} aria-hidden="true" />
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div className="k-error" role="alert">
          <CircleAlertIcon size={20} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="button"
        className={`k-cta ripple-host${loading ? ' loading' : ''}`}
        disabled={!canLogin}
        onClick={onLogin}
      >
        <span className="label">登 录</span>
        <span className="load">
          <i />
          <i />
          <i />
        </span>
      </button>

      <div className="k-numpad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
          <button
            key={digit}
            type="button"
            className="k-key ripple-host"
            onPointerDown={(e) => {
              e.preventDefault()
              onDigit(digit)
            }}
            aria-label={digit}
          >
            {digit}
          </button>
        ))}
        <button
          type="button"
          className="k-key fn ripple-host"
          disabled={activeValue.length === 0}
          onPointerDown={(e) => {
            e.preventDefault()
            onClear()
          }}
          aria-label="清空"
        >
          清空
        </button>
        <button
          type="button"
          className="k-key ripple-host"
          onPointerDown={(e) => {
            e.preventDefault()
            onDigit('0')
          }}
          aria-label="0"
        >
          0
        </button>
        <button
          type="button"
          className="k-key fn ripple-host"
          onPointerDown={(e) => {
            e.preventDefault()
            onDelete()
          }}
          aria-label="删除"
        >
          删除
        </button>
      </div>
    </div>
  )
}

// 邮箱登录预留：后端尚未提供邮箱验证码服务，只展示说明，不伪造登录流程。
function EmailReservedPane() {
  return (
    <div className="k-pane k-reserved">
      <span className="chi">
        <MailIcon size={34} aria-hidden="true" />
      </span>
      <h4 className="serif">邮箱登录暂未开放</h4>
      <p>当前会员账号使用手机号验证码登录。邮箱登录入口已预留，接入邮箱验证码服务后开放，请先使用手机号或扫码登录。</p>
    </div>
  )
}
