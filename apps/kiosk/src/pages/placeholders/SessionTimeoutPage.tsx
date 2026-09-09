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
  // 各域多页合并成工作台后，路径从 /scan/start 变成 /scan?stage=start，
  // sourcePath（= location.pathname）就是 /scan 本身。只判 startsWith('/scan/')
  // 会漏掉合并后的工作台，用户会被告知通用清场话术，而不是「你的扫描会继续跑」。
  // 所以域根和子路径都要认。
  const inDomain = (root: string) => sourcePath === root || sourcePath.startsWith(`${root}/`)
  const isHardware = inDomain('/print') || inDomain('/scan')
  // 这两页握着用户当场做的、还没提交的活：/print-scan/convert 是已选好待转 PDF 的图片，
  // /print-scan/sign 是已上传的文档 + 印章 + 落章位置。清场会全部丢掉，必须说出来。
  // **逐条列，不能用 inDomain('/print-scan')** —— /print-scan 本身是入口 Hub，
  // 上面没有未保存的东西，套进来就成了吓唬人。
  const EDITING_ROUTES = ['/print-scan/convert', '/print-scan/sign']
  const isAiWork =
    sourcePath === '/assistant' ||
    inDomain('/resume') ||
    inDomain('/interview') ||
    EDITING_ROUTES.includes(sourcePath)
  const sessionImpact = isHardware
    ? '已创建的打印/扫描任务会继续运行，终端页面将清除'
    : isAiWork
      ? '未保存的填写、编辑或练习内容会清除'
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
