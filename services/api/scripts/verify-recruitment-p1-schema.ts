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

function verifyStaticContract(): void {
  const sqliteSchema = read(SQLITE_SCHEMA)
  const pgSchema = read(PG_SCHEMA)
  assert.equal(
    (sqliteSchema.match(/^model /gm) ?? []).length,
    87,
    'SQLite schema model count drifted'
  )
  assert.equal(
    (pgSchema.match(/^model /gm) ?? []).length,
    87,
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
