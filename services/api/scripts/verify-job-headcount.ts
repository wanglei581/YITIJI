/**
 * 招聘人数（headcount）端到端门禁。
 *
 * 法规依据：《关于规范网络平台招聘类信息发布的通知》（人社部、中央网信办、
 * 工信部、公安部、国家金融监督管理总局，2026-01）——「发布的招聘信息应当包括
 * 用人单位基本情况、**招聘人数**、招聘条件、工作内容、工作地点、基本劳动报酬」。
 *
 * 事故背景（本门禁存在的原因）：加这一列**之前**，headcount 是一个「两端都接了、
 * 中间断掉」的幽灵字段 ——
 *   - 入口：WebhookJobItemDto（@IsInt @Min(0)）与 ImportJobItemDto（@IsNumber @Min(1)）
 *     **已经接收并校验**它，然后在 upsert 时被丢弃，合作机构报送的数据静默消失；
 *   - 出口：ExternalJobDTO.headcount 与 JobListItemDto.headcount **已在读取契约里声明**，
 *     而 prismaJobToListItem 硬编码 `headcount: undefined`。
 * 这道门禁把中间那段钉死，防止再退回「接收 → 丢弃」。
 *
 * 断言（1–3 行为断言，跑真实 Prisma；4–7 静态契约）：
 *   1. 写入 headcount 后能从公开读取 DTO 取回同一个数（入口→出口贯通）
 *   2. 来源未提供时 headcount 为 undefined，**不是 0、不是 1** —— 不得伪造
 *   3. headcount=0 与「未提供」可区分（0 是来源明确给的 0，不能被当成缺失）
 *   4. 两份 Prisma schema 都有该列；两份迁移都存在（只改一边 → postgres-readiness 红）
 *   5. Excel 三份字段清单同步（白名单 / 模板 / Partner 前端），这三份历史上会漂移
 *   6. 四条导入链路都写这个字段：Excel confirm、Partner import、Webhook、API 拉取
 *   7. Kiosk 详情页缺值时显示「来源平台未提供」，不填任何数字（CLAUDE.md §9）
 *
 * 运行：pnpm --filter @ai-job-print/api verify:job-headcount
 */
import { execFileSync } from 'child_process'
import { randomUUID } from 'crypto'
import { closeSync, existsSync, openSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { PrismaService } from '../src/prisma/prisma.service'
import { JobsKioskService } from '../src/jobs/jobs-kiosk.service'
import { JOB_STANDARD_FIELDS } from '../src/jobs/dto/excel-import.dto'

const apiRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(apiRoot, '../..')
const fallbackDbName = process.env['DATABASE_URL'] ? null : `verify-job-headcount-${randomUUID().slice(0, 8)}.db`
const fallbackDbPath = fallbackDbName ? path.join(apiRoot, 'prisma', fallbackDbName) : null
if (fallbackDbName) {
  process.env['DATABASE_URL'] = `file:./prisma/${fallbackDbName}`
  prepareFallbackDb()
}

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exit(1) }

const ORG_ID = `vjh-org-${randomUUID().slice(0, 8)}`
const PREFIX = `vjh-${randomUUID().slice(0, 8)}`
const id = (s: string) => `${PREFIX}-${s}`

const prisma = new PrismaService()

async function main(): Promise<void> {
  console.log('\n=== verify:job-headcount ===')
  await prisma.onModuleInit()

  try {
    await seed()
    const kiosk = new JobsKioskService(prisma)
    const list = await kiosk.getPublishedJobs({ sourceOrgId: ORG_ID, pageSize: 100 })
    const byId = new Map(list.data.map((j) => [j.id, j]))

    // ── 1. 入口→出口贯通 ────────────────────────────────────────────────
    const withCount = byId.get(id('has'))
    if (!withCount) fail('1. 取不到测试岗位')
    if (withCount.headcount !== 12) {
      fail(`1. headcount 未贯通到读取 DTO：期望 12，实际 ${JSON.stringify(withCount.headcount)}（入口收下了但出口丢了？）`)
    }
    pass('1. headcount 写入后能从公开读取 DTO 取回同一个数（入口→出口贯通）')

    // ── 2. 缺值不得被伪造 ───────────────────────────────────────────────
    const noCount = byId.get(id('null'))
    if (!noCount) fail('2. 取不到无人数岗位')
    if (noCount.headcount !== undefined) {
      fail(`2. 来源未提供人数却返回了 ${JSON.stringify(noCount.headcount)} —— 不得补 0 / 1 / 估算值（CLAUDE.md §9）`)
    }
    pass('2. 来源未提供时 headcount 为 undefined，未伪造默认值')

    // ── 3. 明确的 0 与「未提供」可区分 ──────────────────────────────────
    // 若实现里写成 `j.headcount || undefined`,来源明确给的 0 会被吞成"未提供"。
    const zero = byId.get(id('zero'))
    if (!zero) fail('3. 取不到 headcount=0 的岗位')
    if (zero.headcount !== 0) {
      fail(`3. 来源明确给的 headcount=0 被吞成 ${JSON.stringify(zero.headcount)} —— 实现用了 || 而不是 ?? `)
    }
    pass('3. headcount=0（来源明确值）与「未提供」可区分')

    // ── 4. 两份 schema + 两份迁移 ───────────────────────────────────────
    for (const [label, rel] of [
      ['SQLite', 'prisma/schema.prisma'],
      ['PostgreSQL', 'prisma/postgres/schema.prisma'],
    ] as const) {
      const schema = readFileSync(path.join(apiRoot, rel), 'utf8')
      const jobBlock = /^model Job \{[\s\S]*?^\}/m.exec(schema)?.[0] ?? ''
      if (!/headcount\s+Int\?/.test(jobBlock)) {
        fail(`4. ${label} schema 的 model Job 缺 headcount —— 只改一边会让 postgres-readiness 红`)
      }
    }
    const MIG = '20260818090000_add_job_headcount'
    for (const [label, dir] of [
      ['SQLite', 'prisma/migrations'],
      ['PostgreSQL', 'prisma/postgres/migrations'],
    ] as const) {
      const f = path.join(apiRoot, dir, MIG, 'migration.sql')
      if (!existsSync(f)) fail(`4. 缺 ${label} 迁移：${dir}/${MIG}/migration.sql`)
      if (!readFileSync(f, 'utf8').includes('ADD COLUMN "headcount"')) {
        fail(`4. ${label} 迁移内容不含 ADD COLUMN "headcount"`)
      }
    }
    pass('4. 两份 Prisma schema 与两份迁移均含 headcount 列')

    // ── 5. Excel 三份字段清单同步 ───────────────────────────────────────
    // 这三份是各写各的（后端白名单是运行时强校验、模板决定下载的表头、
    // 前端那份是手维护副本）,历史上就是最容易漂的地方。
    if (!(JOB_STANDARD_FIELDS as readonly string[]).includes('headcount')) {
      fail('5. JOB_STANDARD_FIELDS 缺 headcount —— Excel 映射到该列会被 ILLEGAL_FIELD_MAPPING 拒掉')
    }
    const tpl = readFileSync(path.join(apiRoot, 'src/jobs/excel-template.ts'), 'utf8')
    if (!tpl.includes("key: 'headcount'")) {
      fail('5. JOB_TEMPLATE_FIELDS 缺 headcount —— 下载的模板里没有这一列，机构无从填写')
    }
    const modal = readFileSync(path.join(repoRoot, 'apps/partner/src/routes/sources/ExcelImportModal.tsx'), 'utf8')
    if (!modal.includes("key: 'headcount'")) {
      fail('5. Partner ExcelImportModal 的 JOB_FIELDS 缺 headcount —— 机构在映射界面选不到这个字段')
    }
    pass('5. Excel 三份字段清单（后端白名单 / 模板 / Partner 前端）均含 headcount')

    // ── 6. 四条导入链路都写这个字段 ─────────────────────────────────────
    // 少接一条 = 那条链路上的机构报送继续被静默丢弃,而且从接口返回上看不出来。
    const paths: Array<{ file: string; needle: string; channel: string }> = [
      { file: 'src/jobs/jobs-excel.service.ts', needle: 'headcount: parseMappedNumber(mapped.headcount)', channel: 'Excel 确认导入' },
      { file: 'src/jobs/jobs-partner.service.ts', needle: 'headcount: item.headcount ?? undefined', channel: 'Partner 导入 / Webhook' },
      { file: 'src/job-sync/job-sync.service.ts', needle: 'headcount: item.headcount', channel: 'API 拉取 worker' },
    ]
    for (const p of paths) {
      const src = readFileSync(path.join(apiRoot, p.file), 'utf8')
      if (!src.includes(p.needle)) {
        fail(`6. ${p.channel}（${p.file}）未写入 headcount —— 该链路上机构报送的招聘人数会被静默丢弃`)
      }
    }
    // job-sync 还要真的从 payload 里取出来,否则写的是永远的 undefined
    const syncSrc = readFileSync(path.join(apiRoot, 'src/job-sync/job-sync.service.ts'), 'utf8')
    if (!syncSrc.includes("resolveKeys('headcount'")) {
      fail('6. job-sync 的 mapJob 未从来源 payload 抽取 headcount —— 写入的恒为 undefined')
    }
    pass('6. Excel / Partner / Webhook / API 拉取 四条导入链路均写入 headcount')

    // ── 7. 前台缺值文案诚实 ─────────────────────────────────────────────
    const kioskUi = readFileSync(
      path.join(repoRoot, 'apps/kiosk/src/pages/jobs/components/JobDetailSections.tsx'),
      'utf8',
    )
    if (!kioskUi.includes('招聘人数')) {
      fail('7. Kiosk 岗位详情页未展示招聘人数 —— 法规要求的字段存了但不给用户看')
    }
    if (!/headcount === 'number'/.test(kioskUi) || !kioskUi.includes('来源平台未提供')) {
      fail('7. Kiosk 招聘人数缺值时未显示「来源平台未提供」—— 不得用 0 / 1 / 估算值占位（CLAUDE.md §9）')
    }
    pass('7. Kiosk 详情页展示招聘人数，缺值显示「来源平台未提供」')
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
    cleanupFallbackDb()
  }

  console.log('\nALL PASS')
}

async function seed(): Promise<void> {
  await cleanup()
  await prisma.organization.create({
    data: { id: ORG_ID, name: '招聘人数门禁测试机构', type: 'job_platform', enabled: true },
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
  await prisma.job.createMany({
    data: [
      { ...base, id: id('has'),  externalId: id('has'),  title: '测试岗位-有人数', headcount: 12 },
      { ...base, id: id('null'), externalId: id('null'), title: '测试岗位-无人数', headcount: null },
      { ...base, id: id('zero'), externalId: id('zero'), title: '测试岗位-零人数', headcount: 0 },
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
