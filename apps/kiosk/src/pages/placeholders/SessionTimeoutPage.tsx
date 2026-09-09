import { useCallback, useEffect, useState } from 'react'
import { useKioskSessionControl } from '../../auth/KioskSessionControlContext'
import { KioskStageFit } from '../../components/kiosk-shell/KioskStageFit'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { SessionGuardView } from '../session-guard/SessionGuardView'
import {
  deriveSessionGuardState,
  remainingSeconds,
  SESSION_GUARD_PILL,
} from '../session-guard/sessionGuardModel'
import '../session-guard/styles/session-guard-qx.css'

export default function SessionTimeoutPage() {
  const { warning, continueSession, hardClear, clearToScreensaver } = useKioskSessionControl()
  const [fallbackDeadlineAt] = useState(() => Date.now() + 30 * 1000)
  const deadlineAt = warning?.deadlineAt ?? fallbackDeadlineAt
  const [seconds, setSeconds] = useState(() => remainingSeconds(deadlineAt, Date.now()))

  const expireFromCountdown = useCallback(() => {
    if (warning?.exitTo === 'screensaver') {
      clearToScreensaver()
      return
    }
    hardClear()
  }, [clearToScreensaver, hardClear, warning?.exitTo])

  useEffect(() => {
    const updateCountdown = (): void => {
      const remaining = remainingSeconds(deadlineAt, Date.now())
      setSeconds(remaining)
      if (remaining === 0) expireFromCountdown()
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
  const sourcePath = warning?.sourcePath ?? ''
  const sourceKnown = sourcePath !== '' && sourcePath !== '/'
  const state = deriveSessionGuardState({ clearing: false, canContinue })
  const pill = SESSION_GUARD_PILL[state]

  return (
    <div
      className="fusion-w5 fusion-w5--system k8-system-page k8-session-timeout"
      data-kiosk-screen="session-timeout"
      data-kiosk-presentation="fusion-youth"
      data-kiosk-viewport="kiosk"
    >
      <KioskStageFit>
        <QxPageFrame
          title="会话守卫"
          subtitle="公共终端闲置后的隐私清场。倒计时由本机时钟执行。"
          status={pill}
          ctabar={
            <>
              <button
                type="button"
                className="qx-btn"
                data-variant="danger"
                data-testid="session-guard-clear"
                onClick={hardClear}
              >
                结束并清除本机会话
              </button>
              {canContinue ? (
                <button
                  type="button"
                  className="qx-btn"
                  data-variant="primary"
                  data-testid="session-guard-primary"
                  onClick={continueSession}
                  aria-label={sourceKnown ? `我还在，继续使用，回到 ${sourcePath}` : '我还在，继续使用；来源页不可用，只能回首页重新进入'}
                >
                  {sourceKnown ? '我还在，继续使用' : '我还在，继续使用（回首页）'}
                </button>
              ) : null}
            </>
          }
        >
          <SessionGuardView
            state={state}
            seconds={seconds}
            sourcePath={sourcePath}
            sourceKnown={sourceKnown}
          />
        </QxPageFrame>
      </KioskStageFit>
    </div>
  )
}
