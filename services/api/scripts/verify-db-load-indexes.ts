/**
 * 数据库高并发/高负载加固静态门禁。
 *
 * 验证本轮只做索引与 runbook 收口：
 * - SQLite SSOT schema 和 PostgreSQL generated schema 同步声明 4 个热路径索引。
 * - SQLite / PostgreSQL 双迁移均创建同名索引。
 * - 不引入本轮拒绝的后台全局分页 / 会员分页冗余索引。
 * - runbook 明确生产参数修改、并发建索引、PM2/PgBouncer/压测均需用户确认。
 *
 * Run: pnpm --filter @ai-job-print/api verify:db-load-indexes
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'

const repoRoot = resolve(__dirname, '../../..')

function read(path: string): string {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  throw new Error(message)
}

function assertIncludes(haystack: string, needle: string, label: string): void {
  if (!haystack.includes(needle)) fail(`${label} 缺少: ${needle}`)
  pass(label)
}

function assertNotIncludes(haystack: string, needle: string, label: string): void {
  if (haystack.includes(needle)) fail(`${label} 不应包含: ${needle}`)
  pass(label)
}

function modelBlock(content: string, modelName: string): string {
  const marker = `model ${modelName} {`
  const start = content.indexOf(marker)
  if (start === -1) fail(`缺少模型: ${modelName}`)
  const nextModel = content.indexOf('\nmodel ', start + marker.length)
  return content.slice(start, nextModel === -1 ? content.length : nextModel)
}

function assertIndexSet(path: string, content: string): void {
  const printTask = modelBlock(content, 'PrintTask')
  const statusLog = modelBlock(content, 'PrintTaskStatusLog')
  assertIncludes(printTask, '@@index([status, terminalId, createdAt])', `${path} 声明 claim 热路径索引`)
  assertIncludes(printTask, '@@index([status, claimExpiry])', `${path} 声明 claimed 过期回收索引`)
  assertIncludes(printTask, '@@index([status, claimedAt])', `${path} 声明 printing 卡住回收索引`)
  assertIncludes(statusLog, '@@index([taskId, createdAt])', `${path} 声明状态日志查询索引`)
  assertNotIncludes(printTask, '@@index([status, createdAt])', `${path} 未加入后台列表冗余索引`)
  assertNotIncludes(printTask, '@@index([endUserId, createdAt', `${path} 未加入会员分页冗余索引`)
}

function assertMigration(path: string, content: string): void {
  const expected = [
    'CREATE INDEX IF NOT EXISTS "PrintTask_status_terminalId_createdAt_idx" ON "PrintTask"("status", "terminalId", "createdAt");',
    'CREATE INDEX IF NOT EXISTS "PrintTask_status_claimExpiry_idx" ON "PrintTask"("status", "claimExpiry");',
    'CREATE INDEX IF NOT EXISTS "PrintTask_status_claimedAt_idx" ON "PrintTask"("status", "claimedAt");',
    'CREATE INDEX IF NOT EXISTS "PrintTaskStatusLog_taskId_createdAt_idx" ON "PrintTaskStatusLog"("taskId", "createdAt");',
  ]
  for (const statement of expected) {
    const indexName = statement.match(/"([^"]+)"/)?.[1] ?? 'index'
    assertIncludes(content, statement, `${path} 包含索引 ${indexName}`)
  }
  assertNotIncludes(content, 'DROP INDEX', `${path} 不删除既有索引`)
  assertNotIncludes(content, 'ALTER TABLE', `${path} 不改既有列`)
}

function assertRunbook(content: string): void {
  const required = [
    '不在本线程直接修改生产服务器',
    'CREATE INDEX CONCURRENTLY',
    'pg_stat_statements',
    'PgBouncer',
    'Prisma 连接池',
    'PM2 cluster',
    '压测命令',
    '验收阈值',
    '等待用户确认',
  ]
  for (const phrase of required) assertIncludes(content, phrase, `runbook 包含 ${phrase}`)
}

async function main(): Promise<void> {
  console.log('\n=== 数据库高并发/高负载加固静态门禁 ===')

  const sqliteSchemaPath = 'services/api/prisma/schema.prisma'
  const pgSchemaPath = 'services/api/prisma/postgres/schema.prisma'
  assertIndexSet(sqliteSchemaPath, read(sqliteSchemaPath))
  assertIndexSet(pgSchemaPath, read(pgSchemaPath))

  assertMigration(
    'services/api/prisma/migrations/20260706070000_add_db_load_indexes/migration.sql',
    read('services/api/prisma/migrations/20260706070000_add_db_load_indexes/migration.sql'),
  )
  assertMigration(
    'services/api/prisma/postgres/migrations/20260706070000_add_db_load_indexes/migration.sql',
    read('services/api/prisma/postgres/migrations/20260706070000_add_db_load_indexes/migration.sql'),
  )

  assertRunbook(read('docs/device/postgres-load-hardening-runbook.md'))
  pass('数据库高并发/高负载加固索引与 runbook 门禁通过')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
