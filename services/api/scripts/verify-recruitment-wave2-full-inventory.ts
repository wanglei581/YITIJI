import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import {
  collectPublicSnapshot,
  comparePublicSnapshots,
  diffIdSets,
  isPublicAddress,
  resolveRecruitmentPublicTarget,
  verifyPublicTargetHealth,
  type PublicIdSets,
} from './support/recruitment-wave2-public-snapshot'
import type { RecruitmentWave2TargetConfig } from '../src/recruitment-content/recruitment-wave2-target'
import { classifyInventoryUrls } from './support/recruitment-wave2-full-inventory'

const config: RecruitmentWave2TargetConfig = {
  target: 'ci-fixture',
  databaseUrl: 'postgresql://redacted.invalid/db',
  expectedDatabase: 'ci_database',
  authorizationRef: 'AUTH/recruitment-wave2/full-inventory-ci',
  authorizedUntil: new Date(Date.now() + 60_000),
  restoreNonce: 'ci_restore_nonce_123456',
  snapshotSha256: 'a'.repeat(64),
}

async function main(): Promise<void> {
  await verifyTargetGuard()
  await verifyHostnameLookup()
  verifyAddressGuard()
  verifyDomainClassification()
  await verifyPaginationAndDiff()
  await verifyDriftAndDuplicate()
  await verifySqlAllowlist()
  await verifyReaderContracts()
  console.log('Recruitment Wave 2 full inventory contract: PASS')
}

async function verifyHostnameLookup(): Promise<void> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ success: true, data: { status: 'ok', db: 'postgres' } }))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  try {
    const address = server.address()
    assert(address && typeof address === 'object')
    const target = await resolveRecruitmentPublicTarget(config, {
      RECRUITMENT_WAVE2_PUBLIC_API_BASE_URL: `http://localhost:${address.port}/api/v1`,
      RECRUITMENT_WAVE2_EXPECTED_PUBLIC_API_ORIGIN: `http://localhost:${address.port}`,
      RECRUITMENT_WAVE2_EXPECTED_EXCLUDE_DEMO_PUBLIC_DATA: 'false',
    })
    await verifyPublicTargetHealth(config, target)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
}

async function verifyTargetGuard(): Promise<void> {
  const good = await resolveRecruitmentPublicTarget(config, {
    RECRUITMENT_WAVE2_PUBLIC_API_BASE_URL: 'http://127.0.0.1:3102/api/v1',
    RECRUITMENT_WAVE2_EXPECTED_PUBLIC_API_ORIGIN: 'http://127.0.0.1:3102',
    RECRUITMENT_WAVE2_EXPECTED_EXCLUDE_DEMO_PUBLIC_DATA: 'true',
  })
  assert.equal(good.pinnedAddress, '127.0.0.1')
  for (const [base, origin, expected] of [
    [
      'http://example.com/api/v1',
      'http://example.com',
      'RECRUITMENT_WAVE2_CI_PUBLIC_API_NOT_LOOPBACK',
    ],
    [
      'http://127.0.0.1:3102/api/v1?secret=x',
      'http://127.0.0.1:3102',
      'RECRUITMENT_WAVE2_PUBLIC_API_TARGET_INVALID',
    ],
    [
      'http://user:pass@127.0.0.1:3102/api/v1',
      'http://127.0.0.1:3102',
      'RECRUITMENT_WAVE2_PUBLIC_API_TARGET_INVALID',
    ],
    [
      'http://127.0.0.1:3102/api/v1',
      'http://localhost:3102',
      'RECRUITMENT_WAVE2_PUBLIC_API_ORIGIN_MISMATCH',
    ],
  ]) {
    await assert.rejects(
      resolveRecruitmentPublicTarget(config, {
        RECRUITMENT_WAVE2_PUBLIC_API_BASE_URL: base,
        RECRUITMENT_WAVE2_EXPECTED_PUBLIC_API_ORIGIN: origin,
        RECRUITMENT_WAVE2_EXPECTED_EXCLUDE_DEMO_PUBLIC_DATA: 'true',
      }),
      new RegExp(expected)
    )
  }
}

function verifyAddressGuard(): void {
  for (const value of [
    '127.0.0.1',
    '10.0.0.1',
    '100.64.0.1',
    '169.254.169.254',
    '192.168.1.1',
    '192.0.2.1',
    '198.51.100.1',
    '203.0.113.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '0:0:0:0:0:ffff:7f00:1',
    '::127.0.0.1',
    '::8.8.8.8',
    '64:ff9b::7f00:1',
    '2001:db8::1',
  ]) {
    assert.equal(isPublicAddress(value), false, value)
  }
  assert.equal(isPublicAddress('8.8.8.8'), true)
  assert.equal(isPublicAddress('2606:4700:4700::1111'), true)
}

function verifyDomainClassification(): void {
  const issues: Record<string, string[]> = {}
  classifyInventoryUrls(
    [
      {
        entity: 'job',
        field_name: 'source_url',
        id: 'job_allowed',
        raw_url: 'https://jobs.example.com/open/1',
        domains: '["jobs.example.com"]',
        policy: 'allowlist_only',
      },
      {
        entity: 'job',
        field_name: 'source_url',
        id: 'job_outside',
        raw_url: 'https://evil.example.net/open/2',
        domains: '["jobs.example.com"]',
        policy: 'allowlist_only',
      },
      {
        entity: 'job_fair',
        field_name: 'source_url',
        id: 'fair_invalid_policy',
        raw_url: 'https://jobs.example.com/fair/1',
        domains: '[1]',
        policy: 'allowlist_only',
      },
      {
        entity: 'job_fair',
        field_name: 'source_url',
        id: 'fair_dual',
        raw_url: 'http://jobs.example.com/fair/2',
        domains: '["jobs.example.com"]',
        policy: 'allowlist_only',
      },
      {
        entity: 'job_fair',
        field_name: 'checkin_url',
        id: 'fair_dual',
        raw_url: 'http://jobs.example.com/checkin/2',
        domains: '["jobs.example.com"]',
        policy: 'allowlist_only',
      },
    ],
    issues
  )
  assert.equal(issues['job_source_url_domain_policy_invalid']?.includes('job_allowed') ?? false, false)
  assert.deepEqual(issues['job_source_url_out_of_allowed_domain'], ['job_outside'])
  assert.deepEqual(issues['job_fair_source_url_domain_policy_invalid'], ['fair_invalid_policy'])
  assert.deepEqual(issues['job_fair_source_url_non_https'], ['fair_dual'])
  assert.deepEqual(issues['job_fair_checkin_url_non_https'], ['fair_dual'])
}

async function verifyPaginationAndDiff(): Promise<void> {
  const target = await resolveRecruitmentPublicTarget(config, {
    RECRUITMENT_WAVE2_PUBLIC_API_BASE_URL: 'http://127.0.0.1:3102/api/v1',
    RECRUITMENT_WAVE2_EXPECTED_PUBLIC_API_ORIGIN: 'http://127.0.0.1:3102',
    RECRUITMENT_WAVE2_EXPECTED_EXCLUDE_DEMO_PUBLIC_DATA: 'false',
  })
  const fixture: PublicIdSets = {
    jobs: makeIds('job', 101),
    jobFairs: makeIds('fair', 100),
    policies: makeIds('policy', 201),
    offlineAgencies: ['agency_000'],
    offlineJobs: makeIds('offline_job', 101),
  }
  const snapshot = await collectPublicSnapshot(config, target, fakeRequester(fixture))
  assert.deepEqual(snapshot.ids, fixture)
  const diff = diffIdSets(fixture, { ...fixture, jobs: fixture.jobs.slice(1) })
  assert.deepEqual(diff.jobs.missingFromApi, [fixture.jobs[0]])
  assert.deepEqual(diff.jobs.unexpectedInApi, [])
}

async function verifyDriftAndDuplicate(): Promise<void> {
  const target = await resolveRecruitmentPublicTarget(config, {
    RECRUITMENT_WAVE2_PUBLIC_API_BASE_URL: 'http://127.0.0.1:3102/api/v1',
    RECRUITMENT_WAVE2_EXPECTED_PUBLIC_API_ORIGIN: 'http://127.0.0.1:3102',
    RECRUITMENT_WAVE2_EXPECTED_EXCLUDE_DEMO_PUBLIC_DATA: 'false',
  })
  const fixture: PublicIdSets = {
    jobs: ['job_001'],
    jobFairs: [],
    policies: [],
    offlineAgencies: [],
    offlineJobs: [],
  }
  const first = await collectPublicSnapshot(config, target, fakeRequester(fixture))
  const second = await collectPublicSnapshot(
    config,
    target,
    fakeRequester({ ...fixture, jobs: ['job_002'] })
  )
  assert.throws(() => comparePublicSnapshots(first, second), /PUBLIC_API_SNAPSHOT_DRIFT/u)
  await assert.rejects(
    collectPublicSnapshot(
      config,
      target,
      fakeRequester({
        ...fixture,
        jobs: ['job_001', 'job_001'],
      })
    ),
    /PUBLIC_API_DUPLICATE_ID/u
  )
}

async function verifySqlAllowlist(): Promise<void> {
  const source = await readFile(
    join(__dirname, 'support/recruitment-wave2-full-inventory.ts'),
    'utf8'
  )
  for (const forbidden of [
    '"EndUser"',
    '"BrowseLog"',
    '"ExternalJumpLog"',
    '"Favorite"',
    '"ImportRecord"',
    '"KioskSession"',
    '"PrintTask"',
    '"ScanTask"',
    '"Order"',
    'SELECT *',
  ])
    assert.equal(source.includes(forbidden), false, `forbidden inventory read: ${forbidden}`)
  const fileMentions = source.match(/"FileObject"/gu)?.length ?? 0
  const safeFileMentions = source.match(/EXISTS \(SELECT 1 FROM "FileObject"/gu)?.length ?? 0
  assert.equal(
    fileMentions,
    safeFileMentions,
    'evidence facts may only appear in EXISTS predicates'
  )
  assert.equal(source.includes('"endpoint"'), false)
  assert.equal(source.includes('encryptedCredential'), false)
  assert.equal(source.includes('webhookSecret'), false)
  assert.match(source, /LEFT\("sourceOrgId",8\)='org_vff_'/u)
  assert.match(source, /LEFT\("externalId",4\)='VFF-'/u)
  assert.doesNotMatch(source, /"sourceOrgId" LIKE 'org_vff_%'/u)
  assert.match(source, /audit_invalid_payload_json:[\s\S]{0,500}recruitment\.%/u)
  assert.match(
    source,
    /audit_negative_action_reason_missing_candidate:[\s\S]{0,700}offline_agency%/u
  )
}

async function verifyReaderContracts(): Promise<void> {
  const root = join(__dirname, '..', 'src')
  const jobs = await readFile(join(root, 'jobs/jobs-kiosk.service.ts'), 'utf8')
  const agencies = await readFile(
    join(root, 'offline-agencies/offline-agencies.service.ts'),
    'utf8'
  )
  const policies = await readFile(join(root, 'policies/policies.service.ts'), 'utf8')
  assert.match(jobs, /orderBy: \[\{ syncTime: 'desc' \}, \{ id: 'asc' \}\]/u)
  assert.match(jobs, /orderBy: \[\{ startAt: 'asc' \}, \{ id: 'asc' \}\]/u)
  assert.match(agencies, /orderBy: \[\{ createdAt: 'desc' \}, \{ id: 'asc' \}\]/u)
  assert.match(policies, /\{ publishedDate: 'desc' \}, \{ createdAt: 'desc' \}, \{ id: 'asc' \}/u)
  assert.match(policies, /policyPost\.count\(\{ where \}\)/u)
  assert.match(policies, /pagination: \{ page, pageSize, total, totalPages:/u)
}

function fakeRequester(fixture: PublicIdSets) {
  return async (path: string): Promise<unknown> => {
    const url = new URL(path, 'http://127.0.0.1')
    if (url.pathname === '/health') return { success: true, data: { status: 'ok', db: 'postgres' } }
    let ids: string[]
    let legacy = false
    if (url.pathname === '/jobs') ids = fixture.jobs
    else if (url.pathname === '/job-fairs') ids = fixture.jobFairs
    else if (url.pathname === '/policies') ids = fixture.policies
    else if (url.pathname === '/kiosk/offline-agencies') {
      ids = fixture.offlineAgencies
      legacy = true
    } else if (/^\/kiosk\/offline-agencies\/[^/]+\/jobs$/u.test(url.pathname)) {
      ids = fixture.offlineJobs
      legacy = true
    } else throw new Error('unexpected fixture path')
    const page = Number(url.searchParams.get('page'))
    const pageSize = Number(url.searchParams.get('pageSize'))
    const data = ids.slice((page - 1) * pageSize, page * pageSize).map((id) => ({ id }))
    const meta = {
      page,
      pageSize,
      total: ids.length,
      totalPages: Math.max(1, Math.ceil(ids.length / pageSize)),
    }
    return legacy ? { data, ...meta } : { data, pagination: meta }
  }
}

function makeIds(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}_${String(index).padStart(3, '0')}`)
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
