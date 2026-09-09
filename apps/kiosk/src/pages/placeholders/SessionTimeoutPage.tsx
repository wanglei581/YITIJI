import { useCallback, useEffect, useState } from 'react'
import {
  CheckIcon,
  FileTextIcon,
  LogOutIcon,
  MessageCircleIcon,
  ShieldCheckIcon,
  UserRoundIcon,
} from 'lucide-react'
import { useKioskSessionControl } from '../../auth/KioskSessionControlContext'
import { useAuth } from '../../auth/useAuth'
import './system-pages-batch8.css'

const RING_RADIUS = 135
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

export default function SessionTimeoutPage() {
  const { user } = useAuth()
  const { warning, continueSession, hardClear, clearToScreensaver } = useKioskSessionControl()
  const [fallbackDeadlineAt] = useState(() => Date.now() + 30 * 1000)
  const deadlineAt = warning?.deadlineAt ?? fallbackDeadlineAt
  const [initialDuration] = useState(() => Math.max(1, Math.ceil((deadlineAt - Date.now()) / 1000)))
  const [seconds, setSeconds] = useState(() =>
    Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000))
  )

  const expireFromCountdown = useCallback(() => {
    if (warning?.exitTo === 'screensaver') {
      clearToScreensaver()
      return
    }
    hardClear()
  }, [clearToScreensaver, hardClear, warning?.exitTo])

  useEffect(() => {
    const updateCountdown = (): void => {
      const remainingSeconds = Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000))
      setSeconds(remainingSeconds)
      if (remainingSeconds === 0) expireFromCountdown()
    }

    updateCountdown()
    const timer = window.setInterval(updateCountdown, 1000)
    return () => window.clearInterval(timer)
  }, [deadlineAt, expireFromCountdown])

  const sourcePath = warning?.sourcePath ?? ''
  // 带斜杠的 startsWith 判不中**域根本身**：'/interview' 不匹配 '/interview/'。
  // 本 PR 把 /interview/{setup,session,tips,report,reports} 合成一张工作台 /interview
  // 之后，从工作台触发的会话告警就落到了通用清场文案「登录状态和本机临时会话将清除」，
  // 而它握着用户没保存的练习内容。/print /scan /resume 是同一个 bug，只是暂时没有
  // 域根路由走到（/print 域根在路由表里根本不存在）——改成通用谓词，将来加了自动生效。
  const inDomain = (root: string) => sourcePath === root || sourcePath.startsWith(`${root}/`)
  const isHardware = inDomain('/print') || inDomain('/scan')
  const isAiWork = sourcePath === '/assistant' || inDomain('/resume') || inDomain('/interview')
  const sessionImpact = isHardware
    ? '已创建的打印/扫描任务会继续运行，终端页面将清除'
    : isAiWork
      ? '未保存的填写内容或练习内容会清除'
      : '登录状态和本机临时会话将清除'
  const canContinue = warning?.canContinue === true

  const isAnonymous = user === null
  const accountLabel = user
    ? [user.nickname, user.phoneMasked].filter(Boolean).join(' · ')
    : '当前临时会话'
  const ringRatio = Math.min(1, Math.max(0, seconds / initialDuration))
  const ringOffset = RING_CIRCUMFERENCE * (1 - ringRatio)

  return (
    <main
      className="fusion-w5 fusion-w5--system k8-system-page k8-session-timeout"
      data-kiosk-screen="session-timeout"
      data-kiosk-presentation="fusion-youth"
      data-kiosk-viewport="kiosk"
    >
      <div className="k8-system-ghost" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="k8-system-dim" aria-hidden="true" />
      <div className="k8-timeout-wrap">
        <section
          className="k8-timeout-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="session-timeout-title"
        >
          <div className="k8-timeout-ring">
            <svg viewBox="0 0 300 300" aria-hidden="true">
              <circle className="k8-timeout-ring-bg" cx="150" cy="150" r={RING_RADIUS} />
              <circle
                className="k8-timeout-ring-value"
                cx="150"
                cy="150"
                r={RING_RADIUS}
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={ringOffset}
              />
            </svg>
            <div>
              <strong>{seconds}</strong>
              <span>秒后自动退出</span>
            </div>
          </div>

          <h1 id="session-timeout-title">还在使用吗？</h1>
          <p className="k8-timeout-description">
            长时间未操作，公共终端将进行隐私清场。
            <br />
            <strong>{sessionImpact}</strong>
            {isHardware ? (
              <>
                <br />
                <span>清场不会取消已创建的打印/扫描任务</span>
              </>
            ) : null}
            <br />
            {user === null ? (
              <span>匿名任务退出后无法恢复</span>
            ) : (
              <span>账号中已保存的数据不受本次终端清场影响</span>
            )}
          </p>
          <p className="k8-timeout-account">
            <UserRoundIcon />
            <span>
              {isAnonymous ? '当前会话：' : '当前登录：'}
              <b>{accountLabel}</b>
            </span>
          </p>

          <ul className="k8-timeout-clean-list">
            <li>
              <LogOutIcon />
              <span>
                {isAnonymous ? (
                  <>
                    <b>匿名使用</b>
                    <small>清除本次匿名会话</small>
                  </>
                ) : (
                  <>
                    <b>登录状态</b>
                    <small>退出账号，下次需重新验证</small>
                  </>
                )}
              </span>
            </li>
            <li>
              <FileTextIcon />
              <span>
                <b>本次上传文件缓存</b>
                <small>
                  {user ? '账号中已保存的数据不受影响' : '匿名会话清场后不保留恢复入口'}
                </small>
              </span>
            </li>
            <li>
              <MessageCircleIcon />
              <span>
                <b>AI 助手对话</b>
                <small>共享终端未保存内容不留存</small>
              </span>
            </li>
          </ul>

          <div className="k8-timeout-actions">
            <button
              type="button"
              className="is-primary"
              onClick={canContinue ? continueSession : hardClear}
            >
              <CheckIcon />
              {canContinue ? '继续使用' : '返回首页并清除本机会话'}
            </button>
            <button type="button" onClick={hardClear}>
              <LogOutIcon />
              立即退出并清除本机会话
            </button>
          </div>
        </section>

        <p className="k8-system-notice">
          <ShieldCheckIcon />
          任务处理中会暂缓普通提醒，但达到最长安全时限后仍会自动清场；已创建的后台打印/扫描任务继续运行。
        </p>
      </div>
    </main>
  )
}
