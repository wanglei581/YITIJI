import { SESSION_RECOVERY_NOTICE, useSessionRecoveryNotice } from '../../hooks/useSessionRecoveryNotice'
import { usePrintSessionBlocked, usePrintSessionDeferred } from '../../hooks/useTerminalSessionState'
import { EndThisUseButton } from './EndThisUseButton'
import { PRINT_SESSION_DEFERRED_LINE, PRINT_SESSION_RETRY_LINE } from './printSessionHoldCopy'

/** 打印线被拦或 print-only 清场时，嵌在现成页面顶部的那一块。不新造整页。 */
export function PrintFlowRecoveryStrip({
  noticeTestId,
  holdTestId,
  belowGuide = false,
}: {
  noticeTestId: string
  holdTestId: string
  /** 打印台各页挂在页头大卡下面，和下面的设备条一样上留 14px；到机码页挂在正文最上面。 */
  belowGuide?: boolean
}) {
  const notice = useSessionRecoveryNotice()
  const printNotice = notice === SESSION_RECOVERY_NOTICE ? notice : null
  const blocked = usePrintSessionBlocked()
  const deferred = usePrintSessionDeferred()
  if (!printNotice && !blocked) return null
  return (
    <div className="qx-card" style={{ margin: belowGuide ? '14px 0 0' : '0 0 12px', padding: '16px 18px' }}>
      {printNotice ? (
        <p data-testid={noticeTestId} role="status" style={{ margin: '0 0 8px', fontSize: 'var(--qx-fs-body)', lineHeight: 'var(--qx-lh-body)' }}>
          {printNotice}
        </p>
      ) : null}
      {blocked ? (
        <div data-testid={holdTestId} role="status">
          <p style={{ margin: '0 0 12px', fontSize: 'var(--qx-fs-body)', lineHeight: 'var(--qx-lh-body)' }}>
            {deferred ? PRINT_SESSION_DEFERRED_LINE : PRINT_SESSION_RETRY_LINE}
          </p>
          {deferred ? <EndThisUseButton /> : null}
        </div>
      ) : null}
    </div>
  )
}

/** 确认页的清场句。failed 的那一句仍走确认页自己的提示条。 */
export function PrintRecoveryNotice({ testId }: { testId: string }) {
  const notice = useSessionRecoveryNotice()
  if (notice !== SESSION_RECOVERY_NOTICE) return null
  return (
    <p className="qx-card" data-testid={testId} role="status" style={{ margin: '0 0 12px', padding: '16px 18px', fontSize: 'var(--qx-fs-body)', lineHeight: 'var(--qx-lh-body)' }}>
      {notice}
    </p>
  )
}
