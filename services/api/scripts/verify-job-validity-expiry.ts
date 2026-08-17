/**
 * 岗位有效期门禁 —— 过期岗位不得出现在求职者可见的任何读取路径。
 *
 * 法规依据：《关于规范网络平台招聘类信息发布的通知》（人社部、中央网信办、
 * 工信部、公安部、金融监管总局，2026-01）——「发布的招聘信息应当……标注信息
 * 有效期限或者及时更新」。
 *
 * 事故背景（本门禁存在的原因）：PublishStatus 枚举里有 'expired'，但全仓没有
 * 任何代码把 Job.publishStatus 写成 'expired'，也没有到期扫描任务；而公开列表
 * 只筛 reviewStatus+publishStatus。于是过期岗位一直以 'published' 挂在
 * GET /api/v1/jobs 上（含小程序 https://zyidai.cn/api/v1/jobs，未鉴权公开）。
 *
 * 断言（1–4 为**行为断言**，跑真实 Prisma 查询；5–8 为谓词与静态契约）：
 *   1.  过期岗位不出现在公开列表 /jobs，且 total 与 data 同口径
 *   1b. 未过期岗位仍然出现（反向断言：门禁不是靠"全筛空"过关的）
 *   2.  过期岗位详情 /jobs/:id 返回 null（列表筛掉但详情能开 = 旧链接照样能投）
 *   3.  validThrough 为 null 的岗位**不**被判过期（缺有效期 ≠ 失效，误杀会清空列表）
 *   4.  边界：validThrough 恰为 now 仍然可见（strict `<`，与 isJobExpired 一致）
 *   5.  isJobExpired / jobValidityWhere / jobExpiredWhere 三处谓词严格同构（不得漂移）
 *   6.  管理端 DTO 能看见过期岗位，且 publishStatus 保持 'published'
 *       —— 派生成 'expired' 会让 Admin 表的「下架」按钮消失
 *   7.  静态：所有求职者可见的 Job 读取点都带了有效期条件
 *   8.  静态：派生不落库（源码里不得出现把 Job.publishStatus 写成 'expired' 的语句）
 *
 * 运行：pnpm --filter @ai-job-print/api verify:job-validity-expiry
 * DATABASE_URL 未设置时自建一次性 SQLite 库并在结束时删除。
 */
import { execFileSync } from 'child_process'
import { randomUUID } from 'crypto'
import { closeSync, openSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { PrismaService } from '../src/prisma/prisma.service'
import { JobsKioskService } from '../src/jobs/jobs-kiosk.service'
import { isJobExpired, jobValidityWhere, jobExpiredWhere, isJobExpiredForAdmin } from '../src/jobs/job-validity'
import { prismaJobToAdminDto } from '../src/jobs/jobs-shared'

const apiRoot = path.resolve(__dirname, '..')
const fallbackDbName = process.env['DATABASE_URL'] ? null : `verify-job-validity-expiry-${randomUUID().slice(0, 8)}.db`
const fallbackDbPath = fallbackDbName ? path.join(apiRoot, 'prisma', fallbackDbName) : null
if (fallbackDbName) {
  process.env['DATABASE_URL'] = `file:./prisma/${fallbackDbName}`
  prepareFallbackDb()
}

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exit(1) }

const ORG_ID = `vjve-org-${randomUUID().slice(0, 8)}`
const PREFIX = `vjve-${randomUUID().slice(0, 8)}`
const id = (suffix: string) => `${PREFIX}-${suffix}`

const DAY = 24 * 60 * 60 * 1000

const prisma = new PrismaService()

async function main(): Promise<void> {
  console.log('\n=== verify:job-validity-expiry ===')
  await prisma.onModuleInit()

  try {
    await seed()
    const kiosk = new JobsKioskService(prisma)

    // ── 1. 公开列表筛掉过期岗位；total 与 data 同口径 ──────────────────────
    // total 必须一起收窄:内存过滤会造出「第 1 页只有 1 条但 total 说 2 条」。
    const list = await kiosk.getPublishedJobs({ sourceOrgId: ORG_ID, pageSize: 100 })
    const ids = list.data.map((j) => j.id)
    if (ids.includes(id('expired'))) {
      fail(`1. 过期岗位出现在公开列表 /jobs：validThrough=昨天 却被返回，ids=${JSON.stringify(ids)}`)
    }
    if (list.pagination.total !== ids.length) {
      fail(`1. total 与 data 不同口径：total=${list.pagination.total} data=${ids.length}（有效期条件没下推到 SQL？）`)
    }
    pass('1. 过期岗位不出现在公开列表 /jobs，且 total 与 data 同口径')

    // ── 1b. 反向断言:未过期岗位仍然可见 ─────────────────────────────────
    // 没有这条,把 where 写成恒 false 也能让 1 通过。
    if (!ids.includes(id('current')) || !ids.includes(id('nulldate'))) {
      fail(`1b. 未过期岗位被误杀：ids=${JSON.stringify(ids)}（期望含 current 与 nulldate）`)
    }
    pass('1b. 反向断言：未过期岗位与无有效期岗位仍然可见（门禁不是靠全筛空过关）')

    // ── 1c. 带关键词搜索时仍然筛掉 ──────────────────────────────────────
    // keyword 会在 where 顶层写一个 OR;有效期条件若也写顶层 OR 会被覆盖掉。
    const kwList = await kiosk.getPublishedJobs({ sourceOrgId: ORG_ID, keyword: '测试岗位', pageSize: 100 })
    if (kwList.data.some((j) => j.id === id('expired'))) {
      fail('1c. 带 keyword 搜索时过期岗位重新漏出 —— 有效期条件被 keyword 的 OR 覆盖了')
    }
    pass('1c. 带 keyword 搜索时过期岗位仍被筛掉（有效期条件在 AND 里，未被 OR 覆盖）')

    // ── 2. 详情端点同口径 ───────────────────────────────────────────────
    const detailExpired = await kiosk.getPublishedJobById(id('expired'))
    if (detailExpired.data !== null) {
      fail('2. 过期岗位详情 /jobs/:id 仍可打开 —— 收藏夹/浏览记录/二维码里的旧链接照样能投')
    }
    const detailCurrent = await kiosk.getPublishedJobById(id('current'))
    if (detailCurrent.data === null) {
      fail('2. 未过期岗位详情被误杀')
    }
    pass('2. 过期岗位详情返回 null，未过期岗位详情正常')

    // ── 3. validThrough 为 null 不判过期 ────────────────────────────────
    if (isJobExpired(null) || isJobExpired(undefined)) {
      fail('3. validThrough 为空被判过期 —— 会把大批仍在招、只是来源没给有效期的岗位清空')
    }
    pass('3. validThrough 为空不判过期（缺有效期是数据质量问题，不等于失效）')

    // ── 4. 边界:validThrough 恰为 now 仍然有效 ──────────────────────────
    const now = new Date('2026-08-18T00:00:00.000Z')
    if (isJobExpired(new Date(now.getTime()), now)) {
      fail('4. validThrough === now 被判过期 —— 谓词写成了 <=，与 deriveBenefitStatus 的 strict < 不一致')
    }
    if (!isJobExpired(new Date(now.getTime() - 1), now)) {
      fail('4. validThrough = now-1ms 未被判过期')
    }
    pass('4. 边界一致：validThrough === now 仍有效，now-1ms 判过期（strict <）')

    // ── 5. 两处谓词严格互补 ─────────────────────────────────────────────
    // isJobExpired 是内存判定,jobValidityWhere 是 SQL 判定;
    // 两者对同一 (validThrough, now) 必须恒为相反结论,否则「列表筛掉的」
    // 和「管理端标成过期的」会对不上。
    const probeNow = new Date('2026-08-18T12:00:00.000Z')
    const where = jobValidityWhere(probeNow) as { OR: Array<Record<string, unknown>> }
    const nullBranch = where.OR.find((b) => 'validThrough' in b && b['validThrough'] === null)
    const gteBranch = where.OR.find((b) => {
      const v = b['validThrough'] as { gte?: Date } | null
      return v !== null && typeof v === 'object' && v.gte instanceof Date
    })
    if (!nullBranch || !gteBranch) {
      fail(`5. jobValidityWhere 结构变了：${JSON.stringify(where)}（期望 OR:[{validThrough:null},{validThrough:{gte}}]）`)
    }
    if ((gteBranch['validThrough'] as { gte: Date }).gte.getTime() !== probeNow.getTime()) {
      fail('5. jobValidityWhere 的 gte 不等于传入的 now —— SQL 侧与内存侧用了不同时刻')
    }
    // gte 是 isJobExpired 的 strict < 的严格补集
    for (const offset of [-DAY, -1, 0, 1, DAY]) {
      const vt = new Date(probeNow.getTime() + offset)
      const memoryExpired = isJobExpired(vt, probeNow)
      const sqlVisible = vt.getTime() >= probeNow.getTime()   // gte 语义
      if (memoryExpired === sqlVisible) {
        fail(`5. 谓词漂移：validThrough=now${offset >= 0 ? '+' : ''}${offset}ms 时 isJobExpired=${memoryExpired} 而 SQL 可见=${sqlVisible}`)
      }
    }
    pass('5. isJobExpired 与 jobValidityWhere 谓词严格互补（-1d/-1ms/0/+1ms/+1d 全部相反）')

    // ── 5b. 第三处写法 jobExpiredWhere 同样不得漂移 ──────────────────────
    // 批量发布要如实统计「排除了多少条过期岗位」，只有可下推的反向条件才能 count()。
    // 它不能由 jobValidityWhere 取反得到（Prisma 的 NOT 会把 validThrough IS NULL
    // 的行一并丢掉），所以是独立的第三处写法，必须单独锁。
    const expiredWhere = jobExpiredWhere(probeNow) as { validThrough: { lt?: Date } }
    if (!(expiredWhere.validThrough?.lt instanceof Date)) {
      fail(`5b. jobExpiredWhere 结构变了：${JSON.stringify(expiredWhere)}（期望 {validThrough:{lt}}）`)
    }
    if (expiredWhere.validThrough.lt.getTime() !== probeNow.getTime()) {
      fail('5b. jobExpiredWhere 的 lt 不等于传入的 now —— 与 jobValidityWhere 用了不同时刻')
    }
    for (const offset of [-DAY, -1, 0, 1, DAY]) {
      const vt = new Date(probeNow.getTime() + offset)
      const memoryExpired = isJobExpired(vt, probeNow)
      const sqlExpired = vt.getTime() < probeNow.getTime()   // lt 语义
      if (memoryExpired !== sqlExpired) {
        fail(`5b. 谓词漂移：validThrough=now${offset >= 0 ? '+' : ''}${offset}ms 时 isJobExpired=${memoryExpired} 而 SQL 过期=${sqlExpired}`)
      }
    }
    // NULL 语义：validThrough 为空不得被 jobExpiredWhere 命中（SQL 里 NULL < now 是 UNKNOWN）。
    if (isJobExpired(null, probeNow)) {
      fail('5b. isJobExpired(null) 判成过期 —— 缺有效期不等于失效')
    }
    pass('5b. jobExpiredWhere 与 isJobExpired 同构（含 NULL 语义），三处写法未漂移')

    // ── 6. 管理端看得见,且 publishStatus 保持库里真值 ────────────────────
    const expiredRow = await prisma.job.findUnique({ where: { id: id('expired') } })
    if (!expiredRow) fail('6. 取不到过期岗位行')
    const adminDto = prismaJobToAdminDto(expiredRow)
    if (adminDto.expired !== true) {
      fail('6. 管理端 DTO 未把过期岗位标成 expired —— 运营无从发现')
    }
    if (adminDto.publishStatus !== 'published') {
      fail(
        `6. 管理端 publishStatus 被派生成 '${adminDto.publishStatus}' —— ` +
        'Admin 岗位表的「下架」按钮按 publishStatus === "published" 显示，' +
        '改掉它会让运营失去处置过期岗位的唯一动作（见 job-validity.ts 顶部说明）',
      )
    }
    if (adminDto.validThrough === null) {
      fail('6. 管理端 DTO 未透出 validThrough —— 运营看不到过期到什么程度')
    }
    // 反向:未过期岗位不得被标记
    const currentRow = await prisma.job.findUnique({ where: { id: id('current') } })
    if (currentRow && prismaJobToAdminDto(currentRow).expired !== false) {
      fail('6. 未过期岗位被管理端误标为 expired')
    }
    // 未发布的岗位不该被标过期(它本来就不在放出的范围里)
    if (isJobExpiredForAdmin('draft', new Date(Date.now() - DAY)) !== false) {
      fail('6. draft 岗位被标成 expired —— 只应收敛 published')
    }
    pass('6. 管理端能看见过期岗位（expired=true + validThrough），publishStatus 保持 published，「下架」按钮不受影响')

    // ── 7. 静态:求职者可见的 Job 读取点都带了有效期条件 ──────────────────
    verifyReadPathCoverage()

    // ── 8. 静态:派生不落库 ──────────────────────────────────────────────
    verifyNoPersistedExpiry()
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
    cleanupFallbackDb()
  }

  console.log('\nALL PASS')
}

/**
 * 求职者可见的 Job 读取点清单。
 *
 * 每一处都必须能证明自己带了有效期条件 —— 要么直接调 jobValidityWhere()，
 * 要么走 buildPublishedJobWhere（它内部调）。清单是硬编码的：新增一个公开
 * 岗位读取路径而不加有效期条件时，这里不会自动发现，所以**扩公开读取面的人
 * 必须同时往这张表里加一行**。这条注释就是留给那个人的。
 */
const JOBSEEKER_READ_PATHS: Array<{ file: string; needle: string; why: string }> = [
  {
    file: 'src/jobs/jobs-shared.ts',
    needle: 'jobValidityWhere(now)',
    why: 'buildPublishedJobWhere → GET /jobs 与 GET /jobs/requirement-stats',
  },
  {
    file: 'src/jobs/jobs-kiosk.service.ts',
    needle: 'jobValidityWhere()',
    why: 'getPublishedJobById → GET /jobs/:id',
  },
  {
    file: 'src/companies/companies.service.ts',
    needle: 'jobValidityWhere()',
    why: '找企业页「在招岗位 / openJobCount」',
  },
  {
    file: 'src/job-ai/job-ai.service.ts',
    needle: 'jobValidityWhere()',
    why: 'AI 岗位推荐候选池',
  },
]

function verifyReadPathCoverage(): void {
  for (const p of JOBSEEKER_READ_PATHS) {
    const src = readFileSync(path.join(apiRoot, p.file), 'utf8')
    if (!src.includes(p.needle)) {
      fail(`7. ${p.file} 不再包含 ${p.needle} —— ${p.why} 会重新放出过期岗位`)
    }
  }
  pass(`7. ${JOBSEEKER_READ_PATHS.length} 处求职者可见 Job 读取路径全部带有效期条件`)
}

/**
 * 派生不落库：不得有代码把 Job.publishStatus 写成 'expired'。
 *
 * 一旦有人"顺手"加一个到期扫描任务把它落库，就会出现两份判据（库里的 + 读取
 * 时算的），一份必然滞后；且生产存量数据的下架是需要产品负责人具名授权的运营
 * 动作，不能由一个后台任务代劳。
 */
function verifyNoPersistedExpiry(): void {
  const files = [
    'src/jobs/jobs-admin.service.ts',
    'src/jobs/jobs-partner.service.ts',
    'src/jobs/jobs-excel.service.ts',
    'src/job-sync/job-sync.service.ts',
    'src/jobs/job-validity.ts',
  ]
  for (const f of files) {
    const src = readFileSync(path.join(apiRoot, f), 'utf8')
    const hit = /publishStatus\s*:\s*'expired'/.exec(src)
    if (hit) {
      fail(`8. ${f} 出现 publishStatus: 'expired' 落库写入 —— 有效期只允许读取时派生，不得写库`)
    }
  }
  pass('8. 无任何代码把 Job.publishStatus 落库成 expired（派生不落库）')
}

async function seed(): Promise<void> {
  await cleanup()
  await prisma.organization.create({
    data: { id: ORG_ID, name: '有效期门禁测试机构', type: 'job_platform', enabled: true },
  })
  const base = {
    sourceOrgId: ORG_ID,
    sourceName: '门禁测试来源',
    sourceUrl: 'https://example.com/job',
    company: '测试公司',
    city: '青岛',
    reviewStatus: 'approved',
    publishStatus: 'published',
  }
  const now = Date.now()
  await prisma.job.createMany({
    data: [
      // 已过期 28 天 —— 复刻生产上「运营中台-资深海外发行运营」那条的形状
      { ...base, id: id('expired'), externalId: id('expired'), title: '测试岗位-已过期', validThrough: new Date(now - 28 * DAY) },
      // 仍在有效期内
      { ...base, id: id('current'), externalId: id('current'), title: '测试岗位-有效', validThrough: new Date(now + 30 * DAY) },
      // 来源未提供有效期
      { ...base, id: id('nulldate'), externalId: id('nulldate'), title: '测试岗位-无有效期', validThrough: null },
    ],
  })
}

async function cleanup(): Promise<void> {
  await prisma.job.deleteMany({ where: { sourceOrgId: ORG_ID } })
  await prisma.organization.deleteMany({ where: { id: ORG_ID } })
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  cleanupFallbackDb()
  process.exit(1)
})

function cleanupFallbackDb(): void {
  if (!fallbackDbPath) return
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`${fallbackDbPath}${suffix}`, { force: true })
  }
}

function prepareFallbackDb(): void {
  if (!fallbackDbPath) return
  try {
    closeSync(openSync(fallbackDbPath, 'a'))
    execFileSync('pnpm', ['exec', 'prisma', 'db', 'push'], { cwd: apiRoot, stdio: 'pipe' })
  } catch (error) {
    const details = (error as { stdout?: Buffer; stderr?: Buffer })
    console.error(details.stdout?.toString() ?? '')
    console.error(details.stderr?.toString() ?? '')
    cleanupFallbackDb()
    throw error
  }
}
