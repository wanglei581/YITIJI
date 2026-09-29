/**
 * 裸 ioredis 客户端的可调重试次数。
 *
 * 不放进 redis.module.ts：门禁要在不启动 Nest 的情况下断言
 * 「不设环境变量时与 ioredis 默认一致」。那个文件是模块装配，
 * 为读一个纯函数把整模块拉进来没有必要。
 *
 * 不设 REDIS_MAX_RETRIES_PER_REQUEST 时返回空对象，调用方继续 `new Redis(url)`，
 * 生产行为与今天相同（ioredis 默认 20 次，断线后大约十余秒才显式失败）。
 * 只接受 0 到 20 的整数。更大或非法的值一律忽略，避免把重试加得比今天更久。
 * 0 表示第一次断连就放弃本条命令，仅供验证把死端口上的干等拿掉；生产不要设。
 */
import { Redis, type RedisOptions } from 'ioredis'

/** ioredis 5 内置默认。改这个数等于改生产行为，禁止。 */
export const IOREDIS_DEFAULT_MAX_RETRIES_PER_REQUEST = 20

export const REDIS_MAX_RETRIES_PER_REQUEST_ENV = 'REDIS_MAX_RETRIES_PER_REQUEST'

export function redisClientOptions(env: NodeJS.ProcessEnv = process.env): RedisOptions {
  const raw = env[REDIS_MAX_RETRIES_PER_REQUEST_ENV]
  if (raw == null) return {}
  const trimmed = raw.trim()
  if (!/^(?:0|[1-9]\d*)$/.test(trimmed)) return {}
  const parsed = Number(trimmed)
  if (parsed > IOREDIS_DEFAULT_MAX_RETRIES_PER_REQUEST) return {}
  return { maxRetriesPerRequest: parsed }
}

export interface RedisRetryDefaultFact {
  name: string
  ok: boolean
  detail: string
}

/** 锁住「不设时仍是 ioredis 默认 20」。用 lazyConnect，不会真的拨号。 */
export function redisRetryDefaultFacts(): RedisRetryDefaultFact[] {
  const bare = new Redis('redis://127.0.0.1:1', { lazyConnect: true })
  bare.on('error', () => {})
  const unsetSpread = new Redis('redis://127.0.0.1:1', { lazyConnect: true, ...redisClientOptions({}) })
  unsetSpread.on('error', () => {})
  const zero = new Redis('redis://127.0.0.1:1', {
    lazyConnect: true,
    ...redisClientOptions({ [REDIS_MAX_RETRIES_PER_REQUEST_ENV]: '0' }),
  })
  zero.on('error', () => {})
  try {
    const unset = redisClientOptions({})
    const empty = redisClientOptions({ [REDIS_MAX_RETRIES_PER_REQUEST_ENV]: '' })
    const garbage = redisClientOptions({ [REDIS_MAX_RETRIES_PER_REQUEST_ENV]: 'nope' })
    const tooHigh = redisClientOptions({ [REDIS_MAX_RETRIES_PER_REQUEST_ENV]: '21' })
    return [
      {
        name: '不设 REDIS_MAX_RETRIES_PER_REQUEST 时仍是 ioredis 默认 20，且不附加覆盖项',
        ok: bare.options.maxRetriesPerRequest === IOREDIS_DEFAULT_MAX_RETRIES_PER_REQUEST
          && unsetSpread.options.maxRetriesPerRequest === IOREDIS_DEFAULT_MAX_RETRIES_PER_REQUEST
          && Object.keys(unset).length === 0
          && Object.keys(empty).length === 0,
        detail: `bare=${String(bare.options.maxRetriesPerRequest)} spread=${String(unsetSpread.options.maxRetriesPerRequest)}`,
      },
      {
        name: 'REDIS_MAX_RETRIES_PER_REQUEST=0 才把单条命令重试改成 0',
        ok: zero.options.maxRetriesPerRequest === 0,
        detail: `actual=${String(zero.options.maxRetriesPerRequest)}`,
      },
      {
        name: '非法值或大于 20 不覆盖默认',
        ok: Object.keys(garbage).length === 0 && Object.keys(tooHigh).length === 0,
        detail: `garbage=${JSON.stringify(garbage)} tooHigh=${JSON.stringify(tooHigh)}`,
      },
    ]
  } finally {
    bare.disconnect()
    unsetSpread.disconnect()
    zero.disconnect()
  }
}
