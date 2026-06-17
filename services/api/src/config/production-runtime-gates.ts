/**
 * 生产运行时启动门禁（fail-closed）。
 *
 * 集中校验 NODE_ENV=production 时的安全底线，启动期一次性断言，缺一即拒启动：
 *   - JWT_SECRET 必须存在且长度 >= 16（杜绝不安全回退签密钥）
 *   - FILE_STORAGE_DRIVER 必须为 cos（生产不得回退本地磁盘存储，合规要求落 COS）
 *   - DATABASE_URL 不得为 file: SQLite（委托 assertRuntimeDatabaseAllowed，与现有
 *     verify:production-db-guard 共用同一判定，避免双份口径漂移）
 *
 * 非生产环境一律放行：开发 / CI 用本地 SQLite + local 存储 + 测试密钥，不受此门禁约束。
 */
import { assertRuntimeDatabaseAllowed } from '../prisma/create-client'

export interface ProductionRuntimeEnv {
  NODE_ENV?: string
  JWT_SECRET?: string
  FILE_STORAGE_DRIVER?: string
  DATABASE_URL?: string
}

const MIN_JWT_SECRET_LENGTH = 16

export function assertProductionRuntimeGates(
  env: ProductionRuntimeEnv = process.env,
): void {
  const nodeEnv = env.NODE_ENV
  if (nodeEnv !== 'production') return

  const jwtSecret = env.JWT_SECRET
  if (!jwtSecret || jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `PRODUCTION_JWT_SECRET_INVALID: NODE_ENV=production 时 JWT_SECRET 必须存在且长度 >= ${MIN_JWT_SECRET_LENGTH} 字符`,
    )
  }

  const driver = env.FILE_STORAGE_DRIVER?.trim()
  if (driver !== 'cos') {
    throw new Error(
      `PRODUCTION_FILE_STORAGE_DRIVER_NOT_COS: NODE_ENV=production 时 FILE_STORAGE_DRIVER 必须为 cos（当前: ${driver || '未设置'}）`,
    )
  }

  const databaseUrl = env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error(
      'PRODUCTION_DATABASE_URL_MISSING: NODE_ENV=production 时 DATABASE_URL 必须配置',
    )
  }
  assertRuntimeDatabaseAllowed(databaseUrl, nodeEnv)
}
