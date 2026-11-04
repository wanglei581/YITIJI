/**
 * agent/device-lock.ts — 打印扫描一体机的设备互斥锁（进程内、异步、FIFO）
 *
 * 为什么要有：这台机器的打印和扫描共用同一套硬件与驱动，同一时刻只能做一件事。
 * 约定（屏上扫描任务包 2.4）：
 *   - 打印任务从领取到监控出终态（完成 / 失败 / 结果未确认）全程持有；
 *   - WIA 扫描、扫描仪健康探测拿同一把；
 *   - 拿不到就最多等 30 秒，还拿不到由调用方报 busy（屏上「打印机正在打印，打完再试」）。
 *
 * 本批（A1）只提供模块和单测，没有任何调用方；打印侧、扫描侧接锁放在 A2。
 *
 * 语义：
 *   - acquire() 空闲时立刻拿到；被占用则按先来先得排队，超时后 reject DeviceLockTimeoutError，
 *     错误里带当前持有者标签，方便日志与屏上定位「谁占着」。
 *   - release() 幂等，且只有拿到锁的那个句柄能释放，别人的句柄不能放掉你的锁。
 *   - 锁本身不设持有上限：持有方必须在 finally 里释放。
 *
 * 标签只允许 [A-Za-z0-9:_.-]，其余字符换成下划线并截到 64 位，避免任务号之外的内容
 * 进日志。日志里只有标签与毫秒数，没有路径、文件名或用户信息。
 */

import { log as defaultLog, warn as defaultWarn } from '../logger'

export const DEVICE_LOCK_DEFAULT_TIMEOUT_MS = 30_000

export interface DeviceLockClock {
  now(): number
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface DeviceLockLogger {
  log(message: string): void
  warn(message: string): void
}

export interface DeviceLockOptions {
  clock?: DeviceLockClock
  logger?: DeviceLockLogger
  defaultTimeoutMs?: number
}

export interface DeviceLockHandle {
  readonly label: string
  readonly acquiredAt: number
  /** 幂等。第二次起什么都不做。 */
  release(): void
}

export interface DeviceLockSnapshot {
  heldBy: string | undefined
  heldForMs: number | undefined
  waiting: string[]
}

export class DeviceLockTimeoutError extends Error {
  readonly code = 'DEVICE_LOCK_TIMEOUT'
  constructor(
    readonly label: string,
    /** 超时那一刻的持有者标签。 */
    readonly heldBy: string | undefined,
    readonly waitedMs: number,
  ) {
    super(`device-lock: ${label} 等了 ${waitedMs}ms 仍被 ${heldBy ?? '(未知)'} 占用`)
    this.name = 'DeviceLockTimeoutError'
  }
}

const systemClock: DeviceLockClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

const systemLogger: DeviceLockLogger = { log: defaultLog, warn: defaultWarn }

export function sanitizeDeviceLockLabel(label: string): string {
  const cleaned = String(label).replace(/[^A-Za-z0-9:_.-]/g, '_').slice(0, 64)
  return cleaned || 'unknown'
}

interface Holder {
  readonly token: symbol
  readonly label: string
  readonly acquiredAt: number
}

interface Waiter {
  readonly label: string
  readonly enqueuedAt: number
  timer: unknown
  resolve(handle: DeviceLockHandle): void
  reject(error: Error): void
}

export class DeviceLock {
  private holder: Holder | undefined
  private readonly queue: Waiter[] = []
  private readonly clock: DeviceLockClock
  private readonly logger: DeviceLockLogger
  private readonly defaultTimeoutMs: number

  constructor(options: DeviceLockOptions = {}) {
    this.clock = options.clock ?? systemClock
    this.logger = options.logger ?? systemLogger
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEVICE_LOCK_DEFAULT_TIMEOUT_MS
  }

  /** 拿锁。timeoutMs <= 0 表示不等：被占用就立刻 reject。 */
  acquire(label: string, options: { timeoutMs?: number } = {}): Promise<DeviceLockHandle> {
    const safeLabel = sanitizeDeviceLockLabel(label)
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs

    if (!this.holder && this.queue.length === 0) {
      return Promise.resolve(this.grant(safeLabel, 0))
    }

    const heldBy = this.holder?.label
    if (timeoutMs <= 0) {
      return Promise.reject(this.timeoutError(safeLabel, 0))
    }

    this.logger.log(
      `device-lock: ${safeLabel} waiting for ${heldBy ?? 'queue'} ` +
        `(held ${this.holder ? this.clock.now() - this.holder.acquiredAt : 0}ms, ahead=${this.queue.length})`,
    )
    return new Promise<DeviceLockHandle>((resolve, reject) => {
      const waiter: Waiter = {
        label: safeLabel,
        enqueuedAt: this.clock.now(),
        timer: undefined,
        resolve,
        reject,
      }
      waiter.timer = this.clock.setTimeout(() => {
        const index = this.queue.indexOf(waiter)
        if (index < 0) return
        this.queue.splice(index, 1)
        const error = this.timeoutError(safeLabel, this.clock.now() - waiter.enqueuedAt)
        this.logger.warn(
          `device-lock: ${safeLabel} gave up after ${error.waitedMs}ms, held by ${error.heldBy ?? '(none)'}`,
        )
        reject(error)
      }, timeoutMs)
      this.queue.push(waiter)
    })
  }

  /** 不等待地尝试拿锁；拿不到返回 undefined。 */
  tryAcquire(label: string): DeviceLockHandle | undefined {
    if (this.holder || this.queue.length > 0) return undefined
    return this.grant(sanitizeDeviceLockLabel(label), 0)
  }

  snapshot(): DeviceLockSnapshot {
    return {
      heldBy: this.holder?.label,
      heldForMs: this.holder ? this.clock.now() - this.holder.acquiredAt : undefined,
      waiting: this.queue.map((waiter) => waiter.label),
    }
  }

  private timeoutError(label: string, waitedMs: number): DeviceLockTimeoutError {
    return new DeviceLockTimeoutError(label, this.holder?.label, waitedMs)
  }

  private grant(label: string, waitedMs: number): DeviceLockHandle {
    const holder: Holder = { token: Symbol(label), label, acquiredAt: this.clock.now() }
    this.holder = holder
    this.logger.log(`device-lock: acquired by ${label}${waitedMs > 0 ? ` after waiting ${waitedMs}ms` : ''}`)
    let released = false
    return {
      label,
      acquiredAt: holder.acquiredAt,
      release: () => {
        if (released || this.holder?.token !== holder.token) return
        released = true
        this.holder = undefined
        this.logger.log(`device-lock: released by ${label} after ${this.clock.now() - holder.acquiredAt}ms`)
        this.handOver()
      },
    }
  }

  /** 把锁交给队首等待者（它的超时计时器随之取消）。 */
  private handOver(): void {
    const next = this.queue.shift()
    if (!next) return
    this.clock.clearTimeout(next.timer)
    next.resolve(this.grant(next.label, this.clock.now() - next.enqueuedAt))
  }
}

/** 进程内唯一的一把设备锁：打印任务、WIA 扫描、扫描仪健康探测都用它。 */
export const globalDeviceLock = new DeviceLock()
