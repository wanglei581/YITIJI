// LoginPage — Kiosk 顶级全屏会员登录
//
// 路由：/login（顶级路由，不嵌套在 KioskRoot 内）
// 会话：通过 useAuth().login() 写入纯内存 AuthContext，不写任何浏览器存储
// 已接入：手机号 + 短信验证码
// 已接入：手机扫描二维码确认一体机登录（claimToken 只保存在 Terminal Agent 本机代理）
//
// 公共一体机无系统软键盘：手机号 / 验证码输入框 readOnly + inputMode="none"，
// 全部由页面内嵌虚拟数字键盘驱动（触控区对齐 KioskNumPad 标准）。

import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  HomeIcon,
  MailIcon,
  PhoneIcon,
  QrCodeIcon,
  ShieldCheckIcon,
} from 'lucide-react'
import { isSafeInternalPath } from '../../auth/returnPath'
import { useAuth } from '../../auth/useAuth'
import {
  type LoginResult,
  MemberApiError,
  memberLogin,
  sendSmsCode,
} from '../../services/auth/memberAuthApi'
import { getMemberAuthDeviceId } from '../../services/auth/memberAuthDevice'
import { ScanQrLoginPanel } from './ScanQrLoginPanel'

const PHONE_LENGTH = 11
const CODE_LENGTH = 6

type LoginTab = 'phone' | 'email' | 'scan'
type ActiveNumberInput = 'phone' | 'code' | null

function formatPhone(raw: string): string {
  if (raw.length <= 3) return raw
  if (raw.length <= 7) return `${raw.slice(0, 3)} ${raw.slice(3)}`
  return `${raw.slice(0, 3)} ${raw.slice(3, 7)} ${raw.slice(7)}`
}

function normalizeDigits(raw: string, maxLength: number): string {
  return raw.replace(/\D/g, '').slice(0, maxLength)
}

function useCountdown() {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (seconds <= 0) return undefined
    const timer = window.setTimeout(() => setSeconds((v) => Math.max(0, v - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [seconds])

  return { seconds, start: setSeconds }
}

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, isLoggedIn } = useAuth()
  const countdown = useCountdown()

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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [activeNumberInput, setActiveNumberInput] = useState<ActiveNumberInput>(null)

  const goToReturn = useCallback(() => navigate(returnTo), [navigate, returnTo])

  useEffect(() => {
    if (isLoggedIn) navigate(returnTo, { replace: true })
  }, [isLoggedIn, navigate, returnTo])

  const switchTab = useCallback((next: LoginTab) => {
    setTab(next)
    setError(null)
    setNotice(null)
    setActiveNumberInput(next === 'phone' ? 'phone' : null)
  }, [])

  const handleSendCode = useCallback(async () => {
    if (phone.length !== PHONE_LENGTH || loading) return
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const deviceId = getMemberAuthDeviceId()
      const res = await sendSmsCode(phone, deviceId)
      countdown.start(res.cooldownSeconds > 0 ? res.cooldownSeconds : 60)
      setNotice(`验证码已发送至 ${formatPhone(phone)}`)
    } catch (e) {
      setError(e instanceof MemberApiError ? e.message : '发送失败，请重试')
    } finally {
      setLoading(false)
    }
  }, [phone, loading, countdown])

  const handleLogin = useCallback(async () => {
    if (phone.length !== PHONE_LENGTH || code.length !== CODE_LENGTH || loading) return
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const deviceId = getMemberAuthDeviceId()
      const res = await memberLogin(phone, code, deviceId)
      login({
        id: res.user.id,
        phoneMasked: res.user.phoneMasked,
        nickname: res.user.nickname,
        token: res.token,
        method: 'phone',
      })
    } catch (e) {
      setError(e instanceof MemberApiError ? e.message : '验证失败，请重试')
      setCode('')
    } finally {
      setLoading(false)
    }
  }, [code, phone, loading, login])

  const handleQrLoginSuccess = useCallback((res: LoginResult) => {
    login({
      id: res.user.id,
      phoneMasked: res.user.phoneMasked,
      nickname: res.user.nickname,
      token: res.token,
      method: 'phone',
    })
  }, [login])

  return (
    <div className="min-h-screen bg-[#f3f5f9] text-neutral-900">
      <button
        type="button"
        onClick={goToReturn}
        className="fixed left-5 top-5 z-10 flex min-h-[56px] min-w-[56px] items-center justify-center rounded-2xl text-neutral-700 transition-colors hover:bg-white active:bg-neutral-100"
        aria-label="返回"
      >
        <ArrowLeftIcon className="h-6 w-6" aria-hidden="true" />
      </button>

      <main className="mx-auto flex min-h-screen w-full max-w-[1280px] flex-col px-5 pb-6 pt-14">
        <LoginHeader />

        <section className="mt-7 rounded-[8px] bg-[#e9edf3] p-1 shadow-inner">
          <div className="grid grid-cols-3 gap-1">
            <TabButton active={tab === 'phone'} icon={<PhoneIcon className="h-4 w-4" />} label="手机号" onClick={() => switchTab('phone')} />
            <TabButton active={tab === 'email'} icon={<MailIcon className="h-4 w-4" />} label="邮箱" onClick={() => switchTab('email')} />
            <TabButton active={tab === 'scan'} icon={<QrCodeIcon className="h-4 w-4" />} label="扫码" onClick={() => switchTab('scan')} />
          </div>
        </section>

        <section className="mt-7 flex flex-1 flex-col">
          {tab === 'phone' && (
            <PhoneLoginPanel
              phone={phone}
              code={code}
              loading={loading}
              countdown={countdown.seconds}
              error={error}
              notice={notice}
              onPhoneChange={(value) => setPhone(normalizeDigits(value, PHONE_LENGTH))}
              onCodeChange={(value) => setCode(normalizeDigits(value, CODE_LENGTH))}
              activeInput={activeNumberInput}
              onActiveInputChange={setActiveNumberInput}
              onSendCode={handleSendCode}
              onLogin={handleLogin}
            />
          )}

          {tab === 'email' && <EmailReservedPanel />}

          {tab === 'scan' && (
            <ScanQrLoginPanel
              returnTo={returnTo}
              onUsePhoneLogin={() => switchTab('phone')}
              onLoginSuccess={handleQrLoginSuccess}
            />
          )}
        </section>

        <FooterActions onHome={goToReturn} />
      </main>
    </div>
  )
}

function LoginHeader() {
  return (
    <header className="flex flex-col items-center text-center">
      <div className="flex h-[72px] w-[72px] items-center justify-center rounded-[18px] bg-gradient-to-br from-[#3185ff] via-[#7f65dc] to-[#ff6a3d] text-[1.7rem] font-bold text-white shadow-lg shadow-blue-500/20">
        AI
      </div>
      <h1 className="mt-4 text-[1.55rem] font-bold leading-tight text-[#172033]">欢迎登录</h1>
      <p className="mt-1 text-sm font-medium text-[#8b95a7]">AI求职打印一体机</p>
    </header>
  )
}

function TabButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-[44px] items-center justify-center gap-2 rounded-[8px] text-sm font-semibold transition-all ${
        active
          ? 'bg-white text-[#1677ff] shadow-[0_2px_10px_rgba(31,42,68,0.14)]'
          : 'text-[#7e8797] hover:bg-white/50 active:bg-white/70'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function PhoneLoginPanel({
  phone,
  code,
  loading,
  countdown,
  error,
  notice,
  onPhoneChange,
  onCodeChange,
  activeInput,
  onActiveInputChange,
  onSendCode,
  onLogin,
}: {
  phone: string
  code: string
  loading: boolean
  countdown: number
  error: string | null
  notice: string | null
  onPhoneChange: (value: string) => void
  onCodeChange: (value: string) => void
  activeInput: ActiveNumberInput
  onActiveInputChange: (input: ActiveNumberInput) => void
  onSendCode: () => void
  onLogin: () => void
}) {
  const canSend = phone.length === PHONE_LENGTH && countdown === 0 && !loading
  const canLogin = phone.length === PHONE_LENGTH && code.length === CODE_LENGTH && !loading
  const keyboardTarget = activeInput ?? 'phone'

  const updateActiveValue = (next: string) => {
    if (keyboardTarget === 'code') {
      onCodeChange(normalizeDigits(next, CODE_LENGTH))
      return
    }
    onPhoneChange(normalizeDigits(next, PHONE_LENGTH))
  }

  const handleKeyboardDigit = (digit: string) => {
    if (keyboardTarget === 'code') {
      if (code.length < CODE_LENGTH) onCodeChange(code + digit)
      return
    }
    if (phone.length < PHONE_LENGTH) onPhoneChange(phone + digit)
  }

  const handleKeyboardDelete = () => {
    if (keyboardTarget === 'code') {
      onCodeChange(code.slice(0, -1))
      return
    }
    onPhoneChange(phone.slice(0, -1))
  }

  return (
    <div className="mx-auto w-full max-w-[1220px]">
      <label className="block text-sm font-semibold text-[#1e293b]">手机号</label>
      <div
        className={`mt-3 flex min-h-[56px] items-center rounded-[10px] border bg-white px-4 shadow-sm transition-colors ${
          activeInput === 'phone' ? 'border-[#1677ff] ring-2 ring-blue-100' : 'border-[#dfe4ec]'
        }`}
      >
        <PhoneIcon className="mr-3 h-5 w-5 text-[#98a2b3]" aria-hidden="true" />
        <span className="mr-3 border-r border-[#e1e6ef] pr-3 text-sm font-semibold text-[#8a94a6]">+86</span>
        <input
          type="text"
          readOnly
          inputMode="none"
          name="kiosk-member-phone"
          autoComplete="off"
          value={phone}
          onChange={(e) => onPhoneChange(e.target.value)}
          onFocus={() => onActiveInputChange('phone')}
          onClick={() => onActiveInputChange('phone')}
          placeholder="请输入手机号"
          className="min-w-0 flex-1 cursor-pointer bg-transparent text-base font-semibold text-[#172033] outline-none placeholder:text-[#a1a8b5]"
          aria-label="手机号"
        />
      </div>

      <label className="mt-6 block text-sm font-semibold text-[#1e293b]">验证码</label>
      <div className="mt-3 flex gap-3">
        <div
          className={`flex min-h-[56px] flex-1 items-center rounded-[10px] border bg-white px-4 shadow-sm transition-colors ${
            activeInput === 'code' ? 'border-[#1677ff] ring-2 ring-blue-100' : 'border-[#dfe4ec]'
          }`}
        >
          <ShieldCheckIcon className="mr-3 h-5 w-5 text-[#98a2b3]" aria-hidden="true" />
          <input
            type="text"
            readOnly
            inputMode="none"
            name="kiosk-member-code"
            autoComplete="off"
            value={code}
            onChange={(e) => onCodeChange(e.target.value)}
            onFocus={() => onActiveInputChange('code')}
            onClick={() => onActiveInputChange('code')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onLogin()
            }}
            placeholder="6位验证码"
            className="min-w-0 flex-1 cursor-pointer bg-transparent text-base font-semibold tracking-[0.18em] text-[#172033] outline-none placeholder:tracking-normal placeholder:text-[#a1a8b5]"
            aria-label="验证码"
          />
        </div>
        <button
          type="button"
          onClick={onSendCode}
          disabled={!canSend}
          className="min-h-[56px] min-w-[122px] rounded-[10px] bg-white px-5 text-sm font-bold text-[#1677ff] shadow-sm transition-colors active:bg-blue-50 disabled:cursor-not-allowed disabled:bg-[#e9edf3] disabled:text-[#a1a8b5]"
        >
          {loading ? '发送中' : countdown > 0 ? `${countdown}s` : '获取验证码'}
        </button>
      </div>

      {notice && (
        <div className="mt-4 flex min-h-[42px] items-center justify-center gap-2 rounded-[8px] bg-emerald-50 text-sm font-semibold text-emerald-700">
          <CheckCircle2Icon className="h-4 w-4" aria-hidden="true" />
          {notice}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-[8px] bg-red-50 px-4 py-3 text-center text-sm font-semibold text-red-600">
          {error}
        </div>
      )}

      {activeInput && (
        <VirtualNumberPad
          label={activeInput === 'phone' ? '输入手机号' : '输入验证码'}
          value={activeInput === 'phone' ? phone : code}
          onDigit={handleKeyboardDigit}
          onDelete={handleKeyboardDelete}
          onClear={() => updateActiveValue('')}
          onConfirm={() => {
            if (activeInput === 'phone') {
              if (phone.length === PHONE_LENGTH) onActiveInputChange('code')
              return
            }
            if (canLogin) onLogin()
          }}
          confirmLabel={activeInput === 'phone' ? '下一步' : '完成'}
        />
      )}

      <button
        type="button"
        onClick={onLogin}
        disabled={!canLogin}
        className="mt-5 min-h-[56px] w-full rounded-[10px] bg-gradient-to-r from-[#1687ff] to-[#12aeea] text-base font-bold text-white shadow-lg shadow-blue-500/20 transition-transform active:scale-[0.99] disabled:cursor-not-allowed disabled:from-[#a9bdf5] disabled:to-[#a9bdf5]"
      >
        {loading ? '登录中...' : '立即登录'}
      </button>
    </div>
  )
}

// 内嵌虚拟数字键盘：触控区对齐既有 KioskNumPad 标准——
// 数字 / 0 / 删除 / 清空键 min-h ≥ 72px，确认键 min-h ≥ 56px；
// 用 onPointerDown + preventDefault 即时响应，避免触摸时只读输入框失焦闪烁。
function VirtualNumberPad({
  label,
  value,
  onDigit,
  onDelete,
  onClear,
  onConfirm,
  confirmLabel,
}: {
  label: string
  value: string
  onDigit: (digit: string) => void
  onDelete: () => void
  onClear: () => void
  onConfirm: () => void
  confirmLabel: string
}) {
  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
  const keyBase =
    'flex min-h-[72px] items-center justify-center rounded-[10px] border border-[#e4e8f0] bg-[#f8fafc] shadow-sm transition-colors active:bg-blue-50 disabled:opacity-40'

  return (
    <div className="mt-5 rounded-[10px] border border-[#dfe4ec] bg-white p-3 shadow-sm">
      <div className="mb-3 flex min-h-[28px] items-center justify-between px-1">
        <span className="text-sm font-bold text-[#172033]">{label}</span>
        <span className="text-xs font-medium text-[#98a2b3]">触控数字键盘</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {digits.map((digit) => (
          <button
            key={digit}
            type="button"
            onPointerDown={(e) => {
              e.preventDefault()
              onDigit(digit)
            }}
            className={`${keyBase} text-xl font-bold text-[#172033]`}
            aria-label={digit}
          >
            {digit}
          </button>
        ))}
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault()
            onClear()
          }}
          disabled={value.length === 0}
          className={`${keyBase} text-sm font-bold text-[#667085]`}
          aria-label="清空"
        >
          清空
        </button>
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault()
            onDigit('0')
          }}
          className={`${keyBase} text-xl font-bold text-[#172033]`}
          aria-label="0"
        >
          0
        </button>
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault()
            onDelete()
          }}
          disabled={value.length === 0}
          className={`${keyBase} text-sm font-bold text-[#667085]`}
          aria-label="删除"
        >
          删除
        </button>
      </div>
      <button
        type="button"
        onPointerDown={(e) => {
          e.preventDefault()
          onConfirm()
        }}
        className="mt-3 flex min-h-[56px] w-full items-center justify-center rounded-[10px] bg-[#1677ff] text-base font-bold text-white shadow-sm transition-colors active:bg-[#0d63d9]"
        aria-label={confirmLabel}
      >
        {confirmLabel}
      </button>
    </div>
  )
}

function EmailReservedPanel() {
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col items-center justify-center text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-[18px] bg-white text-[#1677ff] shadow-sm">
        <MailIcon className="h-9 w-9" aria-hidden="true" />
      </div>
      <h2 className="mt-5 text-xl font-bold text-[#172033]">邮箱登录待接入</h2>
      <p className="mt-2 max-w-[420px] text-sm leading-6 text-[#7e8797]">
        当前会员账号体系先使用手机号验证码。邮箱登录入口已预留，后续接入邮箱验证码服务后开放。
      </p>
    </div>
  )
}

// 页脚：回首页 + 注册/协议/隐私说明。注册与协议尚无独立页面，点击给诚实提示，
// 不保留无响应按钮（CLAUDE.md 诚实化原则）。
function FooterActions({ onHome }: { onHome: () => void }) {
  const navigate = useNavigate()
  const [hint, setHint] = useState<string | null>(null)

  useEffect(() => {
    if (!hint) return
    const t = window.setTimeout(() => setHint(null), 3200)
    return () => window.clearTimeout(t)
  }, [hint])

  return (
    <footer className="mt-8">
      <div className="flex min-h-[64px] items-center justify-center rounded-[10px] border border-[#dfe4ec] bg-white shadow-sm">
        <button
          type="button"
          onClick={onHome}
          className="flex min-h-[54px] items-center gap-3 rounded-[10px] px-5 text-left transition-colors active:bg-orange-50"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-[#ff6a3d] text-white">
            <HomeIcon className="h-5 w-5" aria-hidden="true" />
          </span>
          <span>
            <span className="block text-sm font-bold text-[#172033]">回到首页</span>
            <span className="block text-xs text-[#8b95a7]">返回平台主页</span>
          </span>
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-[#8b95a7]">
        <button
          type="button"
          onClick={() => setHint('首次使用手机号验证码登录将自动创建账号，无需单独注册')}
          className="min-h-[36px] px-1 font-semibold text-[#ff6a3d]"
        >
          立即注册
        </button>
        <span>登录即代表同意</span>
        <button
          type="button"
          onClick={() => navigate('/legal/terms')}
          className="min-h-[36px] px-1 font-semibold text-[#1677ff]"
        >
          《用户服务协议》
        </button>
        <button
          type="button"
          onClick={() => navigate('/legal/privacy')}
          className="min-h-[36px] px-1 font-semibold text-[#1677ff]"
        >
          《隐私政策》
        </button>
      </div>

      {hint && <p className="mt-2 text-center text-xs font-medium text-[#667085]">{hint}</p>}
    </footer>
  )
}
