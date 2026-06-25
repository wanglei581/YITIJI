/**
 * Partner self-service profile/dashboard verification.
 *
 * This guards the current main-line contract after reviewing the old
 * feature/sprint1-partner-dashboard branch:
 *   - Partner profile self-edit is limited to contact/contactPhone.
 *   - Organization identity, type, scene template and enabled modules remain
 *     admin-owned.
 *   - Partner dashboard is derived from real org-scoped data only.
 *   - No fake traffic/growth/recruitment-closure metrics appear in the payload.
 *
 * Run: pnpm --filter @ai-job-print/api verify:partner-org-self
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { AuditService } from '../src/audit/audit.service'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'
import { JobsService } from '../src/jobs/jobs.service'
import { AdminOrgsService } from '../src/orgs/admin-orgs.service'
import { PrismaService } from '../src/prisma/prisma.service'

function pass(message: string) { console.log(`  PASS ${message}`) }
function fail(message: string): never { throw new Error(message) }

function errorCode(error: unknown): string | undefined {
  const ex = error as { getResponse?: () => unknown; response?: unknown }
  const response = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } | string; message?: string | string[] }
    | undefined
  if (response?.error && typeof response.error === 'object') return response.error.code
  if (typeof response?.message === 'string' && /^[A-Z0-9_]+$/.test(response.message)) return response.message
  if (Array.isArray(response?.message)) return response.message.find((message) => /^[A-Z0-9_]+$/.test(message))
  return undefined
}

async function expectCode(fn: () => Promise<unknown>, code: string, label: string): Promise<void> {
  try {
    await fn()
    fail(`${label} - expected ${code}, but call succeeded`)
  } catch (error) {
    const actual = errorCode(error)
    if (actual === code) pass(label)
    else fail(`${label} - expected ${code}, actual ${actual ?? (error as Error).message}`)
  }
}

function expect(condition: boolean, message: string): void {
  if (!condition) fail(message)
}

function extractPrismaModel(schema: string, modelName: string): string {
  const lines = schema
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
  const start = lines.findIndex((line) => new RegExp(`^\\s*model\\s+${modelName}\\s+\\{`).test(line))
  if (start < 0) return ''

  const collected: string[] = []
  let depth = 0
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i]!
    collected.push(line)
    depth += (line.match(/\{/g) ?? []).length
    depth -= (line.match(/\}/g) ?? []).length
    if (depth === 0) break
  }
  return collected.join('\n')
}

function collectObjectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectObjectKeys(item, keys)
    return keys
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key)
      collectObjectKeys(child, keys)
    }
  }
  return keys
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
    } catch {
      return {}
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function assertVerifyDatabaseSafe(): void {
  const databaseUrl = process.env['DATABASE_URL']
  expect(process.env['NODE_ENV'] !== 'production', 'database safety: verify must not run with NODE_ENV=production')
  expect(Boolean(databaseUrl?.startsWith('file:')), 'database safety: verify must run against local SQLite DATABASE_URL=file:')
  pass('0a. database safety: local SQLite verify database confirmed')
}

function assertCurrentShapeSource(): void {
  const schema = readFileSync(join(__dirname, '../prisma/schema.prisma'), 'utf8')
  const orgModel = extractPrismaModel(schema, 'Organization')
  expect(orgModel.length > 0, 'source check: Organization model missing')
  for (const driftField of ['creditCode', 'contactEmail', 'address', 'description', 'websiteUrl']) {
    expect(!new RegExp(`^\\s*${driftField}\\b`, 'm').test(orgModel), `source check: stale Organization field ${driftField} must stay absent`)
  }
  pass('0. source shape: stale Organization profile drift fields are absent')
}

async function main() {
  console.log('\n=== Partner self-service profile/dashboard verification ===')
  assertCurrentShapeSource()
  assertVerifyDatabaseSafe()

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const orgs = new AdminOrgsService(prisma, audit)
  const jobs = new JobsService(prisma, audit)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const staleOrgPrefix = 'org_psv_'
  const staleUserPrefix = 'user_psv_'
  const orgA = `org_psv_a_${suffix}`
  const orgB = `org_psv_b_${suffix}`
  const userAId = `user_psv_a_${suffix}`
  const sourceA = `src_psv_a_${suffix}`
  const sourceB = `src_psv_b_${suffix}`
  const ext = (value: string) => `PSV-${suffix}-${value}`

  const userA: AuthedUser = { userId: userAId, role: 'partner', orgId: orgA }

  async function cleanupResidue() {
    const staleCutoff = new Date(Date.now() - 2 * 60 * 60 * 1000)
    await prisma.auditLog.deleteMany({
      where: {
        createdAt: { lt: staleCutoff },
        OR: [
          { targetId: { startsWith: staleOrgPrefix } },
          { actorId: { startsWith: staleUserPrefix } },
        ],
      },
    })
    await prisma.syncLog.deleteMany({ where: { orgId: { startsWith: staleOrgPrefix }, createdAt: { lt: staleCutoff } } })
    await prisma.job.deleteMany({ where: { sourceOrgId: { startsWith: staleOrgPrefix }, createdAt: { lt: staleCutoff } } })
    await prisma.jobFair.deleteMany({ where: { sourceOrgId: { startsWith: staleOrgPrefix }, createdAt: { lt: staleCutoff } } })
    await prisma.policyPost.deleteMany({ where: { sourceOrgId: { startsWith: staleOrgPrefix }, createdAt: { lt: staleCutoff } } })
    await prisma.jobSource.deleteMany({ where: { orgId: { startsWith: staleOrgPrefix }, createdAt: { lt: staleCutoff } } })
    await prisma.user.deleteMany({ where: { id: { startsWith: staleUserPrefix }, createdAt: { lt: staleCutoff } } })
    await prisma.organization.deleteMany({ where: { id: { startsWith: staleOrgPrefix }, createdAt: { lt: staleCutoff } } })
  }

  async function cleanupCurrentRun() {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { targetId: { in: [orgA, orgB] } },
          { actorId: userAId },
        ],
      },
    })
    await prisma.syncLog.deleteMany({ where: { orgId: { in: [orgA, orgB] } } })
    await prisma.job.deleteMany({ where: { sourceOrgId: { in: [orgA, orgB] } } })
    await prisma.jobFair.deleteMany({ where: { sourceOrgId: { in: [orgA, orgB] } } })
    await prisma.policyPost.deleteMany({ where: { sourceOrgId: { in: [orgA, orgB] } } })
    await prisma.jobSource.deleteMany({ where: { orgId: { in: [orgA, orgB] } } })
    await prisma.user.deleteMany({ where: { id: userAId } })
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } })
  }

  try {
    await cleanupResidue()

    await prisma.organization.createMany({
      data: [
        {
          id: orgA,
          name: '自助验证机构A',
          type: 'public_employment_service',
          contact: '原联系人',
          contactPhone: '0532-00000000',
          sceneTemplate: 'public_employment',
          enabledModulesJson: JSON.stringify(['print_scan', 'policy_service']),
          enabled: true,
        },
        {
          id: orgB,
          name: '自助验证机构B',
          type: 'school_employment_center',
          contact: '隔离联系人',
          contactPhone: '0532-11111111',
          sceneTemplate: 'school',
          enabledModulesJson: JSON.stringify(['job_info']),
          enabled: true,
        },
      ],
    })
    await prisma.user.create({
      data: { id: userAId, username: `psv_partner_${suffix}`, passwordHash: 'verify-not-a-real-hash', name: '自助验证账号', role: 'partner', orgId: orgA },
    })
    await prisma.jobSource.createMany({
      data: [
        { id: sourceA, orgId: orgA, name: 'A机构数据源', sourceKind: 'manual', accessMode: 'manual', enabled: true },
        { id: sourceB, orgId: orgB, name: 'B机构数据源', sourceKind: 'manual', accessMode: 'manual', enabled: true },
      ],
    })

    await prisma.job.createMany({
      data: [
        { sourceOrgId: orgA, sourceId: sourceA, externalId: ext('job-1'), sourceName: 'A机构数据源', sourceUrl: 'https://example.com/a/job/1', title: 'A已发布岗位', company: 'A公司', city: '青岛', reviewStatus: 'approved', publishStatus: 'published' },
        { sourceOrgId: orgA, sourceId: sourceA, externalId: ext('job-2'), sourceName: 'A机构数据源', sourceUrl: 'https://example.com/a/job/2', title: 'A待审岗位', company: 'A公司', city: '青岛', reviewStatus: 'pending', publishStatus: 'draft' },
        { sourceOrgId: orgA, sourceId: sourceA, externalId: ext('job-3'), sourceName: 'A机构数据源', sourceUrl: 'https://example.com/a/job/3', title: 'A拒绝岗位', company: 'A公司', city: '青岛', reviewStatus: 'rejected', publishStatus: 'draft' },
        { sourceOrgId: orgB, sourceId: sourceB, externalId: ext('job-b'), sourceName: 'B机构数据源', sourceUrl: 'https://example.com/b/job', title: 'B隔离岗位', company: 'B公司', city: '青岛', reviewStatus: 'approved', publishStatus: 'published' },
      ],
    })
    await prisma.jobFair.createMany({
      data: [
        { sourceOrgId: orgA, sourceId: sourceA, externalId: ext('fair-1'), sourceName: 'A机构数据源', sourceUrl: 'https://example.com/a/fair/1', title: 'A已发布招聘会', startAt: new Date('2026-07-01T01:00:00.000Z'), endAt: new Date('2026-07-01T09:00:00.000Z'), venue: 'A会场', city: '青岛', reviewStatus: 'approved', publishStatus: 'published' },
        { sourceOrgId: orgA, sourceId: sourceA, externalId: ext('fair-2'), sourceName: 'A机构数据源', sourceUrl: 'https://example.com/a/fair/2', title: 'A待审招聘会', startAt: new Date('2026-07-02T01:00:00.000Z'), endAt: new Date('2026-07-02T09:00:00.000Z'), venue: 'A会场', city: '青岛', reviewStatus: 'pending', publishStatus: 'draft' },
        { sourceOrgId: orgB, sourceId: sourceB, externalId: ext('fair-b'), sourceName: 'B机构数据源', sourceUrl: 'https://example.com/b/fair', title: 'B隔离招聘会', startAt: new Date('2026-07-03T01:00:00.000Z'), endAt: new Date('2026-07-03T09:00:00.000Z'), venue: 'B会场', city: '青岛', reviewStatus: 'approved', publishStatus: 'published' },
      ],
    })
    await prisma.policyPost.createMany({
      data: [
        { sourceOrgId: orgA, sourceName: 'A机构数据源', kind: 'notice', title: 'A已发布政策', reviewStatus: 'approved', publishStatus: 'published' },
        { sourceOrgId: orgA, sourceName: 'A机构数据源', kind: 'notice', title: 'A待审政策', reviewStatus: 'pending', publishStatus: 'draft' },
        { sourceOrgId: orgB, sourceName: 'B机构数据源', kind: 'notice', title: 'B隔离政策', reviewStatus: 'approved', publishStatus: 'published' },
      ],
    })
    const latestSyncAt = new Date()
    const olderSyncAt = new Date(latestSyncAt.getTime() - 60 * 60 * 1000)
    await prisma.syncLog.createMany({
      data: [
        { sourceId: sourceA, orgId: orgA, dataType: 'job', syncMode: 'manual', result: 'success', addedCount: 3, updatedCount: 1, errorCount: 0, createdAt: olderSyncAt },
        { sourceId: sourceA, orgId: orgA, dataType: 'fair', syncMode: 'manual', result: 'partial', addedCount: 1, updatedCount: 0, errorCount: 2, createdAt: latestSyncAt },
        { sourceId: sourceB, orgId: orgB, dataType: 'job', syncMode: 'manual', result: 'success', addedCount: 9, updatedCount: 0, errorCount: 0, createdAt: latestSyncAt },
      ],
    })
    pass('1. fixtures ready: two orgs with isolated jobs/fairs/policies/sources/sync logs')

    const profile = await orgs.getOwnProfile(userA)
    expect(profile.id === orgA && profile.name === '自助验证机构A', '2. profile read returned wrong org')
    expect(profile.sourceCount === 1 && profile.accountCount === 1, '2. profile source/account counts wrong')
    expect(profile.enabledModules.join(',') === 'print_scan,policy_service', '2. profile enabledModules parsing wrong')
    pass('2. profile read is org-scoped and exposes admin-owned fields read-only')

    await expectCode(
      () => orgs.updateOwnProfile(userA, { name: '越权改名' } as unknown as { contact?: string; contactPhone?: string }, { headers: {}, ip: '127.0.0.1', requestId: `req_empty_${suffix}` }),
      'ORG_PROFILE_EMPTY',
      '3a. extra-only profile payload is ignored and rejected as empty',
    )

    const updatedProfile = await orgs.updateOwnProfile(
      userA,
      { contact: '新联系人', contactPhone: '0532-22222222', name: '越权改名', enabledModules: ['candidate_management'] } as unknown as { contact?: string; contactPhone?: string },
      { headers: { 'user-agent': 'verify-partner-org-self' }, ip: '127.0.0.1', requestId: `req_update_${suffix}` },
    )
    const orgAfter = await prisma.organization.findUnique({
      where: { id: orgA },
      select: { name: true, type: true, contact: true, contactPhone: true, sceneTemplate: true, enabledModulesJson: true },
    })
    expect(updatedProfile.contact === '新联系人' && updatedProfile.contactPhone === '0532-22222222', '3b. contact fields were not updated')
    expect(orgAfter?.name === '自助验证机构A', '3b. partner self-update must not change organization name')
    expect(orgAfter?.type === 'public_employment_service', '3b. partner self-update must not change organization type')
    expect(orgAfter?.sceneTemplate === 'public_employment', '3b. partner self-update must not change sceneTemplate')
    expect(orgAfter?.enabledModulesJson === JSON.stringify(['print_scan', 'policy_service']), '3b. partner self-update must not change enabledModules')
    const auditLog = await prisma.auditLog.findFirst({
      where: { actorId: userAId, action: 'org.self_profile_update', targetType: 'organization', targetId: orgA },
      orderBy: { createdAt: 'desc' },
    })
    expect(Boolean(auditLog), '3c. org.self_profile_update audit log missing')
    const auditPayload = parseJsonObject(auditLog?.payloadJson)
    const changedFields = Array.isArray(auditPayload['fields']) ? auditPayload['fields'] : []
    expect(changedFields.includes('contact') && changedFields.includes('contactPhone'), '3c. audit payload must record changed contact fields')
    expect(!changedFields.includes('name') && !changedFields.includes('enabledModules'), '3c. audit payload must not include ignored admin-owned fields')
    pass('3. profile update allowlist holds: only contact/contactPhone mutate and audit')

    await expectCode(() => orgs.getOwnProfile({ userId: userAId, role: 'partner', orgId: null }), 'ORG_REQUIRED', '4a. profile missing orgId is rejected')
    await expectCode(() => orgs.getOwnProfile({ userId: userAId, role: 'partner', orgId: `missing_${suffix}` }), 'ORG_NOT_FOUND', '4b. profile nonexistent org is rejected')

    const dashboard = await jobs.getPartnerDashboard(userA)
    expect(dashboard.jobs.total === 3 && dashboard.jobs.published === 1 && dashboard.jobs.pending === 1, '5a. dashboard job counts are wrong or not org-scoped')
    expect(dashboard.fairs.total === 2 && dashboard.fairs.published === 1 && dashboard.fairs.pending === 1, '5a. dashboard fair counts are wrong or not org-scoped')
    expect(dashboard.policies.total === 2 && dashboard.policies.published === 1 && dashboard.policies.pending === 1, '5a. dashboard policy counts are wrong or not org-scoped')
    expect(dashboard.pendingTotal === 3, '5a. dashboard pendingTotal must include jobs + fairs + policies')
    expect(dashboard.sources.total === 1 && dashboard.sources.enabled === 1, '5a. dashboard source counts are wrong or not org-scoped')
    expect(dashboard.recentSyncs.length === 2 && dashboard.recentSyncs[0]?.source === 'A机构数据源', '5b. dashboard recent syncs must be org-scoped and show source name')
    expect(!JSON.stringify(dashboard).includes('B隔离'), '5b. dashboard leaked another org data')
    pass('5. dashboard aggregates only current org real data, including policy counts')

    const dashboardKeys = [...collectObjectKeys(dashboard)].join(' ')
    const fakeMetricPattern = /visits?|page.?view|growth.?rate|\btrend\b|访问量|增长率|趋势|candidate|候选人|简历|投递|面试|offer/i
    expect(!fakeMetricPattern.test(dashboardKeys), '6. dashboard payload contains fake or recruitment-closure metric fields')
    pass('6. dashboard payload has no fake traffic/growth/recruitment-closure metrics')

    await expectCode(() => jobs.getPartnerDashboard({ userId: userAId, role: 'partner', orgId: null }), 'ORG_REQUIRED', '7. dashboard missing orgId is rejected')
  } finally {
    try {
      await cleanupCurrentRun()
    } finally {
      await prisma.onModuleDestroy()
    }
  }

  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  process.exit(1)
})
