// LoginPage — Kiosk 顶级全屏手机号验证码登录（L2-4B）
//
// 路由：/login（顶级路由，不嵌套在 KioskRoot 内）
// 会话：通过 useAuth().login() 写入纯内存 AuthContext，不写任何浏览器存储
// 流程：Step 1 输入手机号 → 发送验证码 → Step 2 输入6位码 → 登录 → 跳回来源页（returnTo）
//
// 返回体验：location.state.from 传入来源页（首页 / 我的页）；手机号页与验证码页
// 均提供明确返回；登录成功 / 暂不登录都回 returnTo（站内路径，否则 fallback /）。
//
// 输入字段全部 readOnly + inputMode="none"，由 KioskNumPad 驱动，不触发系统软键盘

import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeftIcon } from 'lucide-react'
import { MonitorCheckIcon } from 'lucide-react'
import { KioskNumPad } from '../../components/KioskNumPad'
import { useAuth } from '../../auth/useAuth'
import {
  MemberApiError,
  memberLogin,
  sendSmsCode,
} from '../../services/auth/memberAuthApi'

// ── 常量 ─────────────────────────────────────────────────────────

const PHONE_LENGTH = 11
const CODE_LENGTH = 6

// ── 手机号格式化（仅展示用，提交仍用原始数字） ───────────────────

function formatPhone(raw: string): string {
  if (raw.length <= 3) return raw
  if (raw.length <= 7) return `${raw.slice(0, 3)} ${raw.slice(3)}`
  return `${raw.slice(0, 3)} ${raw.slice(3, 7)} ${raw.slice(7)}`
}

// ── 倒计时 Hook ───────────────────────────────────────────────────

function useCountdown(initial: number) {
  const [seconds, setSeconds] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const start = useCallback((n: number) => {
    setSeconds(n)
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          clearInterval(timerRef.current!)
          return 0
        }
        return s - 1
      })
    }, 1000)
  }, [])

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current)
    },
    [],
  )

  return { seconds, start, initial }
}

// ── 验证码输入格（6 个方块） ──────────────────────────────────────

function CodeBoxes({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-3">
      {Array.from({ length: CODE_LENGTH }).map((_, i) => (
        <div
          key={i}
          className={`flex h-14 w-12 items-center justify-center rounded-lg border-2 text-2xl font-bold transition-colors
            ${i < value.length ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-neutral-300 bg-white text-neutral-400'}`}
        >
          {value[i] ?? (i === value.length ? '|' : '·')}
        </div>
      ))}
    </div>
  )
}

// ── 主页面 ────────────────────────────────────────────────────────

type Step = 'phone' | 'code'

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, isLoggedIn } = useAuth()
  const countdown = useCountdown(60)

  // 来源页返回目标：仅接受站内路径且非 /login，否则 fallback 到首页。
  // 拒绝协议相对地址（//host）等开放重定向面，纯前端导航。
  const fromState = (location.state as { from?: unknown } | null)?.from
  const returnTo =
    typeof fromState === 'string' &&
    fromState.startsWith('/') &&
    !fromState.startsWith('//') &&
    fromState !== '/login'
      ? fromState
      : '/'

  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const goToReturn = useCallback(() => navigate(returnTo), [navigate, returnTo])

  // 已登录（含登录成功后）跳回来源页
  useEffect(() => {
    if (isLoggedIn) navigate(returnTo, { replace: true })
  }, [isLoggedIn, navigate, returnTo])

  // ── Step 1: 发送验证码 ────────────────────────────────────────

  const handleSendCode = useCallback(async () => {
    if (phone.length !== PHONE_LENGTH || loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await sendSmsCode(phone)
      countdown.start(res.cooldownSeconds > 0 ? res.cooldownSeconds : 60)
      setStep('code')
    } catch (e) {
      setError(e instanceof MemberApiError ? e.message : '发送失败，请重试')
    } finally {
      setLoading(false)
    }
  }, [phone, loading, countdown])

  // ── Step 2: 登录 ──────────────────────────────────────────────

  const handleLogin = useCallback(async () => {
    if (code.length !== CODE_LENGTH || loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await memberLogin(phone, code)
      login({
        id: res.user.id,
        phoneMasked: res.user.phoneMasked,
        nickname: res.user.nickname,
        token: res.token,
        method: 'phone',
      })
      // navigate 由 useEffect isLoggedIn 触发，此处不重复 navigate
    } catch (e) {
      setError(e instanceof MemberApiError ? e.message : '验证失败，请重试')
      setCode('')
    } finally {
      setLoading(false)
    }
  }, [code, phone, loading, login])

  // ── 重新发送 ──────────────────────────────────────────────────

  const handleResend = useCallback(async () => {
    if (countdown.seconds > 0 || loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await sendSmsCode(phone)
      countdown.start(res.cooldownSeconds > 0 ? res.cooldownSeconds : 60)
      setCode('')
    } catch (e) {
      setError(e instanceof MemberApiError ? e.message : '发送失败，请重试')
    } finally {
      setLoading(false)
    }
  }, [countdown, phone, loading])

  // ── 渲染 ──────────────────────────────────────────────────────

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#0B2A5B] px-6 py-10">
      {/* 品牌标识 */}
      <div className="mb-8 flex items-center gap-3 text-white">
        <MonitorCheckIcon className="h-8 w-8 text-blue-300" aria-hidden="true" />
        <div>
          <p className="text-xs font-medium tracking-widest text-blue-300 uppercase">AI求职打印服务终端</p>
          <p className="text-sm text-blue-200/70">登录后可查看历史记录与个人简历</p>
        </div>
      </div>

      {/* 登录卡片 */}
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl">
        {step === 'phone' ? (
          <PhoneStep
            phone={phone}
            onPhoneChange={setPhone}
            onSend={handleSendCode}
            onCancel={goToReturn}
            returnsHome={returnTo === '/'}
            loading={loading}
            error={error}
          />
        ) : (
          <CodeStep
            phone={phone}
            code={code}
            onCodeChange={setCode}
            onLogin={handleLogin}
            onResend={handleResend}
            onBack={() => {
              setStep('phone')
              setCode('')
              setError(null)
            }}
            countdown={countdown.seconds}
            loading={loading}
            error={error}
          />
        )}
      </div>

      {/* 跳过提示（两步均可见，直接退出登录流程回来源页）；触控区 ≥48px */}
      <button
        type="button"
        onClick={goToReturn}
        className="mt-8 flex min-h-[48px] items-center px-4 text-sm text-blue-300/70 underline-offset-4 hover:text-blue-200 active:underline"
      >
        暂不登录，继续使用
      </button>
    </div>
  )
}

// ── PhoneStep ─────────────────────────────────────────────────────

interface PhoneStepProps {
  phone: string
  onPhoneChange: (v: string) => void
  onSend: () => void
  onCancel: () => void
  returnsHome: boolean
  loading: boolean
  error: string | null
}

function PhoneStep({ phone, onPhoneChange, onSend, onCancel, returnsHome, loading, error }: PhoneStepProps) {
  const canSend = phone.length === PHONE_LENGTH && !loading

  return (
    <div className="p-8">
      {/* 顶部返回（触控友好，≥56px）：回到来源页 */}
      <button
        type="button"
        onClick={onCancel}
        className="-ml-2 mb-4 flex min-h-[56px] items-center gap-1.5 rounded-xl px-2 text-base font-medium text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-neutral-700 active:bg-neutral-100"
      >
        <ArrowLeftIcon className="h-5 w-5" aria-hidden="true" />
        {returnsHome ? '返回首页' : '返回'}
      </button>

      <h2 className="text-xl font-bold text-neutral-800">手机号登录</h2>
      <p className="mt-1 text-sm text-neutral-500">输入手机号，获取验证码</p>

      {/* 手机号展示框 */}
      <div className="mt-6">
        <label className="mb-2 block text-xs font-medium text-neutral-500">手机号</label>
        <input
          type="text"
          readOnly
          inputMode="none"
          value={formatPhone(phone)}
          placeholder="请输入手机号"
          className="w-full rounded-xl border-2 border-neutral-200 bg-neutral-50 px-4 py-3 text-center text-2xl font-mono font-semibold tracking-widest text-neutral-800 caret-transparent outline-none focus:border-primary-400 focus:bg-white"
          aria-label="手机号"
        />
      </div>

      {/* 错误提示 */}
      {error && (
        <p className="mt-3 text-center text-sm font-medium text-error">{error}</p>
      )}

      {/* 数字键盘 */}
      <KioskNumPad
        value={phone}
        maxLength={PHONE_LENGTH}
        onChange={onPhoneChange}
        onConfirm={canSend ? onSend : undefined}
        confirmDisabled={!canSend}
        confirmLabel={loading ? '发送中…' : '发送'}
        className="mt-5"
      />

      {/* 发送按钮（补充大触控区，与 NumPad 确认键同步） */}
      <button
        type="button"
        onClick={onSend}
        disabled={!canSend}
        className="mt-4 w-full rounded-xl bg-primary-600 py-4 text-base font-semibold text-white shadow-sm transition-colors active:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? '发送中…' : '发送验证码'}
      </button>
    </div>
  )
}

// ── CodeStep ──────────────────────────────────────────────────────

interface CodeStepProps {
  phone: string
  code: string
  onCodeChange: (v: string) => void
  onLogin: () => void
  onResend: () => void
  onBack: () => void
  countdown: number
  loading: boolean
  error: string | null
}

function CodeStep({
  phone,
  code,
  onCodeChange,
  onLogin,
  onResend,
  onBack,
  countdown,
  loading,
  error,
}: CodeStepProps) {
  const canLogin = code.length === CODE_LENGTH && !loading
  const canResend = countdown === 0 && !loading

  return (
    <div className="p-8">
      {/* 返回修改手机号（保留手机号、清空验证码与错误）；触控区 ≥48px */}
      <button
        type="button"
        onClick={onBack}
        className="-ml-2 mb-4 flex min-h-[48px] items-center gap-1.5 rounded-xl px-2 text-base font-medium text-neutral-500 transition-colors hover:bg-neutral-50 hover:text-neutral-700 active:bg-neutral-100"
      >
        <ArrowLeftIcon className="h-5 w-5" aria-hidden="true" />
        返回修改手机号
      </button>

      <h2 className="text-xl font-bold text-neutral-800">输入验证码</h2>
      <p className="mt-1 text-sm text-neutral-500">
        已发送至 <span className="font-medium text-neutral-700">{formatPhone(phone)}</span>
      </p>

      {/* 验证码方块 */}
      <div className="mt-6 flex justify-center">
        <CodeBoxes value={code} />
      </div>

      {/* 错误提示 */}
      {error && (
        <p className="mt-3 text-center text-sm font-medium text-error">{error}</p>
      )}

      {/* 数字键盘 */}
      <KioskNumPad
        value={code}
        maxLength={CODE_LENGTH}
        onChange={onCodeChange}
        onConfirm={canLogin ? onLogin : undefined}
        confirmDisabled={!canLogin}
        confirmLabel={loading ? '验证中…' : '登录'}
        className="mt-5"
      />

      {/* 登录按钮 */}
      <button
        type="button"
        onClick={onLogin}
        disabled={!canLogin}
        className="mt-4 w-full rounded-xl bg-primary-600 py-4 text-base font-semibold text-white shadow-sm transition-colors active:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? '验证中…' : '登录'}
      </button>

      {/* 重发倒计时 */}
      <div className="mt-4 text-center">
        {countdown > 0 ? (
          <span className="text-sm text-neutral-400">
            {countdown} 秒后可重新发送
          </span>
        ) : (
          <button
            type="button"
            onClick={onResend}
            disabled={!canResend}
            className="text-sm font-medium text-primary-600 hover:text-primary-700 disabled:opacity-40"
          >
            重新发送验证码
          </button>
        )}
      </div>
    </div>
  )
}
