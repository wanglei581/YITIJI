import { useKioskSessionControl } from '../../auth/KioskSessionControlContext'
import { usePrintSessionDeferred } from '../../hooks/useTerminalSessionState'
import { END_THIS_USE_LABEL } from './printSessionHoldCopy'

/** 压着没恢复时才出现。走现成的结束使用，不另造清场。 */
export function EndThisUseButton({ testId = 'print-session-end-use' }: { testId?: string }) {
  const deferred = usePrintSessionDeferred()
  const { endKioskUse } = useKioskSessionControl()
  if (!deferred) return null
  return (
    <button
      type="button"
      className="qx-btn"
      data-variant="primary"
      data-testid={testId}
      style={{ minHeight: 56 }}
      onClick={() => endKioskUse('end_use')}
    >
      {END_THIS_USE_LABEL}
    </button>
  )
}
