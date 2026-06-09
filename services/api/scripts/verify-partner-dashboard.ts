/**
 * Sprint 1 / Task 5 — 合作机构数据看板（partner-dashboard）验证。
 *
 * 覆盖：
 *   1. 统计正确：jobCount/jobFairCount/published 计数/pendingReviewCount/rejectedCount/syncSourceCount。
 *   2. 机构隔离：只统计本 orgId 的数据；其它机构(orgB)的岗位/招聘会/数据源绝不计入。
 *   3. 最近列表：recentJobs/recentJobFairs/recentSyncLogs，sourceName 解析、lastSyncTime 为最新。
 *   4. 数据边界：stats 只含约定字段，无访问量/增长率/趋势等伪造字段。
 *   5. orgId 空 → PARTNER_ORG_REQUIRED；org 不存在 → PARTNER_PROFILE_NOT_FOUND。
 *
 * 运行：pnpm verify:partner-dashboard
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { PrismaService } from '../src/prisma/prisma.service'
import { PartnerDashboardService } from '../src/partner-dashboard/partner-dashboard.service'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exit(1) }
function errCode(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown; response?: unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } } | undefined
  return resp?.error?.code
}
async function expectCode(fn: () => Promise<unknown>, code: string, label: string): Promise<void> {
  try { await fn(); fail(`${label} — 期望抛 ${code}，但未抛`) }
  catch (e) { const c = errCode(e); if (c === code) pass(label); else fail(`${label} — 期望 ${code}，实际：${c ?? (e as Error).message}`) }
}

async function main() {
  console.log('\n=== Sprint 1 / Task 5 合作机构数据看板验证 ===')
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const service = new PartnerDashboardService(prisma)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 8)
  const orgA = `org_da_${suffix}`
  const orgB = `org_db_${suffix}`
  const srcA = `js_${suffix}`
  const ext = (s: string) => `EXT-${suffix}-${s}`

  async function cleanup() {
    await prisma.syncLog.deleteMany({ where: { orgId: { in: [orgA, orgB] } } })
    await prisma.job.deleteMany({ where: { sourceOrgId: { in: [orgA, orgB] } } })
    await prisma.jobFair.deleteMany({ where: { sourceOrgId: { in: [orgA, orgB] } } })
    await prisma.jobSource.deleteMany({ where: { orgId: { in: [orgA, orgB] } } })
    await prisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } })
  }

  try {
    await cleanup()

    await prisma.organization.create({ data: { id: orgA, name: '看板验证机构A', type: 'public_employment_service' } })
    await prisma.organization.create({ data: { id: orgB, name: '看板验证机构B', type: 'public_employment_service' } })
    await prisma.jobSource.create({ data: { id: srcA, orgId: orgA, name: '市人才网 API', sourceKind: 'job_platform', accessMode: 'api' } })
    await prisma.jobSource.create({ data: { orgId: orgB, name: 'B机构源', sourceKind: 'job_platform', accessMode: 'api' } })

    const job = (n: string, review: string, publish: string, org: string) => ({
      sourceOrgId: org, externalId: ext(n), sourceName: '市人才网 API', sourceUrl: 'https://src.example.com',
      title: `岗位${n}`, company: '示例公司', city: '示例市', reviewStatus: review, publishStatus: publish,
    })
    await prisma.job.createMany({ data: [
      job('A1', 'approved', 'published', orgA),
      job('A2', 'approved', 'published', orgA),
      job('A3', 'pending', 'draft', orgA),
      job('A4', 'rejected', 'draft', orgA),
      job('B1', 'approved', 'published', orgB), // 隔离：不应计入 A
    ] })
    const fair = (n: string, review: string, publish: string, org: string) => ({
      sourceOrgId: org, externalId: ext(n), sourceName: '市人社局 Webhook', sourceUrl: 'https://src.example.com',
      title: `招聘会${n}`, startAt: new Date('2026-06-20T01:00:00.000Z'), endAt: new Date('2026-06-20T09:00:00.000Z'),
      venue: '示例会展中心', city: '示例市', reviewStatus: review, publishStatus: publish,
    })
    await prisma.jobFair.createMany({ data: [
      fair('FA1', 'approved', 'published', orgA),
      fair('FA2', 'pending', 'draft', orgA),
      fair('FB1', 'approved', 'published', orgB), // 隔离
    ] })
    await prisma.syncLog.createMany({ data: [
      { sourceId: srcA, orgId: orgA, dataType: 'job', syncMode: 'api', result: 'success', addedCount: 10, updatedCount: 2, errorCount: 0, createdAt: new Date('2026-06-08T10:00:00.000Z') },
      { sourceId: srcA, orgId: orgA, dataType: 'job', syncMode: 'api', result: 'partial', addedCount: 5, updatedCount: 1, errorCount: 2, createdAt: new Date('2026-06-09T08:00:00.000Z') },
    ] })
    pass('夹具就绪：orgA(4岗位/2招聘会/1源/2同步) + orgB(隔离数据)')

    const userA: AuthedUser = { userId: `u_${suffix}`, role: 'partner', orgId: orgA }
    const d = await service.getDashboard(userA)

    // ── 1 + 2. 统计 + 隔离 ──────────────────────────────────────
    const s = d.stats
    if (
      s.jobCount === 4 && s.jobFairCount === 2 &&
      s.publishedJobCount === 2 && s.publishedFairCount === 1 &&
      s.pendingReviewCount === 2 && s.rejectedCount === 1 && s.syncSourceCount === 1
    ) {
      pass('1+2. 统计正确且只看本 orgId（orgB 的岗位/招聘会/源未计入）')
    } else fail(`1+2. 统计异常：${JSON.stringify(s)}`)

    if (d.org.id === orgA && d.org.name === '看板验证机构A') pass('2b. org 信息为本机构')
    else fail(`2b. org 异常：${JSON.stringify(d.org)}`)

    // ── 3. 最近列表 ─────────────────────────────────────────────
    const jobTitles = d.recentJobs.map((j) => j.title)
    if (
      d.recentJobs.length === 4 && !jobTitles.includes('岗位B1') &&
      d.recentJobFairs.length === 2 &&
      d.recentSyncLogs.length === 2 && d.recentSyncLogs[0]?.sourceName === '市人才网 API' &&
      d.recentSyncLogs[0]?.successCount === 6 && d.recentSyncLogs[0]?.failCount === 2 && // 最新那条(partial)
      s.lastSyncTime === '2026-06-09T08:00:00.000Z'
    ) {
      pass('3. 最近列表：recentJobs/Fairs/SyncLogs 正确，sourceName 解析、successCount/failCount/lastSyncTime 正确')
    } else fail(`3. 最近列表异常：jobs=${d.recentJobs.length} fairs=${d.recentJobFairs.length} sync=${JSON.stringify(d.recentSyncLogs[0])} last=${s.lastSyncTime}`)

    // ── 4. 数据边界：无伪造字段 ─────────────────────────────────
    const statKeys = Object.keys(s).sort().join(',')
    const expectedKeys = ['jobCount','jobFairCount','publishedJobCount','publishedFairCount','pendingReviewCount','rejectedCount','syncSourceCount','lastSyncTime'].sort().join(',')
    const blob = JSON.stringify(d)
    // 仅匹配明确的"伪造指标 / 招聘闭环"词；用词边界避免误伤 pendingReviewCount 等合法字段。
    const hasFake = /\bvisits?\b|pageview|page.?view|growth.?rate|\btrend|访问量|增长率|趋势|candidate|候选人|简历|投递|面试邀约|\boffer\b/i.test(blob)
    if (statKeys === expectedKeys && !hasFake && typeof d.updatedAt === 'string') {
      pass('4. 数据边界：stats 仅含约定字段，无访问量/增长率/趋势/候选人/简历/投递/面试/Offer')
    } else fail(`4. 数据边界异常：keys=${statKeys} hasFake=${hasFake}`)

    // ── 5. 鉴权/隔离守卫 ────────────────────────────────────────
    await expectCode(() => service.getDashboard({ userId: 'x', role: 'partner', orgId: null }), 'PARTNER_ORG_REQUIRED', '5a. orgId 空 → PARTNER_ORG_REQUIRED')
    await expectCode(() => service.getDashboard({ userId: 'x', role: 'partner', orgId: 'org_not_exist' }), 'PARTNER_PROFILE_NOT_FOUND', '5b. org 不存在 → PARTNER_PROFILE_NOT_FOUND')
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }

  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  process.exit(1)
})
