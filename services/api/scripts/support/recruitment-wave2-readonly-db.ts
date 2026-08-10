import { createHash } from 'node:crypto'
import { PrismaPg } from '@prisma/adapter-pg'
import type { RecruitmentWave2Snapshot } from '../../src/recruitment-content/recruitment-wave2-plan'
import {
  assertRecruitmentWave2ExecutionWindow,
  type RecruitmentWave2TargetConfig,
} from '../../src/recruitment-content/recruitment-wave2-target'

type QueryRows = <T extends Record<string, unknown>>(sql: string, values?: unknown[]) => Promise<T[]>

export interface RecruitmentWave2DatabaseIdentity {
  database: string
  schema: string
  version: string
  transactionReadOnly: true
  roleVerifiedReadonly: true
  snapshotAsOf: string | null
  markerExpiresAt: string | null
  migrationCount: number
  latestMigration: string | null
}

export interface RecruitmentWave2Inventory {
  identity: RecruitmentWave2DatabaseIdentity
  queryPlanSha256: string
  inventory: Record<string, number>
  grouped: Record<string, Array<{ key: string; count: number }>>
  blockers: Record<string, number>
}

const INVENTORY_SQL = {
  organizations: 'SELECT COUNT(*)::int AS count FROM "Organization"',
  sources: 'SELECT COUNT(*)::int AS count FROM "JobSource"',
  jobs: 'SELECT COUNT(*)::int AS count FROM "Job"',
  agencies: 'SELECT COUNT(*)::int AS count FROM "OfflineAgency"',
  offlineJobs: 'SELECT COUNT(*)::int AS count FROM "OfflineJob"',
  profiles: 'SELECT COUNT(*)::int AS count FROM "OfflineAgencyProfile"',
  branches: 'SELECT COUNT(*)::int AS count FROM "OfflineAgencyBranch"',
  qualifications: 'SELECT COUNT(*)::int AS count FROM "QualificationRecord"',
} as const

const GROUPED_SQL = {
  organizations: `SELECT CASE WHEN "type" IN ('school_employment_center','public_employment_service',
      'licensed_hr_agency','fair_organizer','enterprise_source') THEN "type" ELSE 'other' END AS key,
    COUNT(*)::int AS count FROM "Organization" GROUP BY 1 ORDER BY 1`,
  sources: `SELECT CONCAT(
      CASE WHEN "sourceKind" IN ('job_platform','hr_company','school','fair_organizer','aggregator','manual')
        THEN "sourceKind" ELSE 'other' END,
      '|',CASE WHEN "accessMode" IN ('api','excel','csv','json','webhook','manual')
        THEN "accessMode" ELSE 'other' END) AS key,
    COUNT(*)::int AS count FROM "JobSource" GROUP BY 1 ORDER BY 1`,
  jobs: `SELECT CONCAT(
      CASE WHEN "reviewStatus" IN ('pending','reviewing','approved','rejected') THEN "reviewStatus" ELSE 'other' END,
      '|',CASE WHEN "publishStatus" IN ('draft','published','unpublished','expired') THEN "publishStatus" ELSE 'other' END)
    AS key, COUNT(*)::int AS count FROM "Job" GROUP BY 1 ORDER BY 1`,
  agencies: `SELECT CONCAT(
      CASE WHEN "status" IN ('active','inactive') THEN "status" ELSE 'other' END,
      '|',CASE WHEN "reviewStatus" IN ('pending','reviewing','approved','rejected') THEN "reviewStatus" ELSE 'other' END,
      '|',CASE WHEN "publishStatus" IN ('draft','published','unpublished','expired') THEN "publishStatus" ELSE 'other' END)
    AS key, COUNT(*)::int AS count FROM "OfflineAgency" GROUP BY 1 ORDER BY 1`,
  offlineJobs: `SELECT CASE WHEN "status" IN ('active','inactive') THEN "status" ELSE 'other' END AS key,
    COUNT(*)::int AS count FROM "OfflineJob" GROUP BY 1 ORDER BY 1`,
} as const

const BLOCKER_SQL = {
  jobsMissingOrUnknownSource: `SELECT COUNT(*)::int AS count FROM "Job" j
    LEFT JOIN "JobSource" s ON s."id"=j."sourceId" WHERE j."sourceId" IS NULL OR s."id" IS NULL`,
  jobSourceOrganizationMismatch: `SELECT COUNT(*)::int AS count FROM "Job" j
    JOIN "JobSource" s ON s."id"=j."sourceId" WHERE j."sourceOrgId"<>s."orgId"`,
  duplicateSourceExternalIdGroups: `SELECT COUNT(*)::int AS count FROM (
    SELECT "sourceId","externalId" FROM "Job" WHERE "sourceId" IS NOT NULL
    GROUP BY "sourceId","externalId" HAVING COUNT(*)>1) x`,
  duplicateOrganizationExternalIdGroups: `SELECT COUNT(*)::int AS count FROM (
    SELECT "sourceOrgId","externalId" FROM "Job"
    GROUP BY "sourceOrgId","externalId" HAVING COUNT(*)>1) x`,
  partialLegacyMigrationState: `SELECT COUNT(*)::int AS count FROM "OfflineJob"
    WHERE ("canonicalJobId" IS NULL)<>("migrationChecksum" IS NULL)`,
  missingAgencyOrganization: `SELECT COUNT(*)::int AS count FROM "OfflineAgency" a
    LEFT JOIN "Organization" o ON o."id"=a."sourceOrgId"
    WHERE a."sourceOrgId" IS NULL OR TRIM(a."sourceOrgId")='' OR o."id" IS NULL`,
  legacyJobsWithoutManifestEmployer: 'SELECT COUNT(*)::int AS count FROM "OfflineJob"',
  legacyJobsInvalidHttpsUrl: `SELECT COUNT(*)::int AS count FROM "OfflineJob"
    WHERE "externalUrl" IS NULL OR TRIM("externalUrl")='' OR LOWER("externalUrl") NOT LIKE 'https://%'`,
} as const

const SNAPSHOT_SQL = {
  organizations: `SELECT "id","type","contentTrustStatus","archivedAt" FROM "Organization" ORDER BY "id"`,
  sources: `SELECT "id","orgId","name","approvalStatus","trustStatus","archivedAt",
    "allowedContentDomainsJson","redirectPolicy" FROM "JobSource" ORDER BY "id"`,
  profiles: `SELECT "id","organizationId","serviceScopeJson","contentVersion","reviewStatus","publishStatus",
    "contentHash","approvedContentHash","hashAlgorithmVersion","reviewedBy","reviewedAt","rejectReason","archivedAt"
    FROM "OfflineAgencyProfile" ORDER BY "id"`,
  branches: `SELECT "id","agencyProfileId","status","cityCode","contentVersion","reviewStatus","publishStatus",
    "contentHash","approvedContentHash","hashAlgorithmVersion","reviewedBy","reviewedAt","rejectReason","archivedAt"
    FROM "OfflineAgencyBranch" ORDER BY "id"`,
  qualifications: `SELECT q."id",q."organizationId",q."qualificationType",q."appliesToBranchId",q."status",
    q."contentVersion",q."validFrom",q."validUntil",q."contentHash",q."approvedContentHash",q."hashAlgorithmVersion",
    COALESCE(q."issuerName",'') AS "issuerName",COALESCE(q."jurisdiction",'') AS "jurisdiction",
    COALESCE(q."verificationSource",'') AS "verificationSource",q."verifiedBy",q."verifiedAt",q."archivedAt",
    f."id" AS "evidenceId",f."purpose" AS "evidencePurpose",f."visibility" AS "evidenceVisibility",
    f."status" AS "evidenceStatus",f."deletedAt" AS "evidenceDeletedAt",f."expiresAt" AS "evidenceExpiresAt"
    FROM "QualificationRecord" q LEFT JOIN "FileObject" f ON f."id"=q."evidenceFileId" ORDER BY q."id"`,
  decisions: `SELECT "id","targetType","targetId","contentVersion","contentHash","hashAlgorithmVersion",
    "action","toStatus","actorRole","occurredAt","correlationId","requestId"
    FROM "ReviewDecision" ORDER BY "targetType","targetId","occurredAt","id"`,
  legacyAgencies: `SELECT "id","sourceOrgId","status","createdAt","updatedAt"
    FROM "OfflineAgency" WHERE "id">$1 ORDER BY "id" LIMIT $2`,
  legacyJobs: `SELECT "id","agencyId","title","jobType","salaryMin","salaryMax","salaryUnit","headcount",
    "requirements","description","location","education","experience","externalUrl","externalId",
    "canonicalJobId","migrationChecksum","status","createdAt","updatedAt"
    FROM "OfflineJob" WHERE "id">$1 ORDER BY "id" LIMIT $2`,
  jobs: `SELECT "id","sourceOrgId","sourceId","externalId","sourceName","sourceUrl","title","company","city",
    "category","salaryMin","salaryMax","salaryUnit","description","requirements","educationRequirement",
    "experienceRequirement","salary","tagsJson","skillsJson","benefitsJson","validThrough","companyProfileId",
    "offlineBranchId","reviewStatus","publishStatus","contentHash","contentVersion",
    "approvedContentHash","hashAlgorithmVersion","sourceLastSeenAt","reviewedBy","reviewedAt","rejectReason","archivedAt"
    FROM "Job" WHERE "id">$1 ORDER BY "id" LIMIT $2`,
} as const

export async function withRecruitmentWave2Readonly<T>(
  config: RecruitmentWave2TargetConfig,
  work: (query: QueryRows, identity: RecruitmentWave2DatabaseIdentity) => Promise<T>,
): Promise<T> {
  const adapter = await new PrismaPg({ connectionString: config.databaseUrl }).connect()
  const pool = adapter.underlyingDriver()
  let connection
  try {
    connection = await pool.connect()
  } catch (error) {
    try { await adapter.dispose() } catch { /* preserve the connection failure */ }
    throw error
  }
  let failure: unknown
  let result: T | undefined
  let verifiedIdentity: RecruitmentWave2DatabaseIdentity | null = null
  try {
    await connection.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    await connection.query(`SET LOCAL statement_timeout='15s'`)
    await connection.query(`SET LOCAL lock_timeout='2s'`)
    await connection.query(`SET LOCAL idle_in_transaction_session_timeout='5s'`)
    const query: QueryRows = async (sql, values = []) => {
      assertRecruitmentWave2ExecutionWindow(config)
      return (await connection.query(sql, values)).rows as never
    }
    const identity = await verifyIdentity(query, config)
    verifiedIdentity = identity
    result = await work(query, identity)
    assertRecruitmentWave2ExecutionWindow(
      config,
      new Date(),
      identity.markerExpiresAt ? new Date(identity.markerExpiresAt) : null,
    )
    await connection.query('COMMIT')
  } catch (error) {
    failure = error
    try { await connection.query('ROLLBACK') } catch { /* preserve the primary failure */ }
  }
  connection.release()
  try { await adapter.dispose() } catch (error) { failure ??= error }
  if (failure) throw failure
  await verifyRecruitmentWave2FreshExecutionState(config, verifiedIdentity)
  return result as T
}

export async function verifyRecruitmentWave2FreshExecutionState(
  config: RecruitmentWave2TargetConfig,
  identity: Pick<RecruitmentWave2DatabaseIdentity, 'snapshotAsOf' | 'markerExpiresAt'> | null = null,
): Promise<void> {
  assertRecruitmentWave2ExecutionWindow(
    config,
    new Date(),
    identity?.markerExpiresAt ? new Date(identity.markerExpiresAt) : null,
  )
  if (config.target === 'authorized-readonly') return
  if (!identity?.snapshotAsOf || !identity.markerExpiresAt) {
    throw new Error('RECRUITMENT_WAVE2_RESTORE_MARKER_IDENTITY_REQUIRED')
  }
  const adapter = await new PrismaPg({ connectionString: config.databaseUrl }).connect()
  const pool = adapter.underlyingDriver()
  let connection
  try {
    connection = await pool.connect()
  } catch (error) {
    try { await adapter.dispose() } catch { /* preserve the connection failure */ }
    throw error
  }
  let failure: unknown
  try {
    await connection.query('BEGIN READ ONLY')
    await connection.query(`SET LOCAL statement_timeout='15s'`)
    await connection.query(`SET LOCAL lock_timeout='2s'`)
    const query: QueryRows = async (sql, values = []) => {
      assertRecruitmentWave2ExecutionWindow(config)
      return (await connection.query(sql, values)).rows as never
    }
    const marker = await verifyRestoreMarker(query, config)
    if (marker.snapshotAsOf !== identity.snapshotAsOf || marker.expiresAt !== identity.markerExpiresAt) {
      throw new Error('RECRUITMENT_WAVE2_RESTORE_MARKER_CHANGED')
    }
    assertRecruitmentWave2ExecutionWindow(config, new Date(), new Date(marker.expiresAt))
    await connection.query('COMMIT')
  } catch (error) {
    failure = error
    try { await connection.query('ROLLBACK') } catch { /* preserve the primary failure */ }
  }
  connection.release()
  try { await adapter.dispose() } catch (error) { failure ??= error }
  if (failure) throw failure
}

export async function collectRecruitmentWave2Inventory(
  query: QueryRows,
  identity: RecruitmentWave2DatabaseIdentity,
): Promise<RecruitmentWave2Inventory> {
  const inventory = await countQueries(query, INVENTORY_SQL)
  const blockers = await countQueries(query, BLOCKER_SQL)
  const grouped: RecruitmentWave2Inventory['grouped'] = {}
  for (const [key, sql] of Object.entries(GROUPED_SQL)) {
    const rows = await query<{ key: string; count: number }>(sql)
    grouped[key] = rows.map((row) => ({ key: row.key, count: Number(row.count) }))
  }
  return {
    identity,
    queryPlanSha256: sha256(JSON.stringify({ INVENTORY_SQL, GROUPED_SQL, BLOCKER_SQL })),
    inventory,
    grouped,
    blockers,
  }
}

export async function loadRecruitmentWave2Snapshot(
  query: QueryRows,
  batchSize = 100,
): Promise<RecruitmentWave2Snapshot> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
    throw new Error('RECRUITMENT_WAVE2_BATCH_SIZE_INVALID')
  }
  const organizations = await query<RecruitmentWave2Snapshot['organizations'][number]>(SNAPSHOT_SQL.organizations)
  const sources = await query<RecruitmentWave2Snapshot['sources'][number]>(SNAPSHOT_SQL.sources)
  const profiles = await query<RecruitmentWave2Snapshot['profiles'][number]>(SNAPSHOT_SQL.profiles)
  const branches = await query<RecruitmentWave2Snapshot['branches'][number]>(SNAPSHOT_SQL.branches)
  const qualificationRows = await query<Record<string, unknown>>(SNAPSHOT_SQL.qualifications)
  const decisions = await query<RecruitmentWave2Snapshot['decisions'][number]>(SNAPSHOT_SQL.decisions)
  const legacyAgencies = await loadBatched<RecruitmentWave2Snapshot['legacyAgencies'][number]>(
    query, SNAPSHOT_SQL.legacyAgencies, batchSize,
  )
  const legacyJobs = await loadBatched<RecruitmentWave2Snapshot['legacyJobs'][number]>(
    query, SNAPSHOT_SQL.legacyJobs, batchSize,
  )
  const jobs = await loadBatched<RecruitmentWave2Snapshot['jobs'][number]>(query, SNAPSHOT_SQL.jobs, batchSize)
  const qualifications = qualificationRows.map((row) => ({
    id: String(row['id']),
    organizationId: String(row['organizationId']),
    qualificationType: String(row['qualificationType']),
    appliesToBranchId: nullableString(row['appliesToBranchId']),
    status: String(row['status']),
    contentVersion: Number(row['contentVersion']),
    validFrom: nullableDate(row['validFrom']),
    validUntil: nullableDate(row['validUntil']),
    contentHash: nullableString(row['contentHash']),
    approvedContentHash: nullableString(row['approvedContentHash']),
    hashAlgorithmVersion: nullableString(row['hashAlgorithmVersion']),
    issuerName: String(row['issuerName']),
    jurisdiction: String(row['jurisdiction']),
    verificationSource: String(row['verificationSource']),
    verifiedBy: nullableString(row['verifiedBy']),
    verifiedAt: nullableDate(row['verifiedAt']),
    archivedAt: nullableDate(row['archivedAt']),
    evidenceFile: row['evidenceId'] ? {
      id: String(row['evidenceId']),
      purpose: String(row['evidencePurpose']),
      visibility: String(row['evidenceVisibility']),
      status: String(row['evidenceStatus']),
      deletedAt: nullableDate(row['evidenceDeletedAt']),
      expiresAt: nullableDate(row['evidenceExpiresAt']),
    } : null,
  }))
  return { organizations, sources, profiles, branches, qualifications, decisions, legacyAgencies, legacyJobs, jobs }
}

async function loadBatched<T extends { id: string }>(query: QueryRows, sql: string, batchSize: number): Promise<T[]> {
  const result: T[] = []
  let cursor = ''
  for (;;) {
    const rows = await query<T>(sql, [cursor, batchSize])
    result.push(...rows)
    if (rows.length < batchSize) return result
    cursor = rows[rows.length - 1]!.id
  }
}

function nullableString(value: unknown): string | null { return value === null || value === undefined ? null : String(value) }
function nullableDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null
  return value instanceof Date ? new Date(value.getTime()) : new Date(String(value))
}

async function verifyIdentity(query: QueryRows, config: RecruitmentWave2TargetConfig): Promise<RecruitmentWave2DatabaseIdentity> {
  const rows = await query<Record<string, unknown>>(`SELECT current_database() AS database,current_schema() AS schema,
    version() AS version,current_setting('transaction_read_only') AS read_only,r.rolsuper AS superuser,
    r.rolcreatedb AS create_database,r.rolcreaterole AS create_role,r.rolreplication AS replication,
    r.rolbypassrls AS bypass_rls,
    has_schema_privilege(current_user,'public','CREATE') AS create_schema,
    has_database_privilege(current_user,current_database(),'CREATE') AS create_database_object,
    EXISTS(
      SELECT 1 FROM pg_tables t WHERE t.schemaname='public'
      AND (has_table_privilege(current_user,format('%I.%I',t.schemaname,t.tablename),'INSERT')
        OR has_table_privilege(current_user,format('%I.%I',t.schemaname,t.tablename),'UPDATE')
        OR has_table_privilege(current_user,format('%I.%I',t.schemaname,t.tablename),'DELETE')
        OR has_table_privilege(current_user,format('%I.%I',t.schemaname,t.tablename),'TRUNCATE'))) AS can_write
    FROM pg_roles r WHERE r.rolname=current_user`)
  const row = rows[0]
  if (!row || row['database'] !== config.expectedDatabase) throw new Error('RECRUITMENT_WAVE2_DATABASE_IDENTITY_MISMATCH')
  if (row['schema'] !== 'public' || row['read_only'] !== 'on') throw new Error('RECRUITMENT_WAVE2_TRANSACTION_NOT_READONLY')
  if (row['superuser'] === true || row['create_database'] === true || row['create_role'] === true
    || row['replication'] === true || row['bypass_rls'] === true || row['create_schema'] === true
    || row['create_database_object'] === true || row['can_write'] === true) {
    throw new Error('RECRUITMENT_WAVE2_ROLE_NOT_READONLY')
  }
  const marker = config.target !== 'authorized-readonly'
    ? await verifyRestoreMarker(query, config)
    : null
  const migrationRows = await query<{ migration_name: string }>(
    'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC, migration_name DESC',
  )
  return {
    database: String(row['database']),
    schema: 'public',
    version: String(row['version']).split(' ').slice(0, 2).join(' '),
    transactionReadOnly: true,
    roleVerifiedReadonly: true,
    snapshotAsOf: marker?.snapshotAsOf ?? null,
    markerExpiresAt: marker?.expiresAt ?? null,
    migrationCount: migrationRows.length,
    latestMigration: /^[A-Za-z0-9_]{1,128}$/u.test(migrationRows[0]?.migration_name ?? '')
      ? migrationRows[0]!.migration_name
      : null,
  }
}

async function verifyRestoreMarker(
  query: QueryRows,
  config: RecruitmentWave2TargetConfig,
): Promise<{ snapshotAsOf: string; expiresAt: string }> {
  const rows = await query<Record<string, unknown>>(`SELECT restore_nonce,snapshot_sha256,snapshot_as_of,expires_at
    FROM "_RecruitmentWave2RestoreMarker" WHERE restore_nonce=$1`, [config.restoreNonce])
  const row = rows[0]
  if (!row || row['snapshot_sha256'] !== config.snapshotSha256) throw new Error('RECRUITMENT_WAVE2_RESTORE_MARKER_MISMATCH')
  const expiresAt = nullableDate(row['expires_at']) ?? new Date(Number.NaN)
  assertRecruitmentWave2ExecutionWindow(config, new Date(), expiresAt)
  const snapshotAsOf = nullableDate(row['snapshot_as_of']) ?? new Date(Number.NaN)
  if (!Number.isFinite(snapshotAsOf.getTime())) throw new Error('RECRUITMENT_WAVE2_RESTORE_MARKER_TIME_INVALID')
  return { snapshotAsOf: snapshotAsOf.toISOString(), expiresAt: expiresAt.toISOString() }
}

async function countQueries(query: QueryRows, sqlMap: Record<string, string>): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const [key, sql] of Object.entries(sqlMap)) {
    const rows = await query<{ count: number }>(sql)
    counts[key] = Number(rows[0]?.count ?? 0)
  }
  return counts
}

function sha256(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex') }
