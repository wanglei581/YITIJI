import { useEffect, useState } from 'react'
import {
  retryScanCleanupNow,
  type ScanCleanupOutcome,
  type ScanCleanupStatus,
} from '../pages/scan/scanCleanupGate'

/**
 * 清场遮罩。两种形态，判据只有一个：**服务端那一头收完尾了没有**。
 *
 * · 收完了（绝大多数情况，包括压根没有扫描会话）—— 只有一句「正在清除本机会话」，
 *   和这条闸出现之前一模一样，一帧都不多留；
 * · 没收完 —— 多出下面这块「锁住等确认」的说明。它**不是**一个进度动画，
 *   它要回答用户此刻真正会问的三件事：我的东西清了没有、这机器为什么不让我用、
 *   还要多久。少任何一件，屏幕上就只剩一块吃掉所有触摸的黑板。
 *
 * 这一屏一个凭证、一个任务编号、一句服务端原文都不许出现（CLAUDE.md §11）：
 * 27 寸竖屏摆在人才市场大厅，站在旁边的人和使用者看到的是同一块屏。
 * 状态只按 {@link ScanCleanupOutcome} 那四种收敛值翻译成中文。
 */

const OUTCOME_TEXT: Record<ScanCleanupOutcome, string> = {
  none: '正在向服务端确认',
  unreachable: '最近一次没能连上服务端',
  'server-error': '服务端暂时没有给出结论',
  rejected: '服务端没有接受本机这次取消',
}

function formatRemaining(deadlineAt: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((deadlineAt - now) / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

function CleanupHoldPanel({ status }: { status: ScanCleanupStatus }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className="qx-clearing-hold" data-testid="session-guard-cleanup-hold">
      <h2>正在确认上一场扫描已经取消</h2>
      <p className="qx-clearing-note">
        本机这一份使用记录已经清掉了。还差最后一步：等服务端亲口确认上一场扫描任务已经取消。
      </p>
      <p className="qx-clearing-note">
        确认之前这台机器不交给下一位 —— 否则在打印机面板上扫出来的文件，可能会被投递给刚才那一位。
      </p>
      <p className="qx-clearing-status" data-testid="session-guard-cleanup-status">
        {OUTCOME_TEXT[status.lastOutcome]} · 已发出 {status.attempts} 次取消请求
      </p>
      {status.deadlineAt === null ? null : (
        <p className="qx-clearing-status" data-testid="session-guard-cleanup-deadline">
          {/* 服务端给的有效期，不是本机自己定的宽限：过了这个时刻，服务端的租约查询
              （expiresAt > now）再也签不出这一场，文件不会投给任何人。 */}
          最迟 {formatRemaining(status.deadlineAt, now)} 后这一场会到服务端给的有效期，届时它也不会再收到文件。
        </p>
      )}
      <button
        type="button"
        className="qx-clearing-retry"
        data-testid="session-guard-cleanup-retry"
        onClick={retryScanCleanupNow}
      >
        立即重试
      </button>
      <p className="qx-clearing-note">一直不成，请叫现场工作人员看一眼这台机器的网络。</p>
    </div>
  )
}

export function KioskClearingOverlay({ cleanup }: { cleanup: ScanCleanupStatus }) {
  return (
    <div
      className="qx-privacy-clearing pointer-events-auto"
      data-kiosk-privacy-clearing="true"
      data-screen="session-guard"
      data-state="clearing"
      data-cleanup={cleanup.holding ? 'holding' : 'settled'}
      data-testid="session-guard-state-clearing"
      role="status"
      aria-live="assertive"
    >
      <p>正在清除本机会话</p>
      <span className="sr-only">正在清除本次使用记录</span>
      {cleanup.holding ? <CleanupHoldPanel status={cleanup} /> : null}
    </div>
  )
}
