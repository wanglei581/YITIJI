import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const failures: string[] = []

function read(relativePath: string): string {
  const path = join(root, relativePath)
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

function expect(condition: boolean, message: string): void {
  if (!condition) failures.push(message)
}

function modelBody(schema: string, modelName: string): string {
  const match = schema.match(new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`, 'm'))
  return match?.[1] ?? ''
}

const sqliteSchema = read('prisma/schema.prisma')
const postgresSchema = read('prisma/postgres/schema.prisma')
const sqliteUser = modelBody(sqliteSchema, 'User')
const postgresUser = modelBody(postgresSchema, 'User')
const sqliteMigration = read('prisma/migrations/20260716193000_add_partner_account_tombstone/migration.sql')
const postgresMigration = read('prisma/postgres/migrations/20260716193000_add_partner_account_tombstone/migration.sql')

console.log('\n=== Partner account tombstone schema verification ===')

expect(/deletedAt\s+DateTime\?/.test(sqliteUser), 'SQLite User schema 缺少 deletedAt DateTime?')
expect(
  /@@index\(\[orgId, role, enabled, deletedAt\]\)/.test(sqliteUser),
  'SQLite User schema 缺少有效账号索引',
)
expect(
  postgresSchema.includes('provider = "postgresql"') && /deletedAt\s+DateTime\?/.test(postgresUser),
  'PostgreSQL schema 未同步 deletedAt',
)
expect(
  sqliteMigration.includes('ADD COLUMN "deletedAt"')
    && sqliteMigration.includes('User_orgId_role_enabled_deletedAt_idx'),
  'SQLite tombstone migration 不完整',
)
expect(
  postgresMigration.includes('ADD COLUMN "deletedAt"')
    && postgresMigration.includes('User_orgId_role_enabled_deletedAt_idx'),
  'PostgreSQL tombstone migration 不完整',
)

if (failures.length > 0) {
  for (const failure of failures) console.error(`  FAIL ${failure}`)
  process.exit(1)
}

console.log('  PASS User tombstone schema 和双 migration 已对齐')
