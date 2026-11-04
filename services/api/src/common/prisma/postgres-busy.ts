/**
 * PostgreSQL 锁等待超时（55P03 lock_not_available）和语句超时（57014 query_canceled）。
 *
 * adapter-pg 对这两种码不做专门转换，原样抛 DriverAdapterError，cause 上同时有
 * `originalCode` 和 `code`。裸 SQL 再被包成 P2010 时，同样的对象在
 * `meta.driverAdapterError`。可串行化冲突是 40001，不在这里。
 *
 * 认出来是为了立刻失败：领任务回 503，其它接口由异常过滤器回 503，重试循环不再重试。
 */

const POSTGRES_BUSY_CODES: ReadonlySet<string> = new Set(['55P03', '57014'])

function hasBusyCode(value: unknown): boolean {
  return typeof value === 'string' && POSTGRES_BUSY_CODES.has(value)
}

export function isPostgresBusyError(error: unknown): boolean {
  const seen = new Set<unknown>()
  const walk = (value: unknown): boolean => {
    if (!value || typeof value !== 'object' || seen.has(value)) return false
    seen.add(value)
    const record = value as {
      code?: unknown
      originalCode?: unknown
      meta?: { code?: unknown; driverAdapterError?: unknown }
      cause?: unknown
    }
    if (hasBusyCode(record.code) || hasBusyCode(record.originalCode)) return true
    const meta = record.meta
    if (meta && typeof meta === 'object') {
      if (hasBusyCode(meta.code)) return true
      if (walk(meta.driverAdapterError)) return true
    }
    return walk(record.cause)
  }
  return walk(error)
}
