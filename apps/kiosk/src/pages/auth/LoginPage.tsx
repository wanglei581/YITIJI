// LoginPage — Kiosk 顶级全屏会员登录
//
// 路由：/login（顶级路由，不嵌套在 KioskRoot 内）
// 会话：通过 useAuth().login() 写入纯内存 AuthContext，不写任何浏览器存储
// 已接入：手机号 + 短信验证码（未注册手机号验证后自动创建账号）
// 已接入：手机扫描二维码确认一体机登录（claimToken 只保存在 Terminal Agent 本机代理）
//
// 公共一体机无系统软键盘：手机号 / 验证码全部由页面内嵌虚拟数字键盘驱动。
// 视觉对齐 .workbuddy/prototypes/login-trio-v1.html ①（样式见 ./login.css）。

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  HomeIcon,
  ScanLineIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  UserRoundIcon,
} from 'lucide-react'
import { isSafeInternalPath } from '../../auth/returnPath'
import { clearKioskSensitiveSession } from '../../auth/kioskSensitiveSession'
import { useAuth } from '../../auth/useAuth'
import { useIdleTimer } from '../../hooks/useIdleTimer'
import { MemberAgreement } from './components/MemberAgreement'
import { MemberPhoneLoginPane } from './components/MemberPhoneLoginPane'
import {
  type LoginResult,
  useMemberPhoneLogin,
} from './hooks/useMemberPhoneLogin'
import { ScanQrLoginPanel } from './ScanQrLoginPanel'
import './login.css'
import './login-batch8.css'

const DEFAULT_LOGIN_IDLE_SEC = 180
const SUCCESS_OVERLAY_MS = 950

type LoginTab = 'phone' | 'scan'

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function resolveLoginIdleMs(): number {
  const raw = Number(import.meta.env.VITE_KIOSK_LOGOUT_IDLE_SEC)
  const sec = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LOGIN_IDLE_SEC
  return sec * 1000
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
  const [agreed, setAgreed] = useState(false)
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

  const handleAgreementRequired = useCallback(() => setAgreed(false), [])
  const phoneLogin = useMemberPhoneLogin({
    agreed,
    onAgreementRequired: handleAgreementRequired,
    onAuthenticated: finishWithSuccess,
  })
  const {
    clearFeedback: clearPhoneLoginFeedback,
    onActiveInputChange: setPhoneLoginActiveInput,
    requireAgreement: requireMemberAgreement,
  } = phoneLogin

  useIdleTimer({
    timeoutMs: resolveLoginIdleMs(),
    enabled: !phoneLogin.loading && !successVisible,
    onIdle: handleLoginIdle,
  })

  const switchTab = useCallback((next: LoginTab) => {
    setTab(next)
    clearPhoneLoginFeedback()
    if (next === 'phone') setPhoneLoginActiveInput('phone')
  }, [clearPhoneLoginFeedback, setPhoneLoginActiveInput])

  const handleQrLoginSuccess = useCallback(
    (res: LoginResult) => {
      if (!agreed) {
        requireMemberAgreement()
        return
      }
      clearPhoneLoginFeedback()
      finishWithSuccess(res)
    },
    [agreed, clearPhoneLoginFeedback, finishWithSuccess, requireMemberAgreement],
  )

  const clock = useClock()
  const idleSeconds = Math.round(resolveLoginIdleMs() / 1000)
  const terminalName = (import.meta.env['VITE_TERMINAL_DISPLAY_NAME'] ?? '').trim()

  return (
    <div className="service-desk k1-login" data-visual-theme="service-desk" data-ux-density="touch" ref={rootRef}>
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
              <h1>
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

          <section className={`login-card${phoneLogin.shaking ? ' shake' : ''}`}>
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
                <h3>选择登录方式</h3>
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
                手机号登录
              </button>
              <button
                type="button"
                className={`k-tab ripple-host${tab === 'scan' ? ' on' : ''}`}
                onClick={() => switchTab('scan')}
              >
                <ScanLineIcon size={22} aria-hidden="true" />
                手机扫码登录
              </button>
            </div>

            <MemberAgreement agreed={agreed} onAgreedChange={setAgreed} />

            {tab === 'phone' && (
              <MemberPhoneLoginPane {...phoneLogin.paneProps} />
            )}

            {tab === 'scan' && (
              <ScanQrLoginPanel
                returnTo={returnTo}
                agreed={agreed}
                onAgreementRequired={requireMemberAgreement}
                onUsePhoneLogin={() => switchTab('phone')}
                onLoginSuccess={handleQrLoginSuccess}
              />
            )}
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
          <div className="msg">登录成功，正在进入…</div>
        </div>
      )}
    </div>
  )
}
