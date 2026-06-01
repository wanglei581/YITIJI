/**
 * W8 BullMQ API pull worker — E2E verification script
 *
 * 用途：在有 REDIS_URL 的真实 Redis 环境下，验证 BullMQ API 拉取 worker 完整链路。
 *
 * 前置条件：
 *   - services/api/.env 已配置 DATABASE_URL / JWT_SECRET / SECRET_ENCRYPTION_KEY / FILE_SIGNING_SECRET 等
 *   - REDIS_URL 已设置（有 Redis 时走真实 BullMQ；否则走 inline fallback）
 *   - Redis 进程已启动（docker run -d -p 6379:6379 redis:7-alpine）
 *
 * 运行方式（从 services/api/ 目录）：
 *   pnpm ts-node -r tsconfig-paths/register scripts/verify-job-sync.ts
 *
 * 验证链路：
 *   本地 mock HTTP 服务器（返回测试岗位 JSON）
 *   → 创建测试 Org + JobSource（指向 mock server）
 *   → enqueue（BullMQ or inline）
 *   → 轮询 SyncLog（最长 30s）
 *   → 验证 Job 记录 reviewStatus=pending / publishStatus=draft
 *   → 验证失败源记录 failed + errorDetail
 *   → 清理测试数据
 *   → 报告 PASS / FAIL
 */
import 'dotenv/config'
import * as http from 'http'
import { NestFactory } from '@nestjs/core'
import { AppModule } from '../src/app.module'
import { JobSyncService } from '../src/job-sync/job-sync.service'
import { PrismaService } from '../src/prisma/prisma.service'

// ── Mock data ──────────────────────────────────────────────────────────────────

const MOCK_JOBS = [
  { id: 'e2e-j001', title: '前端工程师（E2E测试）', company: 'E2E测试科技有限公司', city: '广州', url: 'https://example.com/jobs/e2e-j001' },
  { id: 'e2e-j002', title: '后端工程师（E2E测试）', company: 'E2E测试科技有限公司', city: '广州', url: 'https://example.com/jobs/e2e-j002' },
]

// ── Helpers ────────────────────────────────────────────────────────────────────

function startMockServer(): Promise<{ port: number; server: http.Server }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jobs: MOCK_JOBS }))
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve({ port: addr.port, server })
    })
  })
}

function startBadMockServer(): Promise<{ port: number; server: http.Server }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(503, { 'Content-Type': 'text/plain' })
      res.end('Service Unavailable')
    })
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      resolve({ port: addr.port, server })
    })
  })
}

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

function pass(msg: string) { console.log(`  ✅ ${msg}`) }
function fail(msg: string) { console.error(`  ❌ ${msg}`); process.exitCode = 1 }
function info(msg: string) { console.log(`  ℹ  ${msg}`) }

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== W8 BullMQ API pull worker — E2E verification ===')
  console.log(`Redis: ${process.env['REDIS_URL'] ?? '(not set — inline fallback mode)'}`)
  console.log(`DB:    ${(process.env['DATABASE_URL'] ?? '').replace(/:[^@]+@/, ':***@').slice(0, 60)}\n`)

  // ── 1. Start mock servers ──────────────────────────────────────────────────
  const { port: goodPort, server: goodServer } = await startMockServer()
  const { port: badPort, server: badServer } = await startBadMockServer()
  info(`Mock OK  server: http://127.0.0.1:${goodPort}`)
  info(`Mock BAD server: http://127.0.0.1:${badPort}`)

  // ── 2. Bootstrap NestJS app context ───────────────────────────────────────
  info('Bootstrapping NestJS app context (suppress info logs)...')
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  })
  const prisma = app.get(PrismaService)
  const syncService = app.get(JobSyncService)
  info('App context ready.\n')

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
        endpoint:       `http://127.0.0.1:${goodPort}`,
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
        endpoint:   `http://127.0.0.1:${badPort}`,
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

      if (goodLog.result === 'success')            pass(`SyncLog.result = success`)                    else fail(`SyncLog.result = ${goodLog.result} (expected success)`)
      if (goodLog.addedCount === MOCK_JOBS.length) pass(`addedCount = ${goodLog.addedCount}`)          else fail(`addedCount = ${goodLog.addedCount} (expected ${MOCK_JOBS.length})`)
      if (jobs.length === MOCK_JOBS.length)        pass(`Job records in DB = ${jobs.length}`)          else fail(`Job records = ${jobs.length} (expected ${MOCK_JOBS.length})`)
      if (allPending)                              pass(`reviewStatus=pending / publishStatus=draft`)   else fail(`Some jobs NOT in pending/draft state`)
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

      if (badLog.result === 'failed') pass(`SyncLog.result = failed`)                                   else fail(`SyncLog.result = ${badLog.result} (expected failed)`)
      if (badLog.errorDetail)        pass(`errorDetail set: ${badLog.errorDetail.slice(0, 60)}`)        else fail(`errorDetail missing for failed sync`)

      const jobs = await prisma.job.findMany({ where: { sourceId: badSourceId } })
      if (jobs.length === 0) pass(`No Job records written for failed sync`) else fail(`Unexpected Job records: ${jobs.length}`)
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

    goodServer.close()
    badServer.close()
    await app.close()
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
