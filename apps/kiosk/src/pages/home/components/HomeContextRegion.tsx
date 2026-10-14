import type { ReactNode } from 'react'
import { HistoryIcon } from 'lucide-react'

/**
 * 首页「继续上次办理」那一块。没有待继续的办理时显示空态。本机会话换新票清过场时，
 * 这一块最上面多一行提示，单独一行、不在空态里（有待继续卡时空态被藏，句子仍看得见）。
 * 收起不挂在这一块上：句子亮起后的下一次触屏、进待机屏、到点，都会收。
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
    <div className="qx-home-continue" data-testid="home-context-region">
      {continueSlot}
      {recoveryNotice ? (
        <p className="qx-home-recovery-notice" data-testid="home-session-recovery-notice" role="status">
          {recoveryNotice}
        </p>
      ) : null}
      <div className="qx-home-empty-context" role="status">
        <span className="qx-home-context-icon" aria-hidden="true"><HistoryIcon /></span>
        <span>
          <strong>这台机器上没有待继续的办理</strong>
          <small>{standbyNote}</small>
        </span>
      </div>
    </div>
  )
}
