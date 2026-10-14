import { BadRequestException } from '@nestjs/common'
import type { Redis } from 'ioredis'
import { RedisService } from '../common/redis/redis.service'
import type { MemberBindHost } from './upload-session-member-bind'

// 两分钟覆盖正常上传和重试窗口，同时避免卡死进程无限占用会话。
export const UPLOAD_LOCK_MAX_HOLD_MS = 120_000
// 十兆以内的复制正常几秒内完成；32 秒给慢存储留余量。一体机 confirm 没有客户端超时，这也低于常见网关 60 秒的读超时。
export const MEMBER_COPY_TIMEOUT_MS = 32_000
// 后台无需等待交互响应；100 秒给慢存储整份复制留时间，同时距两分钟持锁上限留 20 秒收尾。
export const MEMBER_COPY_BACKGROUND_TIMEOUT_MS = 100_000
// 上传含存储写入和落库，给慢存储 60 秒；租约持续续期并守住提交前的令牌核验。
export const SESSION_UPLOAD_TIMEOUT_MS = 60_000

export type BindLock = {
  lockKey: string
  lockToken: string
  assertActive?: UploadSessionLease['assertActive']
  assertOwned?: UploadSessionLease['assertOwned']
  runBounded?: UploadSessionLease['runBounded']
  copyTimeoutMs?: number
}

export async function assertLease(lock: BindLock): Promise<void> {
  lock.assertActive?.()
  await lock.assertOwned?.()
}

export async function copyForBind(
  host: MemberBindHost,
  lock: BindLock,
  source: string,
  target: string,
  mime: string,
  bucket: string | null,
): Promise<void> {
  await assertLease(lock)
  const copy = () => host.files.copyObjectToKey(source, target, mime, bucket)
  return lock.runBounded ? lock.runBounded(copy, lock.copyTimeoutMs ?? host.copyTimeoutMs ?? MEMBER_COPY_TIMEOUT_MS) : copy()
}

const RENEW_SCRIPT = `
  if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
`

export function uploadLeaseBusy(): BadRequestException {
  return new BadRequestException({
    error: { code: 'UPLOAD_SESSION_ACTION_IN_PROGRESS', message: '上传会话正在处理中，请稍候' },
  })
}

export interface UploadSessionLease {
  readonly lockKey: string
  readonly lockToken: string
  readonly signal: AbortSignal
  readonly copyTimeoutMs?: number
  assertActive(): void
  assertOwned(): Promise<void>
  runBounded<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T>
  release(): Promise<void>
}

/** Start only after SET NX EX succeeds. The Redis script never extends another holder's token. */
export function startUploadSessionLease(
  redis: RedisService,
  lockKey: string,
  lockToken: string,
  ttlSeconds: number,
  options: { maxHoldMs?: number; renewIntervalMs?: number; copyTimeoutMs?: number } = {},
): UploadSessionLease {
  const client = (redis as unknown as { client: Pick<Redis, 'eval'> }).client
  const ttlMs = ttlSeconds * 1000
  const marginMs = Math.min(3000, Math.max(1, Math.floor(ttlMs / 5)))
  const intervalMs = options.renewIntervalMs ?? Math.max(1, Math.floor(ttlMs / 3))
  const controller = new AbortController()
  let lastSuccess = Date.now()
  let closed = false
  let releasing = false
  let pending = 0
  let inFlight = false
  let leaseLost = false

  const stop = () => {
    clearInterval(renewal)
    clearInterval(watchdog)
    clearTimeout(maximum)
  }
  const finish = async () => {
    if (closed) return
    closed = true
    stop()
    await redis.getAndDelIfEquals(lockKey, lockToken).catch(() => undefined)
  }
  const lose = () => {
    leaseLost = true
    if (!controller.signal.aborted) controller.abort()
    stop()
    if (releasing) void finish()
  }
  const renew = async () => {
    if (closed || leaseLost || inFlight) return
    if (Date.now() - lastSuccess >= ttlMs - marginMs) { lose(); return }
    inFlight = true
    try {
      const result = await client.eval(RENEW_SCRIPT, 1, lockKey, lockToken, String(ttlMs))
      if (result !== 1) { lose(); return }
      lastSuccess = Date.now()
    } catch {
      if (Date.now() - lastSuccess >= ttlMs - marginMs) lose()
    } finally {
      inFlight = false
    }
  }
  const renewal = setInterval(() => void renew(), intervalMs)
  renewal.unref()
  const watchdog = setInterval(() => {
    if (Date.now() - lastSuccess >= ttlMs - marginMs) lose()
  }, Math.max(1, Math.floor(intervalMs / 2)))
  watchdog.unref()
  const maximum = setTimeout(() => {
    lose()
    void finish()
  }, options.maxHoldMs ?? UPLOAD_LOCK_MAX_HOLD_MS)
  maximum.unref()

  return {
    lockKey, lockToken, signal: controller.signal, copyTimeoutMs: options.copyTimeoutMs,
    assertActive() {
      if (controller.signal.aborted || closed || Date.now() - lastSuccess >= ttlMs - marginMs) {
        lose()
        throw uploadLeaseBusy()
      }
    },
    async assertOwned() {
      this.assertActive()
      try {
        if (await client.eval(RENEW_SCRIPT, 1, lockKey, lockToken, String(ttlMs)) !== 1) {
          lose()
          throw uploadLeaseBusy()
        }
        lastSuccess = Date.now()
      } catch {
        lose()
        throw uploadLeaseBusy()
      }
    },
    async runBounded<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
      this.assertActive()
      pending += 1
      const work = Promise.resolve().then(operation)
      void work.then(() => {
        pending -= 1
        if (releasing && pending === 0) void finish()
      }, () => {
        pending -= 1
        if (releasing && pending === 0) void finish()
      })
      let timer: NodeJS.Timeout | undefined
      let onAbort: (() => void) | undefined
      const failure = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort()
          reject(uploadLeaseBusy())
        }, timeoutMs)
        onAbort = () => reject(uploadLeaseBusy())
        controller.signal.addEventListener('abort', onAbort, { once: true })
      })
      try {
        const result = await Promise.race([work, failure])
        this.assertActive()
        return result
      } finally {
        if (timer) clearTimeout(timer)
        if (onAbort) controller.signal.removeEventListener('abort', onAbort)
      }
    },
    async release() {
      releasing = true
      if (pending === 0) await finish()
    },
  }
}
