/**
 * 真 PostgreSQL 并发门禁用：把两个 Serializable 事务确定地挤进同一时间窗。
 *
 * 只靠 Promise.allSettled 并发发起，两个事务经常一前一后跑完、根本不冲突，
 * 门禁就在「没测到」的情况下变绿。这里包一层 `$transaction`：
 *   - 屏障 A：每个事务第一次 `tx.user.count()` 读完后等对方也读完（制造读写依赖环）；
 *   - 屏障 B：回调里所有查询跑完、提交之前等对方也跑完（让冲突落在 COMMIT 上，
 *     也就是 adapter-pg 抛 DriverAdapterError、而不是 P2034 的那种形状）。
 * 业务代码本身一行不动，被测的仍是真实的 `$transaction` 与真实的错误识别。
 *
 * 屏障只拦前两次到达；重试的第三次到达直接放行。等不齐时 5 秒后放行并记下
 * `timedOut`，门禁必须断言它为 false，防止退化成「没挤到一起也算过」。
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { PrismaService } from '../../src/prisma/prisma.service'

export interface RaceBarrier {
  wait(): Promise<void>
  readonly arrivals: number
  readonly timedOut: boolean
}

export function createRaceBarrier(parties = 2, timeoutMs = 5_000): RaceBarrier {
  let arrivals = 0
  let timedOut = false
  let release!: () => void
  const opened = new Promise<void>((resolve) => { release = resolve })
  const timer = setTimeout(() => { timedOut = true; release() }, timeoutMs)
  timer.unref()
  return {
    async wait() {
      arrivals += 1
      if (arrivals >= parties) { clearTimeout(timer); release() }
      await opened
    },
    get arrivals() { return arrivals },
    get timedOut() { return timedOut },
  }
}

export interface RacingPrisma {
  prisma: PrismaService
  /** `$transaction` 被调用的次数（含重试）。 */
  readonly transactionCalls: number
  /** 在 `asCaller(label, fn)` 里发起的 `$transaction` 次数（含重试），按调用方分别计。 */
  transactionCallsOf(label: string): number
  /** 给 fn 里发起的事务打上调用方标记；不用它的门禁照旧只看 transactionCalls。 */
  asCaller<T>(label: string, fn: () => Promise<T>): Promise<T>
  readonly afterRead: RaceBarrier
  readonly beforeCommit: RaceBarrier
}

export function createRacingPrisma(prisma: PrismaService): RacingPrisma {
  const afterRead = createRaceBarrier()
  const beforeCommit = createRaceBarrier()
  let transactionCalls = 0
  const callerScope = new AsyncLocalStorage<string>()
  const callsByCaller = new Map<string, number>()

  const wrapTx = (tx: object): object => {
    let readSeen = false
    return new Proxy(tx, {
      get(target, property) {
        const value = Reflect.get(target, property) as unknown
        if (property !== 'user' || !value || typeof value !== 'object') return value
        const delegate = value as Record<string | symbol, unknown>
        return new Proxy(delegate, {
          get(userTarget, userProperty) {
            const member = Reflect.get(userTarget, userProperty) as unknown
            if (typeof member !== 'function') return member
            if (userProperty !== 'count') return (member as (...args: unknown[]) => unknown).bind(userTarget)
            return async (...args: unknown[]) => {
              const result = await (member as (...a: unknown[]) => Promise<unknown>).apply(userTarget, args)
              if (!readSeen) { readSeen = true; await afterRead.wait() }
              return result
            }
          },
        })
      },
    })
  }

  const racing = new Proxy(prisma, {
    get(target, property) {
      if (property === '$transaction') {
        return (operation: (tx: object) => Promise<unknown>, options?: unknown) => {
          transactionCalls += 1
          const caller = callerScope.getStore()
          if (caller !== undefined) callsByCaller.set(caller, (callsByCaller.get(caller) ?? 0) + 1)
          return (target.$transaction as unknown as (
            fn: (tx: object) => Promise<unknown>,
            opts?: unknown,
          ) => Promise<unknown>)(async (tx) => {
            const result = await operation(wrapTx(tx))
            await beforeCommit.wait()
            return result
          }, options)
        }
      }
      const value = Reflect.get(target, property) as unknown
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
    },
  })

  return {
    prisma: racing,
    get transactionCalls() { return transactionCalls },
    transactionCallsOf: (label: string) => callsByCaller.get(label) ?? 0,
    asCaller: <T>(label: string, fn: () => Promise<T>) => callerScope.run(label, fn),
    afterRead,
    beforeCommit,
  }
}
