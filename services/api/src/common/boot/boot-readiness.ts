/**
 * 启动期外部依赖的「有界等待 + 显式降级」原语。
 *
 * 背景（实测复现，见 docs/progress/current-progress.md）：
 * Redis 不可达时 `MemberPrivacyScheduler.onModuleInit()` 里的
 * `queue.upsertJobScheduler()` **永不 settle**（BullMQ 给自建连接强制
 * `maxRetriesPerRequest: null`，ioredis 把命令无限排进 offline queue，
 * 既不报错也不超时），于是 Nest 的 `onModuleInit` 永远不返回、
 * `app.listen()` 永远到不了 —— 进程活着、端口是死的、日志里没有启动失败线索。
 * 那段 `try/catch` 是死代码：promise 从不 reject，catch 永远不会命中。
 *
 * 本文件提供两件事：
 * 1. `withBootTimeout()` —— 任何 `onModuleInit` / `onApplicationBootstrap` 里
 *    等待外部资源都必须经过它，保证「等不到」是有界的、会抛出的事件。
 * 2. `bootReadiness` —— 子系统启动状态登记表。降级必须写进这里，
 *    `/api/v1/health` 与 `/api/v1/health/ready` 如实读出，禁止笼统回 ok。
 *
 * 启动语义（本项目取 degraded-start，理由见 PR 正文与 redis.module.ts 注释）：
 * - 数据库不可用 = 硬依赖，启动失败退出，进程管理器可见；
 * - Redis 不可用 = 软依赖，进程照常 listen，但相关能力进入**显式**降级态，
 *   日志有可搜索错误行，健康检查如实暴露。绝不静默吞掉。
 */

/** 降级日志的统一可搜索前缀。运维按这个词 grep 就能定位启动期依赖问题。 */
export const BOOT_DEGRADED_LOG_MARKER = 'BOOT_DEPENDENCY_DEGRADED'
/** 恢复日志前缀（降级后外部依赖回来了）。 */
export const BOOT_RECOVERED_LOG_MARKER = 'BOOT_DEPENDENCY_RECOVERED'

export type BootSubsystemStatus = 'ok' | 'degraded'

export interface BootSubsystemState {
  /** 子系统标识，例如 redis / member-privacy-scheduler / database。 */
  subsystem: string
  status: BootSubsystemStatus
  /** 机器可读代码，例如 REDIS_UNREACHABLE_AT_BOOT。 */
  code: string
  /** 人读说明：出了什么问题、影响什么能力、下一步查什么。不得含密钥。 */
  message: string
  /** 进入当前状态的时间（ISO）。 */
  since: string
}

/**
 * 启动期依赖等待超时。区别于业务异常：命中它说明外部依赖在启动期没有在
 * 约定时间内响应，而不是响应了一个错误。
 */
export class BootDependencyTimeoutError extends Error {
  constructor(
    readonly subsystem: string,
    readonly operation: string,
    readonly timeoutMs: number,
  ) {
    super(`启动期依赖等待超时：subsystem=${subsystem} operation=${operation} timeoutMs=${timeoutMs}`)
    this.name = 'BootDependencyTimeoutError'
  }
}

/**
 * 有界等待一个启动期外部依赖操作。
 *
 * 正常路径完全不改变行为：`op()` 在超时前 resolve 就原样返回它的值，
 * reject 就原样抛它的错误。只有「既不 resolve 也不 reject」这一种情况
 * 会被转成 `BootDependencyTimeoutError`。
 *
 * 超时后原始 promise 不会被取消（也无法取消 —— ioredis 的 offline queue
 * 会在 Redis 恢复后自己把命令发出去）。调用方可以用 `onSettleAfterTimeout`
 * 观察这个迟到的结果，从而在依赖恢复时把子系统标回 ok。
 */
export async function withBootTimeout<T>(
  op: () => Promise<T>,
  options: {
    subsystem: string
    operation: string
    timeoutMs: number
    /** 超时之后原始 promise 才 settle 时的回调（用于「迟到恢复」）。 */
    onSettleAfterTimeout?: (result: { ok: true; value: T } | { ok: false; error: unknown }) => void
  },
): Promise<T> {
  const { subsystem, operation, timeoutMs, onSettleAfterTimeout } = options
  const pending = op()
  let timedOut = false

  // 挂一个 no-op handler，避免超时后原始 promise 迟到 reject 触发
  // unhandledRejection 把进程打挂。Promise.race 仍然能观察到它的结果。
  pending.then(
    (value) => { if (timedOut) onSettleAfterTimeout?.({ ok: true, value }) },
    (error) => { if (timedOut) onSettleAfterTimeout?.({ ok: false, error }) },
  )

  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true
      reject(new BootDependencyTimeoutError(subsystem, operation, timeoutMs))
    }, timeoutMs)
    // 不阻止进程退出：超时定时器本身不该成为「进程活着」的理由。
    timer.unref?.()
  })

  try {
    return await Promise.race([pending, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 从 env 读一个正整数超时；缺省或非法值回落到 fallback。 */
export function readTimeoutMs(envKey: string, fallbackMs: number): number {
  const raw = process.env[envKey]
  if (!raw) return fallbackMs
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs
}

class BootReadinessRegistry {
  private readonly states = new Map<string, BootSubsystemState>()

  markOk(subsystem: string, code: string, message: string): void {
    this.states.set(subsystem, { subsystem, status: 'ok', code, message, since: new Date().toISOString() })
  }

  markDegraded(subsystem: string, code: string, message: string): void {
    this.states.set(subsystem, { subsystem, status: 'degraded', code, message, since: new Date().toISOString() })
  }

  /** 当前是否已登记为降级（用于避免重复打恢复日志）。 */
  isDegraded(subsystem: string): boolean {
    return this.states.get(subsystem)?.status === 'degraded'
  }

  snapshot(): BootSubsystemState[] {
    return [...this.states.values()].sort((a, b) => a.subsystem.localeCompare(b.subsystem))
  }

  degraded(): BootSubsystemState[] {
    return this.snapshot().filter((s) => s.status === 'degraded')
  }

  hasDegraded(): boolean {
    return this.snapshot().some((s) => s.status === 'degraded')
  }

  /** 仅供 verify / 测试重置，业务代码不要调用。 */
  reset(): void {
    this.states.clear()
  }
}

/**
 * 进程级单例。刻意不走 Nest DI：启动期状态需要被 `main.ts`、任意模块的
 * lifecycle hook 和 HealthController 共同读写，DI 反而增加装配顺序耦合。
 */
export const bootReadiness = new BootReadinessRegistry()

export const REDIS_SUBSYSTEM = 'redis'
export const DATABASE_SUBSYSTEM = 'database'
export const MEMBER_PRIVACY_SCHEDULER_SUBSYSTEM = 'member-privacy-scheduler'
