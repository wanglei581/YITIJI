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
