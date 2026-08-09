import 'dotenv/config'
import { createClient } from '@libsql/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { dbKindOf } from '../src/prisma/create-client'

type CountQuery = (sql: string) => Promise<number>

const inventorySql = {
  organizations: 'SELECT COUNT(*) AS count FROM "Organization"',
  sources: 'SELECT COUNT(*) AS count FROM "JobSource"',
  jobs: 'SELECT COUNT(*) AS count FROM "Job"',
  agencies: 'SELECT COUNT(*) AS count FROM "OfflineAgency"',
  offlineJobs: 'SELECT COUNT(*) AS count FROM "OfflineJob"',
}

const blockerSql = {
  jobsMissingOrUnknownSource: `
    SELECT COUNT(*) AS count
    FROM "Job" j
    LEFT JOIN "JobSource" s ON s."id" = j."sourceId"
    WHERE j."sourceId" IS NULL OR s."id" IS NULL
  `,
  jobSourceOrganizationMismatch: `
    SELECT COUNT(*) AS count
    FROM "Job" j
    JOIN "JobSource" s ON s."id" = j."sourceId"
    WHERE j."sourceOrgId" <> s."orgId"
  `,
  duplicateSourceExternalIdGroups: `
    SELECT COUNT(*) AS count FROM (
      SELECT "sourceId", "externalId"
      FROM "Job"
      WHERE "sourceId" IS NOT NULL
      GROUP BY "sourceId", "externalId"
      HAVING COUNT(*) > 1
    ) duplicates
  `,
  jobsMissingExternalId: `
    SELECT COUNT(*) AS count FROM "Job"
    WHERE "externalId" IS NULL OR TRIM("externalId") = ''
  `,
  jobsMissingCompany: `
    SELECT COUNT(*) AS count FROM "Job"
    WHERE "company" IS NULL OR TRIM("company") = ''
  `,
  jobsMissingCity: `
    SELECT COUNT(*) AS count FROM "Job"
    WHERE "city" IS NULL OR TRIM("city") = ''
  `,
  jobsInvalidHttpsSourceUrl: `
    SELECT COUNT(*) AS count FROM "Job"
    WHERE "sourceUrl" IS NULL OR TRIM("sourceUrl") = '' OR LOWER("sourceUrl") NOT LIKE 'https://%'
  `,
  agenciesMissingOrUnknownOrganization: `
    SELECT COUNT(*) AS count
    FROM "OfflineAgency" a
    LEFT JOIN "Organization" o ON o."id" = a."sourceOrgId"
    WHERE a."status" = 'active'
      AND (a."sourceOrgId" IS NULL OR TRIM(a."sourceOrgId") = '' OR o."id" IS NULL)
  `,
  offlineJobsMissingExternalId: `
    SELECT COUNT(*) AS count FROM "OfflineJob"
    WHERE "status" = 'active' AND ("externalId" IS NULL OR TRIM("externalId") = '')
  `,
  offlineJobsInvalidHttpsSourceUrl: `
    SELECT COUNT(*) AS count FROM "OfflineJob"
    WHERE "status" = 'active'
      AND ("externalUrl" IS NULL OR TRIM("externalUrl") = '' OR LOWER("externalUrl") NOT LIKE 'https://%')
  `,
  offlineJobsMissingLocation: `
    SELECT COUNT(*) AS count FROM "OfflineJob"
    WHERE "status" = 'active' AND ("location" IS NULL OR TRIM("location") = '')
  `,
  // OfflineJob has no employer field, so every row needs manual enrichment.
  offlineJobsMissingCanonicalEmployer: `SELECT COUNT(*) AS count FROM "OfflineJob" WHERE "status" = 'active'`,
}

async function collect(queryCount: CountQuery, sqlMap: Record<string, string>): Promise<Record<string, number>> {
  const entries = await Promise.all(Object.entries(sqlMap).map(async ([key, sql]) =>
    [key, await queryCount(sql)] as const))
  return Object.fromEntries(entries)
}

async function withSqlite<T>(url: string, work: (query: CountQuery) => Promise<T>): Promise<T> {
  const client = createClient({ url })
  try {
    await client.execute('PRAGMA query_only=ON')
    return await work(async (sql) => Number((await client.execute(sql)).rows[0]?.['count'] ?? 0))
  } finally {
    client.close()
  }
}

async function withPostgres<T>(url: string, work: (query: CountQuery) => Promise<T>): Promise<T> {
  const adapter = await new PrismaPg({ connectionString: url }).connect()
  const pool = adapter.underlyingDriver()
  const connection = await pool.connect()
  try {
    await connection.query('BEGIN TRANSACTION READ ONLY')
    await connection.query(`SET LOCAL statement_timeout = '15s'`)
    await connection.query(`SET LOCAL lock_timeout = '2s'`)
    await connection.query(`SET LOCAL idle_in_transaction_session_timeout = '5s'`)
    const result = await work(async (sql) => Number((await connection.query(sql)).rows[0]?.count ?? 0))
    await connection.query('COMMIT')
    return result
  } catch (error) {
    await connection.query('ROLLBACK')
    throw error
  } finally {
    connection.release()
    await adapter.dispose()
  }
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL']
  if (!url) throw new Error('DATABASE_URL is required')
  const kind = dbKindOf(url)
  const run = kind === 'sqlite' ? withSqlite : withPostgres

  const report = await run(url, async (queryCount) => {
    const [inventory, blockers] = await Promise.all([
      collect(queryCount, inventorySql),
      collect(queryCount, blockerSql),
    ])
    const blockerTotal = Object.values(blockers).reduce((sum, count) => sum + count, 0)
    return {
      check: 'recruitment-p1-preflight',
      databaseKind: kind,
      mode: 'read-only-aggregate',
      inventory,
      blockers,
      blockerTotal,
      noDetectedLegacyBlockers: blockerTotal === 0,
      postExpandChecksStillRequired: [
        'allowed content-domain policy and redirect validation',
        'qualification and branch evidence review',
        'manual employer and structured-city reconciliation',
      ],
    }
  })

  console.log(JSON.stringify(report, null, 2))
  process.exitCode = report.blockerTotal === 0 ? 0 : 2
}

void main().catch((error: unknown) => {
  console.error(JSON.stringify({
    check: 'recruitment-p1-preflight',
    mode: 'read-only-aggregate',
    error: error instanceof Error ? error.message : String(error),
  }))
  process.exit(1)
})
