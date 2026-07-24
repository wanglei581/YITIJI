import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { CheckIcon, FileTextIcon, LogOutIcon, MessageCircleIcon, ShieldCheckIcon, UserRoundIcon } from 'lucide-react'
import { isSafeInternalPath } from '../../auth/returnPath'
import { useAuth } from '../../auth/useAuth'
import './system-pages-batch8.css'

const TIMEOUT_SECONDS = 30
const RING_RADIUS = 135
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

export default function SessionTimeoutPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout } = useAuth()
  const [seconds, setSeconds] = useState(TIMEOUT_SECONDS)
  const returnTo = useMemo(() => {
    const candidate = (location.state as { from?: unknown } | null)?.from
    return typeof candidate === 'string' && candidate !== '/session-timeout' && isSafeInternalPath(candidate)
      ? candidate
      : '/'
  }, [location.state])

  const exitSession = useCallback(() => {
    logout()
    navigate('/', { replace: true })
  }, [logout, navigate])

  useEffect(() => {
    if (seconds <= 0) {
      exitSession()
      return undefined
    }
    const timer = window.setTimeout(() => setSeconds((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [exitSession, seconds])

  const accountLabel = user
    ? [user.nickname, user.phoneMasked].filter(Boolean).join(' · ')
    : '当前临时会话'
  const ringOffset = RING_CIRCUMFERENCE * (1 - seconds / TIMEOUT_SECONDS)

  return (
    <main className="fusion-w5 fusion-w5--system k8-system-page k8-session-timeout" data-kiosk-screen="session-timeout" data-kiosk-presentation="fusion-youth">
      <div className="k8-system-ghost" aria-hidden="true"><i /><i /><i /><i /><i /></div>
      <div className="k8-system-dim" aria-hidden="true" />
      <div className="k8-timeout-wrap">
        <section className="k8-timeout-card" role="dialog" aria-modal="true" aria-labelledby="session-timeout-title">
          <div className="k8-timeout-ring">
            <svg viewBox="0 0 300 300" aria-hidden="true">
              <circle className="k8-timeout-ring-bg" cx="150" cy="150" r={RING_RADIUS} />
              <circle className="k8-timeout-ring-value" cx="150" cy="150" r={RING_RADIUS} strokeDasharray={RING_CIRCUMFERENCE} strokeDashoffset={ringOffset} />
            </svg>
            <div><strong>{seconds}</strong><span>秒后自动退出</span></div>
          </div>

          <h1 id="session-timeout-title">还在使用吗？</h1>
          <p className="k8-timeout-description">长时间未操作，即将退出登录并清除本机临时会话；<br />已保存到你账号的数据不受影响。如需继续，请点击下方按钮。</p>
          <p className="k8-timeout-account"><UserRoundIcon /><span>当前登录：<b>{accountLabel}</b></span></p>

          <ul className="k8-timeout-clean-list">
            <li><LogOutIcon /><span><b>登录状态</b><small>退出账号，下次需重新验证</small></span></li>
            <li><FileTextIcon /><span><b>本次上传文件缓存</b><small>已保存到「我的」的不受影响</small></span></li>
            <li><MessageCircleIcon /><span><b>AI 助手对话</b><small>共享终端对话不留存</small></span></li>
          </ul>

          <div className="k8-timeout-actions">
            <button type="button" className="is-primary" onClick={() => navigate(returnTo, { replace: true })}><CheckIcon />继续使用</button>
            <button type="button" onClick={exitSession}><LogOutIcon />立即退出并清除本机会话</button>
          </div>
        </section>

        <p className="k8-system-notice"><ShieldCheckIcon />为保护您的隐私，公共设备将在超时后自动退出登录并清理本机会话；打印、扫描或 AI 任务进行中不会弹出本提醒。</p>
      </div>
    </main>
  )
}
