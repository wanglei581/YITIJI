/**
 * PostgreSQL 应用连接的会话超时。只进 `@prisma/adapter-pg` 的连接池启动参数，
 * `prisma migrate` 用自己的连接，读不到这里。SQLite 不调用本函数。
 *
 * 缺省：
 *   lock_timeout 5s — 行锁等太久就失败，终端领任务不再挂到对端放弃。
 *   statement_timeout 30s — 现有最长的交互事务预算是工具箱发布/停用的 30s，
 *     里面是逐条短更新，没有单条报表、导出或注销清理会跑满 30s，所以不另放宽。
 *   idle_in_transaction_session_timeout 60s — 高于那条 30s 事务预算；
 *     只在事务里没有任何语句在跑时才计时。
 *
 * 空白视为未配置，回落缺省且不告警。非整数或越界回落缺省，并给出一条警告
 * （只点环境变量名和缺省值，不回显原值）。
 */

const SPECS = {
  DB_LOCK_TIMEOUT_MS: { min: 200, max: 60_000, fallback: 5_000 },
  DB_STATEMENT_TIMEOUT_MS: { min: 1_000, max: 300_000, fallback: 30_000 },
  DB_IDLE_TX_TIMEOUT_MS: { min: 30_000, max: 600_000, fallback: 60_000 },
} as const

export type PgSessionTimeoutEnvKey = keyof typeof SPECS

export interface PgSessionTimeouts {
  lockTimeoutMs: number
  statementTimeoutMs: number
  idleTxTimeoutMs: number
  warnings: string[]
}

function readBoundedMs(
  env: NodeJS.ProcessEnv,
  key: PgSessionTimeoutEnvKey,
): { value: number; warning: string | null } {
  const spec = SPECS[key]
  const raw = env[key]
  if (raw === undefined || raw.trim() === '') {
    return { value: spec.fallback, warning: null }
  }
  const text = raw.trim()
  const inRange = /^[0-9]+$/.test(text)
  const parsed = inRange ? Number(text) : Number.NaN
  if (!inRange || !Number.isSafeInteger(parsed) || parsed < spec.min || parsed > spec.max) {
    const reason = inRange ? '超出允许范围' : '不是合法的毫秒整数'
    return {
      value: spec.fallback,
      warning: `${key} ${reason}，已回落缺省 ${spec.fallback} 毫秒`,
    }
  }
  return { value: parsed, warning: null }
}

export function resolvePgSessionTimeouts(env: NodeJS.ProcessEnv = process.env): PgSessionTimeouts {
  const lock = readBoundedMs(env, 'DB_LOCK_TIMEOUT_MS')
  const statement = readBoundedMs(env, 'DB_STATEMENT_TIMEOUT_MS')
  const idle = readBoundedMs(env, 'DB_IDLE_TX_TIMEOUT_MS')
  return {
    lockTimeoutMs: lock.value,
    statementTimeoutMs: statement.value,
    idleTxTimeoutMs: idle.value,
    warnings: [lock.warning, statement.warning, idle.warning].filter((item): item is string => item !== null),
  }
}

/**
 * 领任务的交互事务上限。Prisma 从 BEGIN 返回起算，lock_timeout 从 UPDATE 发出起算。
 * 两者同为 5 秒时，客户端计时先到，ROLLBACK 排在仍在等锁的语句后面，调用方拿到的是
 * P2028 而不是 55P03。放到锁等待之后，锁超时才能先返回。没被锁时语句毫秒级结束。
 */
export function claimTransactionTimeoutMs(lockTimeoutMs: number): number {
  return lockTimeoutMs + 2_000
}
