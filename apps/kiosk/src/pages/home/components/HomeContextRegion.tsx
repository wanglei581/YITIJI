import type { ReactNode } from 'react'
import { HistoryIcon } from 'lucide-react'
import { dismissSessionRecoveryNotice } from '../../../hooks/useSessionRecoveryNotice'

/**
 * 首页「继续上次办理」那一块。没有待继续的办理时显示空态；本机会话换新票清过场时，
 * 空态里多一行提示。点这一块里的任何入口（继续办理）就把提示收掉，不留给下一位。
 */
export function HomeContextRegion({
  continueSlot,
  standbyNote,
  recoveryNotice,
}: {
  continueSlot?: ReactNode
  standbyNote: string
  recoveryNotice: string | null
}) {
  return (
    <div className="qx-home-continue" data-testid="home-context-region" onClickCapture={dismissSessionRecoveryNotice}>
      {continueSlot}
      <div className="qx-home-empty-context" role="status">
        <span className="qx-home-context-icon" aria-hidden="true"><HistoryIcon /></span>
        <span>
          <strong>这台机器上没有待继续的办理</strong>
          <small>{standbyNote}</small>
          {recoveryNotice ? <small data-testid="home-session-recovery-notice">{recoveryNotice}</small> : null}
        </span>
      </div>
    </div>
  )
}
