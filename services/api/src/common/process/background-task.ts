// ============================================================
// 后台周期任务与进程级兜底
//
// 为什么要有：定时器回调里写 `void this.xxx()`，xxx 一旦 reject（例如 Prisma P2028：事务 5 秒内
// 起不来），就是一次「未处理的 Promise 拒绝」。Node 22 默认直接退出进程——整个 API 停摆，
// 一体机、小程序、后台的请求在 PM2 拉起之前全部失败（走查 10/4、10/6 在本地复现两次）。
//
// 规则：
//   - 定时器里跑异步任务一律用 scheduleBackground / runBackground，错误在本处收住、记日志、下一轮再试。
//   - 日志只记错误类型与错误码（Prisma 的 P2028 之类）和抛出位置，不记 message——message 可能带
//     用户输入、手机号或 SQL 片段。
//   - 进程级 unhandledRejection 兜底：记日志并推企业微信告警（每小时最多一次），不退出进程。
//     同步抛出的未捕获异常（uncaughtException）不在这里兜，仍按 Node 默认退出、由 PM2 拉起——
//     那说明状态可能已经坏了，硬撑着更危险。
// 门禁：scripts/verify-background-task-safety.ts。
// ============================================================

type ErrorSink = (error: unknown) => void

/** 只取错误类型、错误码、抛出位置；不取 message。 */
export function describeBackgroundError(error: unknown): string {
  if (!error || typeof error !== 'object') return `type=${typeof error}`
  const e = error as { name?: unknown; code?: unknown; constructor?: { name?: unknown }; stack?: unknown }
  const name = typeof e.name === 'string' ? e.name : typeof e.constructor?.name === 'string' ? e.constructor.name : 'Object'
  const code = typeof e.code === 'string' || typeof e.code === 'number' ? ` code=${String(e.code)}` : ''
  const at = typeof e.stack === 'string' ? firstFrame(e.stack) : null
  return `type=${name}${code}${at ? ` at=${at}` : ''}`
}

function firstFrame(stack: string): string | null {
  const line = stack.split('\n').find((row) => row.trim().startsWith('at '))
  if (!line) return null
  const match = /\(?([^()\s]+:\d+:\d+)\)?\s*$/.exec(line.trim())
  if (!match) return null
  const path = match[1]!
  const idx = path.lastIndexOf('/src/')
  return idx >= 0 ? path.slice(idx + 1) : path.split('/').slice(-2).join('/')
}

/** 跑一次后台异步任务：错误交给 onError，绝不变成未处理的拒绝。 */
export function runBackground(task: () => Promise<unknown>, onError: ErrorSink): void {
  let pending: Promise<unknown>
  try {
    pending = task()
  } catch (error) {
    safeSink(onError, error)
    return
  }
  pending.catch((error: unknown) => safeSink(onError, error))
}

/** 周期跑后台异步任务。任务失败只记一次错误，下一轮照常再试；返回的定时器已 unref。 */
export function scheduleBackground(task: () => Promise<unknown>, intervalMs: number, onError: ErrorSink): NodeJS.Timeout {
  const timer = setInterval(() => runBackground(task, onError), intervalMs)
  timer.unref()
  return timer
}

function safeSink(onError: ErrorSink, error: unknown): void {
  try {
    onError(error)
  } catch {
    // 记日志本身失败也不能把进程带走。
  }
}

export interface UnhandledRejectionGuardOptions {
  log: (line: string) => void
  /** 推告警。summary 只含 describeBackgroundError 的内容；按小时去重由调用方（deliverOpsAlert）负责。 */
  alert?: (summary: string, hourBucket: string) => Promise<void>
  now?: () => Date
}

/**
 * 进程级兜底：未处理的 Promise 拒绝 → 记日志 + 推告警，进程不退出。
 * 返回卸载函数（门禁用）。
 */
export function installUnhandledRejectionGuard(options: UnhandledRejectionGuardOptions): () => void {
  const now = options.now ?? (() => new Date())
  const listener = (reason: unknown) => {
    const summary = describeBackgroundError(reason)
    try {
      options.log(`UNHANDLED_REJECTION ${summary}`)
    } catch {
      // 同上：兜底自身不能抛。
    }
    if (options.alert) {
      const hourBucket = now().toISOString().slice(0, 13)
      options.alert(summary, hourBucket).catch(() => undefined)
    }
  }
  process.on('unhandledRejection', listener)
  return () => {
    process.off('unhandledRejection', listener)
  }
}
