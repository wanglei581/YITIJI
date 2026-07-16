/**
 * 会员账户状态 schema / migration / Guard 静态门禁。
 *
 * Run: pnpm --filter @ai-job-print/api verify:member-account-status
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repoRoot = resolve(__dirname, '../../..')
const sqliteMigrationsRoot = resolve(repoRoot, 'services/api/prisma/migrations')
const accountStatusMigrationName = '20260717090000_add_member_account_status'
let failures = 0

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8')
}

function readOptional(relativePath: string): string {
  try {
    return read(relativePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    failures += 1
    console.error(`  FAIL 缺少文件: ${relativePath}`)
    return ''
  }
}

function mustContain(source: string, markers: readonly string[], label: string): void {
  for (const marker of markers) {
    if (source.includes(marker)) {
      console.log(`  PASS ${label}: ${marker}`)
      continue
    }
    failures += 1
    console.error(`  FAIL ${label} 缺少: ${marker}`)
  }
}

function mustNotContain(source: string, markers: readonly string[], label: string): void {
  for (const marker of markers) {
    if (!source.includes(marker)) {
      console.log(`  PASS ${label} 未包含: ${marker}`)
      continue
    }
    failures += 1
    console.error(`  FAIL ${label} 不应包含: ${marker}`)
  }
}

function expectEqual(actual: string, expected: string, label: string): void {
  if (actual === expected) {
    console.log(`  PASS ${label}`)
    return
  }
  failures += 1
  console.error(`  FAIL ${label}: 预期 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
}

function modelBlock(schema: string, modelName: string): string {
  const startMarker = `model ${modelName} {`
  const start = schema.indexOf(startMarker)
  if (start === -1) return ''
  const nextModel = schema.indexOf('\nmodel ', start + startMarker.length)
  return schema.slice(start, nextModel === -1 ? schema.length : nextModel)
}

function sqliteQuery(databasePath: string, sql: string): string {
  return execFileSync('sqlite3', ['-batch', '-noheader', '-separator', '|', databasePath, sql], {
    encoding: 'utf8',
  }).trim()
}

function verifySqliteMigration(migrationSql: string): void {
  if (!migrationSql) {
    failures += 1
    console.error('  FAIL SQLite migration 无法执行真实重放: 文件不存在或为空')
    return
  }

  const tempDirectory = mkdtempSync(join(tmpdir(), 'verify-member-account-status-'))
  const databasePath = join(tempDirectory, 'account-status.db')
  try {
    const previousMigrations = readdirSync(sqliteMigrationsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name < accountStatusMigrationName)
      .map((entry) => entry.name)
      .sort()

    for (const migrationName of previousMigrations) {
      const previousSql = readFileSync(join(sqliteMigrationsRoot, migrationName, 'migration.sql'), 'utf8')
      execFileSync('sqlite3', [databasePath], { input: previousSql, encoding: 'utf8' })
    }
    console.log(`  PASS 临时 SQLite 已重放 ${previousMigrations.length} 个前置 migration`)
    expectEqual(
      sqliteQuery(databasePath, `SELECT COUNT(*) FROM pragma_table_info('EndUser') WHERE name = 'status';`),
      '0',
      '前一 migration 状态尚无 EndUser.status',
    )

    execFileSync('sqlite3', [databasePath], {
      input: `
        INSERT INTO "EndUser" ("id", "phoneHash", "phoneEnc", "enabled", "createdAt", "updatedAt")
        VALUES ('legacy-disabled', 'legacy-disabled-hash', 'verify-only-placeholder', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
        INSERT INTO "EndUser" ("id", "phoneHash", "phoneEnc", "enabled", "createdAt", "updatedAt")
        VALUES ('legacy-active', 'legacy-active-hash', 'verify-only-placeholder', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      `,
      encoding: 'utf8',
    })
    execFileSync('sqlite3', [databasePath], { input: migrationSql, encoding: 'utf8' })

    expectEqual(
      sqliteQuery(
        databasePath,
        `SELECT "status", "statusChangedAt" IS NOT NULL FROM "EndUser" WHERE "id" = 'legacy-disabled';`,
      ),
      'disabled|1',
      '历史 enabled=false 用户迁移后回填 disabled 与状态时间',
    )
    expectEqual(
      sqliteQuery(
        databasePath,
        `SELECT "status", "statusChangedAt" IS NULL FROM "EndUser" WHERE "id" = 'legacy-active';`,
      ),
      'active|1',
      '历史 enabled=true 用户保持 active 且不写状态时间',
    )

    execFileSync('sqlite3', [databasePath], {
      input: `
        INSERT INTO "EndUser" ("id", "phoneHash", "phoneEnc", "enabled", "createdAt", "updatedAt")
        VALUES ('new-active', 'new-active-hash', 'verify-only-placeholder', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      `,
      encoding: 'utf8',
    })
    expectEqual(
      sqliteQuery(databasePath, `SELECT "status" FROM "EndUser" WHERE "id" = 'new-active';`),
      'active',
      '迁移后新用户默认 active',
    )
    expectEqual(
      sqliteQuery(
        databasePath,
        `SELECT "name" FROM sqlite_master WHERE "type" = 'index' AND "name" = 'EndUser_status_idx';`,
      ),
      'EndUser_status_idx',
      '真实迁移创建 EndUser_status_idx',
    )
  } catch (error) {
    failures += 1
    const details = error instanceof Error ? error.message : String(error)
    console.error(`  FAIL 临时 SQLite migration 真实重放失败: ${details}`)
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true })
  }
}

const sqliteEndUser = modelBlock(read('services/api/prisma/schema.prisma'), 'EndUser')
const postgresEndUser = modelBlock(read('services/api/prisma/postgres/schema.prisma'), 'EndUser')
const sqliteMigration = readOptional(
  'services/api/prisma/migrations/20260717090000_add_member_account_status/migration.sql',
)
const postgresMigration = readOptional(
  'services/api/prisma/postgres/migrations/20260717090000_add_member_account_status/migration.sql',
)
const guard = read('services/api/src/common/guards/end-user-auth.guard.ts')
const optionalGuard = read('services/api/src/common/guards/optional-end-user-auth.guard.ts')
const optionalResolver = read('services/api/src/common/auth/optional-end-user.ts')
const closureReceiptGuard = readOptional('services/api/src/common/guards/member-closure-receipt.guard.ts')
const memberAuthService = read('services/api/src/member-auth/member-auth.service.ts')
const memberAuthController = read('services/api/src/member-auth/member-auth.controller.ts')
const schemaMarkers = [
  'status          String    @default("active")',
  'statusChangedAt DateTime?',
  'closingRequestedAt DateTime?',
  'anonymizedAt DateTime?',
  '@@index([status])',
] as const
const sqliteMigrationMarkers = [
  'ALTER TABLE "EndUser" ADD COLUMN "status" TEXT NOT NULL DEFAULT \'active\';',
  'ALTER TABLE "EndUser" ADD COLUMN "statusChangedAt" DATETIME;',
  'ALTER TABLE "EndUser" ADD COLUMN "closingRequestedAt" DATETIME;',
  'ALTER TABLE "EndUser" ADD COLUMN "anonymizedAt" DATETIME;',
  'SET "status" = \'disabled\',',
  '"statusChangedAt" = CURRENT_TIMESTAMP',
  'WHERE "enabled" = 0;',
  'CREATE INDEX "EndUser_status_idx" ON "EndUser"("status");',
] as const
const postgresMigrationMarkers = [
  'ADD COLUMN "status" TEXT NOT NULL DEFAULT \'active\'',
  'ADD COLUMN "statusChangedAt" TIMESTAMP(3)',
  'ADD COLUMN "closingRequestedAt" TIMESTAMP(3)',
  'ADD COLUMN "anonymizedAt" TIMESTAMP(3)',
  'SET "status" = \'disabled\',',
  '"statusChangedAt" = CURRENT_TIMESTAMP',
  'WHERE "enabled" = false;',
  'CREATE INDEX "EndUser_status_idx" ON "EndUser"("status");',
] as const

console.log('\n=== 会员账户状态门禁 ===')
mustContain(sqliteEndUser, schemaMarkers, 'SQLite EndUser schema')
mustContain(postgresEndUser, schemaMarkers, 'PostgreSQL EndUser schema')
mustContain(sqliteMigration, sqliteMigrationMarkers, 'SQLite account-status migration')
mustContain(postgresMigration, postgresMigrationMarkers, 'PostgreSQL account-status migration')
verifySqliteMigration(sqliteMigration)
mustContain(
  guard,
  [
    'select: { enabled: true, status: true }',
    "user.status !== 'active'",
    'unregisterMemberSession(payload.sub, sessionId)',
    "user ? 'ACCOUNT_UNAVAILABLE' : 'MEMBER_SESSION_EXPIRED'",
  ],
  'EndUserAuthGuard',
)
mustContain(
  optionalGuard,
  [
    'select: { enabled: true, status: true }',
    "user.status !== 'active'",
    'unregisterMemberSession(payload.sub, sessionId)',
  ],
  'OptionalEndUserAuthGuard',
)
mustContain(
  optionalResolver,
  [
    'prisma: PrismaService',
    'select: { enabled: true, status: true }',
    "user.status !== 'active'",
    'unregisterMemberSession(payload.sub, sessionId)',
  ],
  'resolveOptionalEndUser',
)
mustContain(
  memberAuthService,
  [
    "if (user && (!user.enabled || user.status !== 'active'))",
    "status: 'active'",
    'enabled: true',
    'select: { enabled: true, status: true }',
    'registerMemberSession(user.id, sessionId, SESSION_TTL)',
    'sign({ sub: user.id }, { jwtid: sessionId })',
    'logout(endUserId: string, sessionId: string)',
    'unregisterMemberSession(endUserId, sessionId)',
  ],
  'MemberAuthService',
)
mustContain(
  memberAuthController,
  ['logout(user.endUserId, user.sessionId)'],
  'MemberAuthController',
)
mustContain(
  closureReceiptGuard,
  [
    "algorithms: ['HS256']",
    "audience: 'enduser'",
    'payload.sub',
    'payload.jti',
    'req.closureReceiptSubject = { endUserId: payload.sub }',
  ],
  'MemberClosureReceiptGuard',
)
mustNotContain(
  closureReceiptGuard,
  ['RedisService', 'PrismaService', 'req.endUser', '.sign('],
  'MemberClosureReceiptGuard',
)

let closureGuardControllerReferences = ''
try {
  closureGuardControllerReferences = execFileSync(
    'rg',
    ['-l', 'MemberClosureReceiptGuard', resolve(repoRoot, 'services/api/src'), '-g', '*.controller.ts'],
    { encoding: 'utf8' },
  ).trim()
} catch (error) {
  const exitCode = (error as { status?: number }).status
  if (exitCode !== 1) throw error
}
expectEqual(closureGuardControllerReferences, '', 'MemberClosureReceiptGuard 当前未被任何 controller 引用')

if (failures > 0) {
  console.error(`\n❌ ${failures} 项失败 — 会员账户状态契约尚未完整落地\n`)
  process.exitCode = 1
} else {
  console.log('\n✅ ALL PASS — 会员账户状态契约已完整落地\n')
}
