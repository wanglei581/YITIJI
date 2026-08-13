export interface TaskRunnerWakeResult {
  accepted: boolean
  coalesced: boolean
}

export interface TaskRunnerControl {
  timer: NodeJS.Timeout
  wake: () => TaskRunnerWakeResult
  pause: () => void
  resume: () => void
  drain: (timeoutMs: number) => Promise<boolean>
  getStatus: () => TaskRunnerControlStatus
  stop: () => void
}

export interface TaskRunnerControlStatus {
  accepting: boolean
  inFlight: boolean
  rerunRequested: boolean
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
  let paused = false
  let inFlight = false
  let rerunRequested = false
  const idleWaiters = new Set<() => void>()

  const notifyIdle = (force = false): void => {
    if (inFlight && !force) return
    for (const resolve of idleWaiters) resolve()
    idleWaiters.clear()
  }

  const requestCycle = (): TaskRunnerWakeResult => {
    if (!enabled || stopped || paused) return { accepted: false, coalesced: false }
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
        notifyIdle()
        if (!stopped && !paused && rerunRequested) {
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
    pause: () => {
      paused = true
      rerunRequested = false
    },
    resume: () => {
      if (!enabled || stopped) return
      paused = false
    },
    drain: async (timeoutMs: number) => {
      paused = true
      rerunRequested = false
      if (!inFlight) return true
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return false

      return new Promise<boolean>((resolve) => {
        let settled = false
        let timeoutHandle: NodeJS.Timeout | undefined
        const finish = (result: boolean): void => {
          if (settled) return
          settled = true
          if (timeoutHandle) clearTimeout(timeoutHandle)
          idleWaiters.delete(onIdle)
          resolve(result)
        }
        const onIdle = (): void => finish(true)
        timeoutHandle = setTimeout(() => finish(false), timeoutMs)
        timeoutHandle.unref()
        idleWaiters.add(onIdle)
      })
    },
    getStatus: () => ({
      accepting: enabled && !stopped && !paused,
      inFlight,
      rerunRequested,
    }),
    stop: () => {
      stopped = true
      paused = true
      rerunRequested = false
      clearInterval(timer)
      notifyIdle(true)
    },
  }
}
