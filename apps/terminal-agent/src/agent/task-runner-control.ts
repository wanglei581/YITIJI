export interface TaskRunnerWakeResult {
  accepted: boolean
  coalesced: boolean
}

export interface TaskRunnerControl {
  timer: NodeJS.Timeout
  wake: () => TaskRunnerWakeResult
  stop: () => void
}

interface TaskRunnerControlOptions {
  intervalMs: number
  enabled?: boolean
  runCycle: () => Promise<void>
  onCycleError: (error: unknown) => void
}

/** Serializes interval ticks and local wake requests across the full task cycle. */
export function createTaskRunnerControl(options: TaskRunnerControlOptions): TaskRunnerControl {
  const { intervalMs, enabled = true, runCycle, onCycleError } = options
  let stopped = false
  let inFlight = false
  let rerunRequested = false

  const requestCycle = (): TaskRunnerWakeResult => {
    if (!enabled || stopped) return { accepted: false, coalesced: false }
    if (inFlight) {
      rerunRequested = true
      return { accepted: true, coalesced: true }
    }

    inFlight = true
    void Promise.resolve()
      .then(runCycle)
      .catch(onCycleError)
      .finally(() => {
        inFlight = false
        if (!stopped && rerunRequested) {
          rerunRequested = false
          requestCycle()
        }
      })

    return { accepted: true, coalesced: false }
  }

  const timer = setInterval(() => {
    requestCycle()
  }, intervalMs)
  timer.unref()

  return {
    timer,
    wake: requestCycle,
    stop: () => {
      stopped = true
      rerunRequested = false
      clearInterval(timer)
    },
  }
}
