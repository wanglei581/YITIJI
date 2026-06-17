/**
 * Prisma client 工厂（第四阶段 PostgreSQL 底座）。
 *
 * 按 DATABASE_URL 协议明确选择数据库（不静默回退）：
 *   file:                → SQLite（@prisma/adapter-libsql + src/generated/prisma，开发默认）
 *   postgres/postgresql: → PostgreSQL（@prisma/adapter-pg + src/generated/prisma-pg，生产）
 *
 * 两套 client 由同一份模型生成（prisma/schema.prisma 为唯一真相源，
 * prisma/postgres/schema.prisma 由 scripts/sync-postgres-schema.ts 机械同步，
 * CI 校验不漂移），TS 形状一致；类型统一标注为 SQLite 版 client。
 *
 * PG client 为动态 require：未执行 db:pg:generate 的纯 SQLite 环境不会
 * 因缺少生成产物而加载失败。
 */
import { PrismaClient as SqlitePrismaClient } from '../generated/prisma/client'

export type AppPrismaClient = InstanceType<typeof SqlitePrismaClient>

export type DbKind = 'sqlite' | 'postgres'

export function dbKindOf(url: string): DbKind {
  if (url.startsWith('file:')) return 'sqlite'
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) return 'postgres'
  throw new Error(`DATABASE_URL 协议不受支持（只允许 file: / postgres://）: ${url.split(':')[0]}:…`)
}

export function assertRuntimeDatabaseAllowed(
  url: string,
  nodeEnv = process.env['NODE_ENV'],
  options: { allowProductionSqliteSource?: boolean } = {},
): void {
  const kind = dbKindOf(url)
  if (nodeEnv === 'production' && kind === 'sqlite' && !options.allowProductionSqliteSource) {
    throw new Error(
      'PRODUCTION_SQLITE_FORBIDDEN: NODE_ENV=production 时 DATABASE_URL 必须指向 PostgreSQL，不能使用 file: SQLite 本地库',
    )
  }
}

export function createPrismaClient(
  url: string,
  options: { allowProductionSqliteSource?: boolean } = {},
): { client: AppPrismaClient; kind: DbKind } {
  assertRuntimeDatabaseAllowed(url, process.env['NODE_ENV'], options)
  const kind = dbKindOf(url)
  if (kind === 'postgres') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaPg } = require('@prisma/adapter-pg') as typeof import('@prisma/adapter-pg')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaClient: PgPrismaClient } = require('../generated/prisma-pg/client') as {
      PrismaClient: typeof SqlitePrismaClient
    }
    const adapter = new PrismaPg({ connectionString: url })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { client: new PgPrismaClient({ adapter } as any) as AppPrismaClient, kind }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaLibSql } = require('@prisma/adapter-libsql') as typeof import('@prisma/adapter-libsql')
  const adapter = new PrismaLibSql({ url })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: new SqlitePrismaClient({ adapter } as any) as AppPrismaClient, kind }
}
