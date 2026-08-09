/**
 * API pull review-reset — deterministic service integration verifier
 *
 * 用途：在隔离验证库中运行生产 JobSyncService，验证内容变更强制重审。
 *
 * 前置条件：
 *   - DATABASE_URL 指向全新 SQLite 或隔离 PostgreSQL
 *   - 不需 Redis，固定走 JobSyncService inline fallback
 *
 * 运行方式（从 services/api/ 目录）：
 *   pnpm verify:job-sync
 *
 * 验证链路：
 *   测试边界提供确定 JSON / 失败结果
 *   → 创建测试 Org + JobSource
 *   → enqueue（inline）
 *   → 轮询 SyncLog（最长 30s）
 *   → 验证 Job 记录 reviewStatus=pending / publishStatus=draft
 *   → 验证失败源记录 failed + errorDetail
 *   → 清理测试数据
 *   → 报告 PASS / FAIL
 */
import 'dotenv/config'
import { JobSyncService } from '../src/job-sync/job-sync.service'
import { PrismaService } from '../src/prisma/prisma.service'
import type { AuditService } from '../src/audit/audit.service'
import type { JobQualityService } from '../src/job-ai/job-quality.service'

// ── Mock data ──────────────────────────────────────────────────────────────────

const MOCK_JOBS = [
  { id: 'e2e-j001', title: '前端工程师（E2E测试）', company: 'E2E测试科技有限公司', city: '广州', url: 'https://example.com/jobs/e2e-j001' },
  { id: 'e2e-j002', title: '后端工程师（E2E测试）', company: 'E2E测试科技有限公司', city: '广州', url: 'https://example.com/jobs/e2e-j002' },
]

// ── Helpers ────────────────────────────────────────────────────────────────────

async function pollForSyncLog(
  prisma: PrismaService,
  sourceId: string,
  timeoutMs = 30_000,
): Promise<{ id: string; result: string; addedCount: number; errorDetail: string | null } | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const log = await prisma.syncLog.findFirst({
      where: { sourceId },
      orderBy: { createdAt: 'desc' },
    })
    if (log) return log
    await new Promise((r) => setTimeout(r, 1_000))
  }
  return null
}

async function pollForNewSyncLog(
  prisma: PrismaService,
  sourceId: string,
  previousIds: string[],
  timeoutMs = 30_000,
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const log = await prisma.syncLog.findFirst({
      where: { sourceId, id: { notIn: previousIds } },
      orderBy: { createdAt: 'desc' },
    })
    if (log) return log
    await new Promise((r) => setTimeout(r, 1_000))
  }
  return null
}

function pass(msg: string) { console.log(`  ✅ ${msg}`) }
function fail(msg: string) { console.error(`  ❌ ${msg}`); process.exitCode = 1 }
function info(msg: string) { console.log(`  ℹ  ${msg}`) }

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== API pull review-reset integration verification ===')
  console.log('Mode:  inline fallback with deterministic fetch boundary')
  console.log(`DB:    ${(process.env['DATABASE_URL'] ?? '').replace(/:[^@]+@/, ':***@').slice(0, 60)}\n`)

  // ── 1. Build production service against the isolated verifier DB ─────────
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const quality = { refreshJobQualitySnapshots: async () => undefined } as unknown as JobQualityService
  const audit = { write: async () => 'verify-job-sync-audit' } as unknown as AuditService
  const syncService = new JobSyncService(prisma, quality, audit)
  ;(syncService as unknown as { fetchJson: (endpoint: string) => Promise<unknown> }).fetchJson = async (endpoint) => {
    if (endpoint.includes('bad-source')) throw new Error('HTTP_503')
    return { jobs: MOCK_JOBS.map((job) => ({ ...job })) }
  }
  info('Production JobSyncService ready.\n')

  const TEST_ORG_ID = `e2e-verify-org-${Date.now()}`
  let goodSourceId = ''
  let badSourceId  = ''

  try {
    // ── 3. Create test Organization ──────────────────────────────────────────
    await prisma.organization.create({
      data: { id: TEST_ORG_ID, name: 'E2E Verify Org', type: 'licensed_hr_agency' },
    })
    info(`Created test org: ${TEST_ORG_ID}`)

    // ── 4a. Create GOOD JobSource (points to mock returning valid job JSON) ──
    const goodSource = await prisma.jobSource.create({
      data: {
        orgId:          TEST_ORG_ID,
        name:           'E2E Good Source',
        sourceKind:     'aggregator',
        accessMode:     'api',
        syncFreq:       'manual',
        enabled:        true,
        endpoint:       'https://good-source.invalid/jobs',
        authType:       null,
        // dataType=job；fields 把 url → sourceUrl
        responseConfig: JSON.stringify({ dataType: 'job', fields: { sourceUrl: 'url' } }),
      },
    })
    goodSourceId = goodSource.id
    info(`Created good source: ${goodSourceId}`)

    // ── 4b. Create BAD JobSource (points to 503 server) ──────────────────────
    const badSource = await prisma.jobSource.create({
      data: {
        orgId:      TEST_ORG_ID,
        name:       'E2E Bad Source',
        sourceKind: 'aggregator',
        accessMode: 'api',
        syncFreq:   'manual',
        enabled:    true,
        endpoint:   'https://bad-source.invalid/jobs',
      },
    })
    badSourceId = badSource.id
    info(`Created bad source:  ${badSourceId}\n`)

    // ── 5. Test A: success path ───────────────────────────────────────────────
    console.log('── Test A: success path ──────────────────────────────────────────────────')
    const goodJobId = await syncService.enqueue(goodSourceId, true)
    info(`enqueue() → jobId=${goodJobId ?? 'inline'}`)

    info('Waiting for SyncLog (up to 30s)...')
    const goodLog = await pollForSyncLog(prisma, goodSourceId, 30_000)

    if (!goodLog) {
      fail('SyncLog not written within 30s — worker may not be running or Redis unreachable')
    } else {
      info(`SyncLog: result=${goodLog.result} added=${goodLog.addedCount} errorDetail=${goodLog.errorDetail ?? 'none'}`)

      const jobs = await prisma.job.findMany({ where: { sourceId: goodSourceId } })
      const allPending = jobs.every((j) => j.reviewStatus === 'pending' && j.publishStatus === 'draft')

      if (goodLog.result === 'success') { pass('SyncLog.result = success') } else { fail(`SyncLog.result = ${goodLog.result} (expected success)`) }
      if (goodLog.addedCount === MOCK_JOBS.length) { pass(`addedCount = ${goodLog.addedCount}`) } else { fail(`addedCount = ${goodLog.addedCount} (expected ${MOCK_JOBS.length})`) }
      if (jobs.length === MOCK_JOBS.length) { pass(`Job records in DB = ${jobs.length}`) } else { fail(`Job records = ${jobs.length} (expected ${MOCK_JOBS.length})`) }
      if (allPending) { pass('reviewStatus=pending / publishStatus=draft') } else { fail('Some jobs NOT in pending/draft state') }

      // ── Test A2: unchanged sync keeps approval; changed content re-enters review ──
      await prisma.job.updateMany({
        where: { sourceId: goodSourceId },
        data: { reviewStatus: 'approved', publishStatus: 'published', reviewedAt: new Date() },
      })

      console.log('\n── Test A2: unchanged vs changed content review gate ─────────────────────')
      await new Promise<void>((resolve) => setImmediate(resolve))
      await syncService.enqueue(goodSourceId, true)
      const unchangedLog = await pollForNewSyncLog(prisma, goodSourceId, [goodLog.id])
      if (!unchangedLog) {
        fail('Unchanged re-sync did not produce a new SyncLog')
      } else {
        const unchangedJobs = await prisma.job.findMany({ where: { sourceId: goodSourceId } })
        if (unchangedJobs.every((job) => job.reviewStatus === 'approved' && job.publishStatus === 'published')) {
          pass('Unchanged content only refreshes syncTime and preserves approval')
        } else {
          fail('Unchanged content unexpectedly reset review state')
        }

        MOCK_JOBS[0]!.title = '前端工程师（E2E测试·来源已更新）'
        await new Promise<void>((resolve) => setImmediate(resolve))
        await syncService.enqueue(goodSourceId, true)
        const changedLog = await pollForNewSyncLog(prisma, goodSourceId, [goodLog.id, unchangedLog.id])
        if (!changedLog) {
          fail('Changed re-sync did not produce a new SyncLog')
        } else {
          const changed = await prisma.job.findFirst({ where: { sourceId: goodSourceId, externalId: 'e2e-j001' } })
          const untouched = await prisma.job.findFirst({ where: { sourceId: goodSourceId, externalId: 'e2e-j002' } })
          if (changed?.reviewStatus === 'pending' && changed.publishStatus === 'draft' && changed.reviewedAt === null) {
            pass('Changed source content resets to pending/draft and clears review metadata')
          } else {
            fail('Changed source content did not re-enter review')
          }
          if (untouched?.reviewStatus === 'approved' && untouched.publishStatus === 'published') {
            pass('Unchanged sibling job remains approved/published')
          } else {
            fail('Unchanged sibling job was incorrectly reset')
          }
        }
      }
    }

    // ── 6. Test B: failure path ───────────────────────────────────────────────
    console.log('\n── Test B: failure path (HTTP 503 source) ───────────────────────────────')
    const badJobId = await syncService.enqueue(badSourceId, true)
    info(`enqueue() → jobId=${badJobId ?? 'inline'}`)

    info('Waiting for SyncLog (up to 30s)...')
    const badLog = await pollForSyncLog(prisma, badSourceId, 30_000)

    if (!badLog) {
      fail('SyncLog not written within 30s for failure case')
    } else {
      info(`SyncLog: result=${badLog.result} errorDetail=${badLog.errorDetail ?? 'none'}`)

      if (badLog.result === 'failed') { pass('SyncLog.result = failed') } else { fail(`SyncLog.result = ${badLog.result} (expected failed)`) }
      if (badLog.errorDetail) { pass(`errorDetail set: ${badLog.errorDetail.slice(0, 60)}`) } else { fail('errorDetail missing for failed sync') }

      const jobs = await prisma.job.findMany({ where: { sourceId: badSourceId } })
      if (jobs.length === 0) { pass('No Job records written for failed sync') } else { fail(`Unexpected Job records: ${jobs.length}`) }
    }

  } finally {
    // ── 7. Cleanup test data ──────────────────────────────────────────────────
    console.log('\n── Cleanup ──────────────────────────────────────────────────────────────')
    if (goodSourceId) {
      await prisma.syncLog.deleteMany({ where: { sourceId: goodSourceId } })
      await prisma.job.deleteMany({ where: { sourceId: goodSourceId } })
      await prisma.jobSource.deleteMany({ where: { id: goodSourceId } })
    }
    if (badSourceId) {
      await prisma.syncLog.deleteMany({ where: { sourceId: badSourceId } })
      await prisma.jobSource.deleteMany({ where: { id: badSourceId } })
    }
    await prisma.organization.deleteMany({ where: { id: TEST_ORG_ID } })
    info('Test data removed.')

    await prisma.onModuleDestroy()
  }

  const exitCode = process.exitCode ?? 0
  console.log(`\n${'─'.repeat(60)}`)
  console.log(exitCode === 0 ? '✅ ALL PASS' : '❌ SOME CHECKS FAILED')
  console.log('─'.repeat(60))

  if (exitCode !== 0) process.exit(exitCode)
}

main().catch((e: unknown) => {
  console.error('\nFatal error:', (e as Error).message)
  console.error((e as Error).stack)
  process.exit(1)
})
