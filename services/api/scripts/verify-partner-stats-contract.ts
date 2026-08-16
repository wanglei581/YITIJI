/**
 * GET /partner/stats 契约验证（C1，2026-08-16）
 *
 * C0 事实冻结（docs/reviews/console-c0-fact-freeze-2026-08-16.md §2.4）登记了两处
 * 硬性不一致，本脚本把裁定结果钉死：
 *
 *   1. timezone 参数：DTO 只白名单 period。全局 ValidationPipe 的
 *      forbidNonWhitelisted 会把多余参数拒成 400 VALIDATION_FAILED。
 *      裁定 = 前端不发该参数；时区由服务端在响应里单向声明。
 *      本脚本直接跑 ValidationPipe 证明「发了就会 400」，
 *      从而证明 adapter 必须不发。
 *
 *   2. 响应信封：orgs 模块全部控制器返回裸对象（ApiResponse 出现 0 次）。
 *      裁定 = 保持裸对象，前端 adapter 不再取 body.data。
 *      本脚本断言 orgs 模块不引入 ApiResponse，避免又漂回信封。
 *
 * 另守三条产品红线：
 *   - 跨租户：orgId 只能来自 token，服务只返回本机构数据。
 *   - 不伪造漏斗：归因恒 available:false，且服务不得去 join 行为日志。
 *   - 无个人明细：响应里不得出现任何求职者身份字段。
 *
 * Run: pnpm --filter @ai-job-print/api verify:partner-stats-contract
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { ValidationPipe, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { PartnerStatsQueryDto } from '../src/orgs/partner-stats.controller'
import {
  PartnerStatsService,
  MIN_AGGREGATE_SAMPLE,
  STATS_TIMEZONE,
} from '../src/orgs/partner-stats.service'

let passed = 0
let failed = 0

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`)
    passed++
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
    failed++
  }
}

function readSrc(relative: string): string {
  return readFileSync(join(__dirname, '..', relative), 'utf8')
}

/** 去注释，契约断言只看真正会执行的代码 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\/\/.*$/, ''))
    .join('\n')
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys)
    return keys
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key)
      collectKeys(child, keys)
    }
  }
  return keys
}

function assertVerifyDatabaseSafe(): void {
  const databaseUrl = process.env['DATABASE_URL']
  assert(
    '0a. 数据库安全：NODE_ENV 不是 production',
    process.env['NODE_ENV'] !== 'production',
  )
  assert(
    '0b. 数据库安全：跑在本地 SQLite（DATABASE_URL=file:）',
    Boolean(databaseUrl?.startsWith('file:')),
    `DATABASE_URL=${databaseUrl ?? '(unset)'}`,
  )
}

// ── 1. 源码级契约 ──────────────────────────────────────────────────────────

function assertSourceContract(): void {
  const controller = stripComments(readSrc('src/orgs/partner-stats.controller.ts'))
  const service = stripComments(readSrc('src/orgs/partner-stats.service.ts'))

  // 1a. DTO 只白名单 period —— timezone 不得偷偷加进来当摆设
  assert(
    '1a. PartnerStatsQueryDto 只白名单 period',
    /period\?:\s*StatsPeriod/.test(controller) && !/timezone/i.test(controller),
    'DTO 里出现了 timezone 或缺少 period',
  )

  // 1b. orgs 模块保持裸对象信封
  assert(
    '1b. partner-stats 控制器不套 ApiResponse 信封',
    !controller.includes('ApiResponse'),
  )

  // 1c. orgId 只能取自 token
  assert(
    '1c. orgId 取自 token（user.orgId），不从 query 读取',
    controller.includes('user.orgId') && !/query\.orgId/.test(controller),
  )

  // 1d. 服务不得 join 行为日志做「当前归属」归因（会漂移）
  assert(
    '1d. 服务不查 BrowseLog / ExternalJumpLog（避免可漂移的归因）',
    !service.includes('browseLog') && !service.includes('externalJumpLog'),
  )
}

// ── 2. ValidationPipe 真跑：证明 timezone 会被拒 ───────────────────────────

async function assertQueryValidation(): Promise<void> {
  // 与 main.ts:88-91 的全局配置一致
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: () => new BadRequestException({ error: { code: 'VALIDATION_FAILED' } }),
  })
  const meta = { type: 'query' as const, metatype: PartnerStatsQueryDto }

  // 2a. 只带 period 必须通过
  let ok = false
  try {
    await pipe.transform({ period: 'week' }, meta)
    ok = true
  } catch {
    ok = false
  }
  assert('2a. ?period=week 通过校验', ok)

  // 2b. 带 timezone 必须 400 —— 这就是 adapter 不能发它的原因
  let rejectedCode: string | undefined
  try {
    await pipe.transform({ period: 'week', timezone: 'Asia/Shanghai' }, meta)
  } catch (error) {
    const res = (error as BadRequestException).getResponse() as { error?: { code?: string } }
    rejectedCode = res?.error?.code
  }
  assert(
    '2b. ?period=week&timezone=... 被拒成 VALIDATION_FAILED',
    rejectedCode === 'VALIDATION_FAILED',
    `实际 code=${rejectedCode ?? '(未抛错)'}`,
  )

  // 2c. 非法 period 必须 400
  let badPeriodRejected = false
  try {
    await pipe.transform({ period: 'decade' }, meta)
  } catch {
    badPeriodRejected = true
  }
  assert('2c. 非法 period 被拒', badPeriodRejected)
}

// ── 3. 运行时：跨租户 / 归因 / 空态 / 无个人明细 ───────────────────────────

async function main(): Promise<void> {
  console.log('\n=== GET /partner/stats 契约验证 ===\n')

  assertVerifyDatabaseSafe()
  assertSourceContract()
  await assertQueryValidation()

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const stats = new PartnerStatsService(prisma)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
  const orgA = `org_psc_a_${suffix}`
  const orgB = `org_psc_b_${suffix}`
  const orgEmpty = `org_psc_e_${suffix}`
  const srcA = `src_psc_a_${suffix}`
  const srcB = `src_psc_b_${suffix}`
  const ext = (v: string) => `PSC-${suffix}-${v}`

  async function cleanup(): Promise<void> {
    const ids = [orgA, orgB, orgEmpty]
    await prisma.syncLog.deleteMany({ where: { orgId: { in: ids } } })
    await prisma.job.deleteMany({ where: { sourceOrgId: { in: ids } } })
    await prisma.jobFair.deleteMany({ where: { sourceOrgId: { in: ids } } })
    await prisma.companyProfile.deleteMany({ where: { sourceOrgId: { in: ids } } })
    await prisma.policyPost.deleteMany({ where: { sourceOrgId: { in: ids } } })
    await prisma.jobSource.deleteMany({ where: { orgId: { in: ids } } })
    await prisma.organization.deleteMany({ where: { id: { in: ids } } })
  }

  try {
    await cleanup()

    await prisma.organization.createMany({
      data: [orgA, orgB, orgEmpty].map((id, i) => ({
        id,
        name: `统计契约验证机构${['A', 'B', 'E'][i]}`,
        type: 'school_employment_center',
        sceneTemplate: 'school',
        enabled: true,
      })),
    })
    await prisma.jobSource.createMany({
      data: [
        { id: srcA, orgId: orgA, name: 'A源', sourceKind: 'manual', accessMode: 'manual', enabled: true },
        { id: srcB, orgId: orgB, name: 'B源', sourceKind: 'manual', accessMode: 'manual', enabled: true },
      ],
    })

    // A：2 已发布岗位 + 1 待审岗位；1 已发布招聘会；1 已发布企业；1 待审政策
    await prisma.job.createMany({
      data: [
        { sourceOrgId: orgA, sourceId: srcA, externalId: ext('a-j1'), sourceName: 'A源', sourceUrl: 'https://example.com/a1', title: 'A岗位1', company: 'A公司', city: '青岛', reviewStatus: 'approved', publishStatus: 'published' },
        { sourceOrgId: orgA, sourceId: srcA, externalId: ext('a-j2'), sourceName: 'A源', sourceUrl: 'https://example.com/a2', title: 'A岗位2', company: 'A公司', city: '青岛', reviewStatus: 'approved', publishStatus: 'published' },
        { sourceOrgId: orgA, sourceId: srcA, externalId: ext('a-j3'), sourceName: 'A源', sourceUrl: 'https://example.com/a3', title: 'A待审岗位', company: 'A公司', city: '青岛', reviewStatus: 'pending', publishStatus: 'draft' },
        // B 的内容必须完全不进 A 的统计
        { sourceOrgId: orgB, sourceId: srcB, externalId: ext('b-j1'), sourceName: 'B源', sourceUrl: 'https://example.com/b1', title: 'B岗位', company: 'B公司', city: '青岛', reviewStatus: 'approved', publishStatus: 'published' },
        { sourceOrgId: orgB, sourceId: srcB, externalId: ext('b-j2'), sourceName: 'B源', sourceUrl: 'https://example.com/b2', title: 'B岗位2', company: 'B公司', city: '青岛', reviewStatus: 'approved', publishStatus: 'published' },
      ],
    })
    await prisma.jobFair.createMany({
      data: [
        { sourceOrgId: orgA, sourceId: srcA, externalId: ext('a-f1'), sourceName: 'A源', sourceUrl: 'https://example.com/af1', title: 'A招聘会', startAt: new Date('2026-08-01T01:00:00Z'), endAt: new Date('2026-08-01T09:00:00Z'), venue: 'A会场', city: '青岛', reviewStatus: 'approved', publishStatus: 'published' },
        { sourceOrgId: orgB, sourceId: srcB, externalId: ext('b-f1'), sourceName: 'B源', sourceUrl: 'https://example.com/bf1', title: 'B招聘会', startAt: new Date('2026-08-02T01:00:00Z'), endAt: new Date('2026-08-02T09:00:00Z'), venue: 'B会场', city: '青岛', reviewStatus: 'approved', publishStatus: 'published' },
      ],
    })
    await prisma.companyProfile.createMany({
      data: [
        { sourceOrgId: orgA, externalId: ext('a-c1'), sourceName: 'A源', name: 'A企业', reviewStatus: 'approved', publishStatus: 'published' },
        { sourceOrgId: orgB, externalId: ext('b-c1'), sourceName: 'B源', name: 'B企业', reviewStatus: 'approved', publishStatus: 'published' },
      ],
    })
    await prisma.policyPost.createMany({
      data: [
        { sourceOrgId: orgA, sourceName: 'A源', kind: 'notice', title: 'A待审政策', reviewStatus: 'pending', publishStatus: 'draft' },
        { sourceOrgId: orgB, sourceName: 'B源', kind: 'notice', title: 'B已发布政策', reviewStatus: 'approved', publishStatus: 'published' },
      ],
    })

    // 同步日志：A 当期 3 条（2 成功 1 失败），B 当期 5 条（全成功）
    const now = new Date()
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000)
    await prisma.syncLog.createMany({
      data: [
        { sourceId: srcA, orgId: orgA, dataType: 'job', syncMode: 'manual', result: 'success', addedCount: 4, updatedCount: 1, errorCount: 0, createdAt: hoursAgo(2) },
        { sourceId: srcA, orgId: orgA, dataType: 'job', syncMode: 'manual', result: 'success', addedCount: 3, updatedCount: 2, errorCount: 0, createdAt: hoursAgo(3) },
        { sourceId: srcA, orgId: orgA, dataType: 'job', syncMode: 'manual', result: 'failed',  addedCount: 0, updatedCount: 0, errorCount: 2, createdAt: hoursAgo(4) },
        ...Array.from({ length: 5 }, (_, i) => ({
          sourceId: srcB, orgId: orgB, dataType: 'job', syncMode: 'manual',
          result: 'success', addedCount: 99, updatedCount: 99, errorCount: 0, createdAt: hoursAgo(2 + i),
        })),
      ],
    })

    const a = await stats.getStats(orgA, 'week')
    const e = await stats.getStats(orgEmpty, 'week')

    // 3a. 跨租户隔离 —— A 只看到自己的
    assert(
      '3a. 跨租户：A 的在架岗位只数自己的（2，不含 B 的 2）',
      a.snapshot.publishedJobs === 2,
      `实际 ${a.snapshot.publishedJobs}`,
    )
    assert(
      '3b. 跨租户：A 的同步批次只数自己的（3，不含 B 的 5）',
      a.sync.totalBatches.current === 3,
      `实际 ${a.sync.totalBatches.current}`,
    )
    assert(
      '3c. 跨租户：A 的新增数不含 B 的 99×5',
      a.sync.totalAdded.current === 7,
      `实际 ${a.sync.totalAdded.current}`,
    )
    assert(
      '3d. 跨租户：A 的在架企业/招聘会各只数自己的 1 条',
      a.snapshot.publishedCompanies === 1 && a.snapshot.publishedFairs === 1,
      `companies=${a.snapshot.publishedCompanies} fairs=${a.snapshot.publishedFairs}`,
    )
    assert(
      '3e. 跨租户：A 未发布的政策不计入在架数',
      a.snapshot.publishedPolicies === 0,
      `实际 ${a.snapshot.publishedPolicies}`,
    )
    assert(
      '3f. 待审核数为本机构真实计数（A：岗位1 + 政策1 = 2）',
      a.snapshot.pendingReview === 2,
      `实际 ${a.snapshot.pendingReview}`,
    )

    // 3g. 时区由服务端声明
    assert(
      '3g. 响应声明服务端统计时区 Asia/Shanghai',
      a.timezone === STATS_TIMEZONE && a.timezone === 'Asia/Shanghai',
      `实际 ${a.timezone}`,
    )

    // 3h. 归因恒不可用，不伪造漏斗
    assert(
      '3h. 归因恒为 available:false（缺不可变 sourceOrgId 快照）',
      a.attribution.available === false && a.attribution.reason.length > 0,
    )
    assert(
      `3i. 归因声明最小样本阈值 N≥${MIN_AGGREGATE_SAMPLE}`,
      a.attribution.minSampleThreshold === MIN_AGGREGATE_SAMPLE &&
        MIN_AGGREGATE_SAMPLE >= 5,
      `实际 ${a.attribution.minSampleThreshold}`,
    )
    // 响应里不得出现任何漏斗/曝光/跳转字段——没有就是没有，不给估算值
    const keys = collectKeys(a)
    const fabricated = ['funnel', 'impressions', 'exposure', 'views', 'jumps', 'clicks', 'prints', 'conversionRate']
    assert(
      '3j. 响应不含任何曝光/跳转/漏斗估算字段',
      !fabricated.some((k) => keys.has(k)),
      `命中 ${fabricated.filter((k) => keys.has(k)).join(', ')}`,
    )

    // 3k. 无个人明细
    const personal = ['endUserId', 'userId', 'phone', 'idCard', 'email', 'resumeId', 'candidate', 'applicant', 'realName']
    assert(
      '3k. 响应不含任何求职者身份字段（只给机构级聚合）',
      !personal.some((k) => keys.has(k)),
      `命中 ${personal.filter((k) => keys.has(k)).join(', ')}`,
    )

    // 3l. 空态不伪造：无数据机构必须是真 0 + null 基期，不能编造
    assert(
      '3l. 空态：无同步记录的机构 totalBatches=0',
      e.sync.totalBatches.current === 0,
      `实际 ${e.sync.totalBatches.current}`,
    )
    assert(
      '3m. 空态：无可比基期时 previous=null 且 deltaPercent=null（不显示 0% 或 ∞%）',
      e.sync.totalBatches.previous === null &&
        e.sync.totalBatches.deltaPercent === null &&
        e.sync.successRate.deltaPercent === null,
    )
    assert(
      '3n. 空态：在架内容与待审核数均为真实 0，不填充演示值',
      e.snapshot.publishedJobs === 0 &&
        e.snapshot.publishedFairs === 0 &&
        e.snapshot.pendingReview === 0,
    )
    assert(
      '3o. 空态：趋势桶仍补满 7 天且全为 0（不是空数组，也不是造出来的波形）',
      e.trend.length === 7 && e.trend.every((b) => b.added === 0 && b.updated === 0 && b.failed === 0),
      `长度 ${e.trend.length}`,
    )
    assert(
      '3p. 数据模式标记为 live（真实库数据）',
      a.dataMode === 'live',
    )
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }

  console.log(`\n${'─'.repeat(52)}`)
  console.log(`PASS: ${passed}  FAIL: ${failed}  TOTAL: ${passed + failed}`)
  if (failed > 0) {
    console.error('\n❌ verify:partner-stats-contract FAILED')
    process.exit(1)
  }
  console.log('\n✅ verify:partner-stats-contract PASSED')
}

main().catch((error) => {
  console.error('\n❌ verify:partner-stats-contract 执行异常')
  console.error(error)
  process.exit(1)
})
