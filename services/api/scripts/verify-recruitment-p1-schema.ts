import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const API_ROOT = resolve(__dirname, '..')
const MIGRATION = '20260810100000_recruitment_p1_expand'
const SQLITE_SCHEMA = join(API_ROOT, 'prisma/schema.prisma')
const PG_SCHEMA = join(API_ROOT, 'prisma/postgres/schema.prisma')
const SQLITE_MIGRATIONS = join(API_ROOT, 'prisma/migrations')
const PG_MIGRATIONS = join(API_ROOT, 'prisma/postgres/migrations')

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

function modelBlock(schema: string, name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`))
  assert(match, `missing model ${name}`)
  return match[0]
}

function requireTokens(haystack: string, label: string, tokens: string[]): void {
  for (const token of tokens) assert(haystack.includes(token), `${label} missing: ${token}`)
}

function migrationFiles(dir: string, includeLatest: boolean): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && (includeLatest || entry.name !== MIGRATION))
    .map((entry) => join(dir, entry.name, 'migration.sql'))
    .sort()
}

function sqlite(db: string, sql: string): string {
  return execFileSync('sqlite3', ['-bail', db], {
    input: `PRAGMA foreign_keys=ON;\n${sql}`,
    encoding: 'utf8',
  }).trim()
}

function applySqliteMigrations(db: string, includeLatest: boolean): void {
  for (const path of migrationFiles(SQLITE_MIGRATIONS, includeLatest)) sqlite(db, read(path))
}

function runPreflight(url: string, expectedStatus: 0 | 2): void {
  const result = spawnSync(
    process.execPath,
    ['-r', '@swc-node/register', 'scripts/verify-recruitment-p1-preflight.ts'],
    {
      cwd: API_ROOT,
      env: { ...process.env, DATABASE_URL: url },
      encoding: 'utf8',
    }
  )
  assert.equal(
    result.status,
    expectedStatus,
    `preflight expected exit ${expectedStatus}:\n${result.stdout}\n${result.stderr}`
  )
}

function assertNoSqliteDrift(db: string, label: string): void {
  const prismaCli = join(API_ROOT, 'node_modules/prisma/build/index.js')
  const drift = spawnSync(
    process.execPath,
    [
      prismaCli,
      'migrate',
      'diff',
      '--from-config-datasource',
      '--to-schema',
      'prisma/schema.prisma',
      '--exit-code',
    ],
    {
      cwd: API_ROOT,
      env: { ...process.env, DATABASE_URL: `file:${db}` },
      encoding: 'utf8',
    }
  )
  assert.equal(drift.status, 0, `${label} SQLite/schema drift:\n${drift.stdout}\n${drift.stderr}`)
}

/**
 * 两套 schema 的模型总数。
 *
 * 这道守卫的意图是**「改 schema 必须是有意识的」**，不是「禁止加模型」：
 * 它盯的是 Recruitment P1 治理模型被人无意中改动/删除/被别的迁移覆盖掉。
 * 正常新增业务模型时，本常量就该跟着 +N —— 连同下面的变更登记一起更新，
 * 这样 review 时能一眼看出这批加了什么、是不是该加。
 *
 * ⚠️ 两套 schema 必须同数：SQLite 与 PostgreSQL 由 `pnpm db:pg:sync` 机械同步，
 * 数量对不上说明有人只改了一边（postgres-readiness 会红）。所以这里只留一个常量，
 * 不给两处各写一个字面量 —— 避免出现「只改了 SQLite 那处」的同类事故。
 *
 * 变更登记（每次改动追加一行，写清 +N 与加了哪些模型）：
 * - 87：Recruitment P1 基线
 * - 90（本次，S3-3 · P26 顾问作业面 /ai/plan，+3）：
 *     AdvisorSession  —— 顾问会话：作业型 + 状态机 + 输入槽（slotsJson）
 *     AdvisorPin      —— 用户主动钉住的条目（问答型唯一跨请求留存的内容）
 *     AdvisorArtifact —— 真实产物（可查 / 可打印 / 可保存）
 *   刻意**没有** AdvisorTurn：设计页对用户承诺「对话不保存」，
 *   问答上下文只在进程内存里，详见 prisma/schema.prisma 里 AdvisorSession 上方的说明。
 */
const EXPECTED_MODEL_COUNT = 90

function verifyStaticContract(): void {
  const sqliteSchema = read(SQLITE_SCHEMA)
  const pgSchema = read(PG_SCHEMA)
  assert.equal(
    (sqliteSchema.match(/^model /gm) ?? []).length,
    EXPECTED_MODEL_COUNT,
    'SQLite schema model count drifted'
  )
  assert.equal(
    (pgSchema.match(/^model /gm) ?? []).length,
    EXPECTED_MODEL_COUNT,
    'PostgreSQL schema model count drifted'
  )

  for (const schema of [sqliteSchema, pgSchema]) {
    requireTokens(modelBlock(schema, 'TerminalScanDeletionAudit'), 'TerminalScanDeletionAudit', [
      'terminalId',
      'eventId',
      '@@id([terminalId, eventId])',
      'identifierHash',
    ])
    requireTokens(modelBlock(schema, 'Terminal'), 'Terminal', [
      'scanDeletionAudits TerminalScanDeletionAudit[]',
    ])
    requireTokens(modelBlock(schema, 'Organization'), 'Organization', [
      'contentTrustStatus String?',
      'contentTrustReviewedBy String?',
      'contentTrustReviewedAt DateTime?',
      'contentTrustReason String?',
      'archivedAt DateTime?',
    ])
    requireTokens(modelBlock(schema, 'JobSource'), 'JobSource', [
      'approvalStatus String?',
      'syncEnabled    Boolean?',
      'trustStatus    String?',
      'allowedContentDomainsJson String?',
      'redirectPolicy String?',
      'archivedAt     DateTime?',
    ])
    requireTokens(modelBlock(schema, 'Job'), 'Job', [
      'sourceLastSeenAt',
      'contentHash',
      'contentVersion',
      'approvedContentHash',
      'hashAlgorithmVersion',
      'archivedAt',
      'offlineBranchId',
      '@@index([sourceId, externalId])',
      'onDelete: Restrict',
    ])
    requireTokens(modelBlock(schema, 'OfflineJob'), 'OfflineJob', [
      'canonicalJobId String? @unique',
      'migrationChecksum String?',
      'onDelete: Restrict',
    ])
    requireTokens(modelBlock(schema, 'QualificationRecord'), 'QualificationRecord', [
      '@default("pending")',
      'contentVersion',
      'contentHash',
      'approvedContentHash',
      'hashAlgorithmVersion',
      'appliesToBranchId',
      'evidenceFileId',
      'onDelete: Restrict',
    ])
    const directory = modelBlock(schema, 'OnlinePlatformDirectory')
    requireTokens(directory, 'OnlinePlatformDirectory', [
      'officialDomainsJson',
      'landingUrl',
      '@default("pending")',
      '@default("draft")',
      'contentVersion',
      'approvedContentHash',
      '@relation("PlatformDirectoryOrg", fields: [organizationId], references: [id], onDelete: Restrict)',
    ])
    assert(
      !/\b(endpoint|authType|encryptedCredential|webhookSecret|responseConfig|syncEnabled)\b/.test(
        directory
      ),
      'OnlinePlatformDirectory must not contain JobSource capabilities'
    )
    requireTokens(modelBlock(schema, 'OfflineAgencyProfile'), 'OfflineAgencyProfile', [
      'organizationId       String   @unique',
      '@default("pending")',
      '@default("draft")',
    ])
    requireTokens(modelBlock(schema, 'OfflineAgencyBranch'), 'OfflineAgencyBranch', [
      'provinceCode',
      'cityCode',
      'districtCode',
      '@default("suspended")',
      'reviewStatus',
      'publishStatus',
      'contentVersion',
      'contentHash',
      'approvedContentHash',
      'hashAlgorithmVersion',
      'onDelete: Restrict',
    ])
    const decision = modelBlock(schema, 'ReviewDecision')
    requireTokens(decision, 'ReviewDecision', [
      'contentVersion',
      'contentHash',
      'action',
      'actorRole',
      'occurredAt',
      'correlationId',
      'requestId',
    ])
    assert(!decision.includes('updatedAt'), 'ReviewDecision must be append-only (no updatedAt)')
    for (const model of [
      'QualificationRecord',
      'OnlinePlatformDirectory',
      'OfflineAgencyProfile',
      'OfflineAgencyBranch',
      'ReviewDecision',
    ]) {
      const block = modelBlock(schema, model)
      assert(
        !block.includes('onDelete: Cascade'),
        `${model} must not cascade-delete governance history`
      )
      assert(
        !/\b(EndUser|resumeFileId|memberId|applicationStatus|appliedAt)\b/.test(block),
        `${model} must not link recruitment governance to job-seeker data`
      )
    }
    assert(
      !/model (Application|Applicant|Candidate|CandidatePool|ResumeSubmission|RecruiterInbox|InterviewInvite|Offer|Referral)\b/.test(
        schema
      ),
      'recruitment-closure model is forbidden'
    )
    assert(
      !/\b(applicationStatus|appliedAt|employerViewedAt|shortlist|interviewStatus|offerStatus|hireResult|recommendationResult)\b/.test(
        schema
      ),
      'recruitment-result field is forbidden'
    )
  }

  const sqliteMigration = read(join(SQLITE_MIGRATIONS, MIGRATION, 'migration.sql'))
  const pgMigration = read(join(PG_MIGRATIONS, MIGRATION, 'migration.sql'))
  for (const [label, sql] of [
    ['SQLite', sqliteMigration],
    ['PostgreSQL', pgMigration],
  ] as const) {
    assert(
      !/\b(DROP|TRUNCATE|RENAME\s+(?:TABLE|COLUMN)|INSERT INTO|DELETE FROM|UPDATE\s+"|SET NOT NULL)/i.test(
        sql
      ),
      `${label} migration is not additive`
    )
    assert(
      !/\b(Application|Applicant|Candidate|ResumeSubmission|InterviewInvite|Offer)\b/.test(sql),
      `${label} migration contains recruitment-closure objects`
    )
  }
  assert(
    !/CREATE TABLE "new_|PRAGMA foreign_keys\s*=\s*OFF/i.test(sqliteMigration),
    'SQLite migration must not rebuild legacy tables or disable foreign keys'
  )
  requireTokens(pgMigration, 'PostgreSQL migration', [
    'Job_offlineBranchId_fkey',
    'OfflineJob_canonicalJobId_fkey',
    'NOT VALID',
  ])
}

function verifySqliteFreshAndUpgrade(): void {
  const freshDir = mkdtempSync(join(tmpdir(), 'recruitment-p1-sqlite-fresh-'))
  const freshDb = join(freshDir, 'fresh.db')
  applySqliteMigrations(freshDb, true)
  assert.equal(sqlite(freshDb, 'PRAGMA foreign_key_check;'), '', 'fresh SQLite has FK violations')
  assertNoSqliteDrift(freshDb, 'fresh')

  const blockedDir = mkdtempSync(join(tmpdir(), 'recruitment-p1-sqlite-blocked-'))
  const blockedDb = join(blockedDir, 'blocked.db')
  applySqliteMigrations(blockedDb, false)
  sqlite(
    blockedDb,
    `
    INSERT INTO "Organization" ("id","name","type","updatedAt") VALUES ('blocked-org','Blocked','enterprise_source',CURRENT_TIMESTAMP);
    INSERT INTO "Organization" ("id","name","type","updatedAt") VALUES ('blocked-org-2','Blocked 2','enterprise_source',CURRENT_TIMESTAMP);
    INSERT INTO "JobSource" ("id","orgId","name","sourceKind","accessMode","updatedAt") VALUES ('blocked-source','blocked-org','Blocked source','manual','manual',CURRENT_TIMESTAMP);
    INSERT INTO "Job" ("id","sourceOrgId","sourceId","externalId","sourceName","sourceUrl","title","company","city","updatedAt") VALUES ('blocked-job-1','blocked-org','blocked-source','duplicate','Blocked source','http://invalid.example/1','Blocked 1','Employer','310100',CURRENT_TIMESTAMP);
    INSERT INTO "Job" ("id","sourceOrgId","sourceId","externalId","sourceName","sourceUrl","title","company","city","updatedAt") VALUES ('blocked-job-2','blocked-org-2','blocked-source','duplicate','Blocked source','http://invalid.example/2','Blocked 2','Employer','310100',CURRENT_TIMESTAMP);
  `
  )
  runPreflight(`file:${blockedDb}`, 2)

  const upgradeDir = mkdtempSync(join(tmpdir(), 'recruitment-p1-sqlite-upgrade-'))
  const upgradeDb = join(upgradeDir, 'upgrade.db')
  applySqliteMigrations(upgradeDb, false)
  sqlite(
    upgradeDb,
    `
    INSERT INTO "Organization" ("id","name","type","updatedAt")
      VALUES ('p1-org','P1 fixture','licensed_hr_agency',CURRENT_TIMESTAMP);
    INSERT INTO "JobSource" ("id","orgId","name","sourceKind","accessMode","updatedAt")
      VALUES ('p1-source','p1-org','P1 source','hr_company','manual',CURRENT_TIMESTAMP);
    INSERT INTO "Job" ("id","sourceOrgId","sourceId","externalId","sourceName","sourceUrl","title","company","city","updatedAt")
      VALUES ('p1-job','p1-org','p1-source','p1-ext','P1 source','https://example.com/job','P1 job','P1 employer','310100',CURRENT_TIMESTAMP);
    INSERT INTO "OfflineAgency" ("id","name","address","status","sourceOrgId","externalId","updatedAt")
      VALUES ('p1-agency','P1 agency','P1 address','inactive','p1-org','p1-agency-ext',CURRENT_TIMESTAMP);
    INSERT INTO "OfflineJob" ("id","agencyId","title","status","externalId","externalUrl","location","updatedAt")
      VALUES ('p1-offline-job','p1-agency','P1 legacy job','inactive','p1-offline-ext','https://example.com/offline','310100',CURRENT_TIMESTAMP);
  `
  )
  runPreflight(`file:${upgradeDb}`, 0)
  const legacyTables = ['Organization', 'JobSource', 'Job', 'OfflineAgency', 'OfflineJob']
  const before = legacyTables.map((table) => sqlite(upgradeDb, `SELECT COUNT(*) FROM "${table}";`))
  sqlite(upgradeDb, read(join(SQLITE_MIGRATIONS, MIGRATION, 'migration.sql')))
  const after = legacyTables.map((table) => sqlite(upgradeDb, `SELECT COUNT(*) FROM "${table}";`))
  assert.deepEqual(after, before, 'SQLite upgrade changed legacy row counts')
  assert.equal(
    sqlite(
      upgradeDb,
      `
    SELECT
      (SELECT COUNT(*) FROM "OnlinePlatformDirectory") +
      (SELECT COUNT(*) FROM "OfflineAgencyProfile") +
      (SELECT COUNT(*) FROM "OfflineAgencyBranch") +
      (SELECT COUNT(*) FROM "QualificationRecord") +
      (SELECT COUNT(*) FROM "ReviewDecision");
  `
    ),
    '0',
    'SQLite upgrade unexpectedly seeded governance tables'
  )
  assert.equal(
    sqlite(
      upgradeDb,
      `
    SELECT
      (SELECT COUNT(*) FROM "Organization" WHERE "contentTrustStatus" IS NOT NULL OR "archivedAt" IS NOT NULL) +
      (SELECT COUNT(*) FROM "JobSource" WHERE "approvalStatus" IS NOT NULL OR "syncEnabled" IS NOT NULL OR "trustStatus" IS NOT NULL) +
      (SELECT COUNT(*) FROM "Job" WHERE "contentVersion" IS NOT NULL OR "offlineBranchId" IS NOT NULL) +
      (SELECT COUNT(*) FROM "OfflineJob" WHERE "canonicalJobId" IS NOT NULL OR "migrationChecksum" IS NOT NULL);
  `
    ),
    '0',
    'SQLite upgrade inferred governance state for legacy rows'
  )
  assert.equal(
    sqlite(upgradeDb, 'PRAGMA foreign_key_check;'),
    '',
    'upgraded SQLite has FK violations'
  )
  assertNoSqliteDrift(upgradeDb, 'upgraded')
}

async function verifyPostgresUpgrade(): Promise<void> {
  const url = process.env['POSTGRES_UPGRADE_URL']
  assert(url, 'POSTGRES_UPGRADE_URL is required')
  const parsed = new URL(url)
  assert(
    ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname),
    'PostgreSQL upgrade gate must use localhost'
  )
  assert(
    parsed.pathname.endsWith('_upgrade_ci'),
    'PostgreSQL upgrade database name must end with _upgrade_ci'
  )

  const { PrismaPg } = await import('@prisma/adapter-pg')
  const adapter = await new PrismaPg({ connectionString: url }).connect()
  const pool = adapter.underlyingDriver()
  try {
    const initial = await pool.query(
      `SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema='public'`
    )
    assert.equal(initial.rows[0]?.count, 0, 'PostgreSQL upgrade database must start empty')
    for (const path of migrationFiles(PG_MIGRATIONS, false)) await pool.query(read(path))
    await pool.query(`
      INSERT INTO "Organization" ("id","name","type","updatedAt") VALUES ('p1-org','P1 fixture','licensed_hr_agency',CURRENT_TIMESTAMP);
      INSERT INTO "JobSource" ("id","orgId","name","sourceKind","accessMode","updatedAt") VALUES ('p1-source','p1-org','P1 source','hr_company','manual',CURRENT_TIMESTAMP);
      INSERT INTO "Job" ("id","sourceOrgId","sourceId","externalId","sourceName","sourceUrl","title","company","city","updatedAt") VALUES ('p1-job','p1-org','p1-source','p1-ext','P1 source','https://example.com/job','P1 job','P1 employer','310100',CURRENT_TIMESTAMP);
      INSERT INTO "OfflineAgency" ("id","name","address","status","sourceOrgId","externalId","updatedAt") VALUES ('p1-agency','P1 agency','P1 address','inactive','p1-org','p1-agency-ext',CURRENT_TIMESTAMP);
      INSERT INTO "OfflineJob" ("id","agencyId","title","status","externalId","externalUrl","location","updatedAt") VALUES ('p1-offline-job','p1-agency','P1 legacy job','inactive','p1-offline-ext','https://example.com/offline','310100',CURRENT_TIMESTAMP);
    `)
    runPreflight(url, 0)
    const legacyTables = ['Organization', 'JobSource', 'Job', 'OfflineAgency', 'OfflineJob']
    const before = await Promise.all(
      legacyTables.map(async (table) =>
        Number((await pool.query(`SELECT COUNT(*)::int AS count FROM "${table}"`)).rows[0]?.count)
      )
    )
    await pool.query(read(join(PG_MIGRATIONS, MIGRATION, 'migration.sql')))
    const after = await Promise.all(
      legacyTables.map(async (table) =>
        Number((await pool.query(`SELECT COUNT(*)::int AS count FROM "${table}"`)).rows[0]?.count)
      )
    )
    assert.deepEqual(after, before, 'PostgreSQL upgrade changed legacy row counts')
    const state = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM "OnlinePlatformDirectory") +
        (SELECT COUNT(*) FROM "OfflineAgencyProfile") +
        (SELECT COUNT(*) FROM "OfflineAgencyBranch") +
        (SELECT COUNT(*) FROM "QualificationRecord") +
        (SELECT COUNT(*) FROM "ReviewDecision") AS new_rows,
        (SELECT COUNT(*) FROM "Organization" WHERE "contentTrustStatus" IS NOT NULL OR "archivedAt" IS NOT NULL) +
        (SELECT COUNT(*) FROM "JobSource" WHERE "approvalStatus" IS NOT NULL OR "syncEnabled" IS NOT NULL OR "trustStatus" IS NOT NULL) +
        (SELECT COUNT(*) FROM "Job" WHERE "contentVersion" IS NOT NULL OR "offlineBranchId" IS NOT NULL) +
        (SELECT COUNT(*) FROM "OfflineJob" WHERE "canonicalJobId" IS NOT NULL OR "migrationChecksum" IS NOT NULL) AS inferred_rows
    `)
    assert.equal(
      Number(state.rows[0]?.new_rows),
      0,
      'PostgreSQL upgrade unexpectedly seeded governance tables'
    )
    assert.equal(
      Number(state.rows[0]?.inferred_rows),
      0,
      'PostgreSQL upgrade inferred governance state'
    )
    const invalidConstraints = await pool.query(`
      SELECT conname FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace AND NOT convalidated
      ORDER BY conname
    `)
    assert.deepEqual(
      invalidConstraints.rows.map((row) => row.conname),
      ['Job_offlineBranchId_fkey', 'OfflineJob_canonicalJobId_fkey']
    )

    const drift = spawnSync(
      process.execPath,
      [
        join(API_ROOT, 'node_modules/prisma/build/index.js'),
        'migrate',
        'diff',
        '--config',
        'prisma.postgres.config.ts',
        '--from-config-datasource',
        '--to-schema',
        'prisma/postgres/schema.prisma',
        '--exit-code',
      ],
      {
        cwd: API_ROOT,
        env: { ...process.env, POSTGRES_URL: url },
        encoding: 'utf8',
      }
    )
    assert.equal(
      drift.status,
      0,
      `upgraded PostgreSQL/schema drift:\n${drift.stdout}\n${drift.stderr}`
    )
  } finally {
    await adapter.dispose()
  }
}

async function main(): Promise<void> {
  verifyStaticContract()
  if (process.argv.includes('--postgres-upgrade')) await verifyPostgresUpgrade()
  else verifySqliteFreshAndUpgrade()
  console.log(
    `PASS recruitment P1 schema: static + ${process.argv.includes('--postgres-upgrade') ? 'PostgreSQL upgrade' : 'SQLite fresh/upgrade'}`
  )
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
  process.exit(1)
})
