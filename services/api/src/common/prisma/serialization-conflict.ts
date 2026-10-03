/**
 * 可串行化事务冲突（PostgreSQL SQLSTATE 40001）的唯一识别点。
 *
 * 为什么要单独一个文件：`@prisma/adapter-pg` 下同一种冲突有两种形状，
 * 只认 `P2034` 的写法会漏掉其中一种，而全仓此前有六处各写各的 `=== 'P2034'`：
 *
 *   1. 冲突发生在事务里的某条查询上 → Prisma 运行时把驱动错误转成
 *      `PrismaClientKnownRequestError { code: 'P2034' }`；
 *   2. 冲突发生在 COMMIT 上（PG 的 SSI 多数在提交时才判）→ 运行时不做转换，
 *      原样抛 `DriverAdapterError { message: 'TransactionWriteConflict',
 *      cause: { kind: 'TransactionWriteConflict', originalCode: '40001' } }`，没有 `code`。
 *
 * 2026-09-29 在本机 PostgreSQL 16 + Prisma 7.8 实测：两个并发 Serializable 事务
 * 读后写，10 次冲突里 9 次是形状 2、1 次是形状 1。形状 2 被只认 P2034 的重试逻辑
 * 当成未知错误原样抛出，最终由全局异常过滤器变成 500。
 *
 * 这里回答「是不是可串行化冲突」，并给一个共用的重试前等待；重试几次、对外报什么错码，
 * 仍由各调用点自己决定。门禁：verify:pg-serialization-conflict（单元 + 静态扫描）、
 * verify:pg-serialization-conflict:postgres 与 verify:first-admin-bootstrap:postgres（真 PG 并发）。
 */
export function isSerializationConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; message?: unknown; cause?: unknown }
  if (candidate.code === 'P2034') return true
  const cause = candidate.cause
  if (cause && typeof cause === 'object') {
    const { originalCode, kind } = cause as { originalCode?: unknown; kind?: unknown }
    if (originalCode === '40001' || kind === 'TransactionWriteConflict') return true
  }
  return typeof candidate.message === 'string'
    && /40001|could not serialize|TransactionWriteConflict/i.test(candidate.message)
}

/**
 * 可串行化冲突重试之前的短暂随机等待（第 n 次重试约 n × 10–50 毫秒）。
 *
 * 为什么要等：输的一方拿到 40001 时，赢的一方的提交可能还没对新快照可见。立刻重试会
 * 读到旧状态、再冲突一次，白白消耗一次重试额度（2026-10-01 main CI 实测到这种二次重试）；
 * 连撞到上限就会把冲突原样抛成 500。等几十毫秒让赢家提交落定，随机量避免两方同步重撞。
 */
export function waitBeforeSerializationRetry(retryNumber: number): Promise<void> {
  const delayMs = Math.max(1, retryNumber) * (10 + Math.floor(Math.random() * 41))
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}
