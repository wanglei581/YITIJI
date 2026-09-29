/**
 * verify-demo-company-unpublish.ts —— 一次性维护命令 maintenance:unpublish-demo-companies 的门禁。
 *
 * 被测：scripts/unpublish-demo-companies.ts（下架 name 与 sourceName 都含全角「（演示）」的企业）。
 * 用真 Prisma + 独立临时 SQLite（自建、自删），不碰串行套件共享的库；命令本身用子进程真跑，
 * 连退出码、确认词、事由校验一起测。
 *
 * 断言按规格写：
 *   1. dry-run 不改库：执行前后逐行快照完全一致，审计表无新行。
 *   2. 只动带标记的行：①name 与 sourceName 都带（演示）→ unpublished；
 *      ②只有 name 带 ③只有 sourceName 带 ④真实企业（两家，含一家 approved+published）
 *      ⑤半角 (演示) ⑥含「演示」但没有全角括号 —— 执行后所有字段逐字段不变。
 *   3. 缺确认词 = dry-run（退出码 0、不改库）；确认词错 / 缺事由 / 事由过短：退出码 2、不改库。
 *   4. 每行一条审计，actorId null、actorRole system-cli、payload 只含登记过的键（不含个人信息）。
 *   5. 审计写失败整体回滚（状态改动与审计同一事务），且审计写入用的是事务客户端。
 *   6. 第二次执行：无改动（含 updatedAt）、无新审计。
 *   7. 不删行：企业、机构、岗位条数不变。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:demo-company-unpublish
 */
import 'dotenv/config'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, openSync, rmSync } from 'node:fs'
import path from 'node:path'
import { AuditService } from '../src/audit/audit.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import {
  DEMO_COMPANY_MARK,
  DemoCompanyUnpublishConfigError,
  UNPUBLISH_DEMO_COMPANIES_CONFIRMATION,
  describeDatabaseTarget,
  readDemoCompanyUnpublishConfig,
  runDemoCompanyUnpublish,
  type AuditWriter,
} from './unpublish-demo-companies'

const apiRoot = path.resolve(__dirname, '..')
const dbPath = path.join(apiRoot, 'prisma', `verify-demo-company-unpublish-${randomUUID().slice(0, 8)}.db`)
const databaseUrl = `file:${dbPath}`
// 无条件自建临时库：命令会按判据扫全表，共享库里若有别的门禁留下的演示企业会被一起下架。
process.env['DATABASE_URL'] = databaseUrl
process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'
assertIsolatedVerificationDatabase()

let passed = 0
let failed = 0
function check(condition: boolean, message: string, detail?: unknown): void {
  if (condition) {
    passed += 1
    console.log(`  PASS ${message}`)
  } else {
    failed += 1
    console.error(`  FAIL ${message}${detail === undefined ? '' : ` —— ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`)
  }
}

const ORG_DEMO = 'org-vdcu-demo'
const ORG_REAL = 'org-vdcu-real'
const REASON = '首次发布前清理开发期演示企业（产品负责人授权）'

/** ① 两处都带全角标记：应被下架。 */
const BOTH_PUBLISHED = 'vdcu-both-published'
const BOTH_DRAFT = 'vdcu-both-draft'
/** ① 两处都带、但本来就是 unpublished：不改、不写审计。 */
const BOTH_ALREADY = 'vdcu-both-already'
/** ② 只有 name 带。 */
const NAME_ONLY = 'vdcu-name-only'
/** ③ 只有 sourceName 带。 */
const SOURCE_ONLY = 'vdcu-source-only'
/** ④ 真实企业（阳性对照）。 */
const REAL_PUBLISHED = 'vdcu-real-published'
const REAL_DRAFT = 'vdcu-real-draft'
/** ⑤ 半角括号：判据只认全角字面量。 */
const HALF_WIDTH = 'vdcu-half-width'
/** ⑥ 含「演示」但没有全角括号：宽正则会误伤的行。 */
const BARE_WORD = 'vdcu-bare-word'

const EXPECTED_TARGETS = [BOTH_DRAFT, BOTH_PUBLISHED].sort()
const UNTOUCHED = [BOTH_ALREADY, NAME_ONLY, SOURCE_ONLY, REAL_PUBLISHED, REAL_DRAFT, HALF_WIDTH, BARE_WORD]
const AUDIT_PAYLOAD_KEYS = ['companyName', 'fromPublishStatus', 'marker', 'reason', 'source', 'sourceName', 'toPublishStatus']

interface Snapshot {
  companies: Map<string, Record<string, unknown>>
  companyCount: number
  orgs: string
  jobs: string
  auditCount: number
}

function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (v instanceof Date ? v.toISOString() : v))
}

async function snapshot(prisma: PrismaService): Promise<Snapshot> {
  const companies = await prisma.companyProfile.findMany({ orderBy: { id: 'asc' } })
  return {
    companies: new Map(companies.map((row) => [row.id, JSON.parse(serialize(row)) as Record<string, unknown>])),
    companyCount: companies.length,
    orgs: serialize(await prisma.organization.findMany({ orderBy: { id: 'asc' } })),
    jobs: serialize(await prisma.job.findMany({ orderBy: { id: 'asc' } })),
    auditCount: await prisma.auditLog.count(),
  }
}

function sameCompanies(a: Snapshot, b: Snapshot): boolean {
  if (a.companyCount !== b.companyCount) return false
  for (const [id, row] of a.companies) {
    if (serialize(row) !== serialize(b.companies.get(id))) return false
  }
  return true
}

function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  return sameCompanies(a, b) && a.orgs === b.orgs && a.jobs === b.jobs && a.auditCount === b.auditCount
}

function withoutKeys(row: Record<string, unknown> | undefined, keys: string[]): string {
  const copy = { ...(row ?? {}) }
  for (const key of keys) delete copy[key]
  return serialize(copy)
}

interface CliResult {
  status: number | null
  stdout: string
  stderr: string
}

function runCli(extraEnv: Record<string, string>): CliResult {
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: databaseUrl }
  delete env['UNPUBLISH_DEMO_COMPANIES_CONFIRM']
  delete env['UNPUBLISH_DEMO_COMPANIES_REASON']
  Object.assign(env, extraEnv)
  const result = spawnSync(
    process.execPath,
    ['-r', '@swc-node/register', path.join(apiRoot, 'scripts', 'unpublish-demo-companies.ts')],
    { cwd: apiRoot, env, encoding: 'utf8', timeout: 120_000 },
  )
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

async function seed(prisma: PrismaService): Promise<void> {
  await prisma.organization.create({ data: { id: ORG_DEMO, name: '市人社公共就业平台（演示）', type: 'public_employment_service' } })
  await prisma.organization.create({ data: { id: ORG_REAL, name: '青岛市公共就业和人才服务中心', type: 'public_employment_service' } })
  const demoSource = '市人社公共就业平台（演示）'
  const realSource = '青岛市公共就业和人才服务中心'
  const rows = [
    {
      id: BOTH_PUBLISHED, sourceOrgId: ORG_DEMO, externalId: 'demo-co-1', sourceName: demoSource,
      sourceUrl: 'https://example.com/demo/companies/1', name: '未来智造科技有限公司（演示）',
      legalName: '未来智造科技有限公司', description: '演示数据：专注智能制造装备的研发与服务。',
      industry: 'manufacturing', companyType: 'private', scale: '1200+', province: '山东省', city: '青岛市',
      district: '崂山区', address: '株洲路 78 号（演示地址）', boothNo: 'A-12',
      honorTagsJson: JSON.stringify(['国家高新技术企业（演示）']), tagsJson: JSON.stringify(['智能制造']),
      fairParticipant: true, showBoothNo: true,
      reviewStatus: 'approved', publishStatus: 'published', reviewedBy: 'user-reviewer-1',
      reviewedAt: new Date('2026-06-12T02:10:00.000Z'), syncTime: new Date('2026-06-12T02:00:00.000Z'),
    },
    {
      id: BOTH_DRAFT, sourceOrgId: ORG_DEMO, externalId: 'demo-co-3', sourceName: demoSource,
      name: '华东云创软件有限公司（演示）', description: '演示数据：云计算与行业数字化解决方案。',
      city: '青岛市', reviewStatus: 'pending', publishStatus: 'draft',
    },
    {
      id: BOTH_ALREADY, sourceOrgId: ORG_DEMO, externalId: 'demo-co-2', sourceName: demoSource,
      name: '中科能源装备集团（演示）', city: '青岛市', reviewStatus: 'approved', publishStatus: 'unpublished',
    },
    {
      id: NAME_ONLY, sourceOrgId: ORG_REAL, externalId: 'qd-2026-0413', sourceName: realSource,
      name: '海岸线数字科技有限公司（演示）', city: '青岛市', reviewStatus: 'approved', publishStatus: 'published',
    },
    {
      id: SOURCE_ONLY, sourceOrgId: ORG_DEMO, externalId: 'demo-co-9', sourceName: demoSource,
      name: '青岛港湾物流有限公司', city: '青岛市', reviewStatus: 'approved', publishStatus: 'published',
    },
    {
      id: REAL_PUBLISHED, sourceOrgId: ORG_REAL, externalId: 'qd-2026-0288', sourceName: realSource,
      sourceUrl: 'https://example.gov.cn/companies/0288', name: '青岛瑞衡精密机械有限公司',
      industry: 'manufacturing', scale: '300-500', province: '山东省', city: '青岛市', district: '城阳区',
      reviewStatus: 'approved', publishStatus: 'published', reviewedBy: 'user-reviewer-2',
      reviewedAt: new Date('2026-09-18T07:42:00.000Z'),
    },
    {
      id: REAL_DRAFT, sourceOrgId: ORG_REAL, externalId: 'qd-2026-0301', sourceName: realSource,
      name: '崂山云谷信息技术有限公司', city: '青岛市', reviewStatus: 'pending', publishStatus: 'draft',
    },
    {
      id: HALF_WIDTH, sourceOrgId: ORG_DEMO, externalId: 'demo-co-hw', sourceName: '市人社公共就业平台(演示)',
      name: '蓝湾新材料有限公司(演示)', city: '青岛市', reviewStatus: 'approved', publishStatus: 'published',
    },
    {
      id: BARE_WORD, sourceOrgId: ORG_REAL, externalId: 'qd-2026-0517', sourceName: '演示与展陈服务中心',
      name: '演示科技（青岛）有限公司', city: '青岛市', reviewStatus: 'approved', publishStatus: 'published',
    },
  ]
  for (const row of rows) await prisma.companyProfile.create({ data: row })
  await prisma.job.create({
    data: {
      sourceOrgId: ORG_DEMO, externalId: 'demo-co1-j1', sourceName: demoSource,
      sourceUrl: 'https://example.com/demo/jobs/demo-co1-j1', title: '自动化设备工程师（演示）',
      company: '未来智造科技有限公司（演示）', city: '青岛', reviewStatus: 'approved', publishStatus: 'published',
      companyProfileId: BOTH_PUBLISHED,
    },
  })
}

function checkConfig(): void {
  console.log('\n[1] 确认词与事由（纯函数）')
  const expectConfigError = (env: NodeJS.ProcessEnv, code: string, label: string): void => {
    try {
      readDemoCompanyUnpublishConfig(env)
      check(false, label, '没有抛错')
    } catch (error) {
      check(error instanceof DemoCompanyUnpublishConfigError && error.message.startsWith(code), label, String(error))
    }
  }
  check(readDemoCompanyUnpublishConfig({}).mode === 'dry-run', '不设确认词 → dry-run')
  check(readDemoCompanyUnpublishConfig({ UNPUBLISH_DEMO_COMPANIES_CONFIRM: '' }).mode === 'dry-run', '确认词为空串 → dry-run')
  const reasonOnly = readDemoCompanyUnpublishConfig({ UNPUBLISH_DEMO_COMPANIES_REASON: REASON })
  check(reasonOnly.mode === 'dry-run' && reasonOnly.reason === null, '只给事由不给确认词 → 仍是 dry-run')
  expectConfigError({ UNPUBLISH_DEMO_COMPANIES_CONFIRM: 'unpublish_demo_companies', UNPUBLISH_DEMO_COMPANIES_REASON: REASON }, 'UNPUBLISH_DEMO_COMPANIES_CONFIRM_MISMATCH', '确认词大小写不同 → 拒绝')
  expectConfigError({ UNPUBLISH_DEMO_COMPANIES_CONFIRM: ` ${UNPUBLISH_DEMO_COMPANIES_CONFIRMATION}`, UNPUBLISH_DEMO_COMPANIES_REASON: REASON }, 'UNPUBLISH_DEMO_COMPANIES_CONFIRM_MISMATCH', '确认词多一个空格 → 拒绝（精确匹配）')
  expectConfigError({ UNPUBLISH_DEMO_COMPANIES_CONFIRM: UNPUBLISH_DEMO_COMPANIES_CONFIRMATION }, 'UNPUBLISH_DEMO_COMPANIES_REASON_INVALID', '确认词对但缺事由 → 拒绝')
  expectConfigError({ UNPUBLISH_DEMO_COMPANIES_CONFIRM: UNPUBLISH_DEMO_COMPANIES_CONFIRMATION, UNPUBLISH_DEMO_COMPANIES_REASON: '   ' }, 'UNPUBLISH_DEMO_COMPANIES_REASON_INVALID', '事由全是空白 → 拒绝')
  expectConfigError({ UNPUBLISH_DEMO_COMPANIES_CONFIRM: UNPUBLISH_DEMO_COMPANIES_CONFIRMATION, UNPUBLISH_DEMO_COMPANIES_REASON: '清' }, 'UNPUBLISH_DEMO_COMPANIES_REASON_INVALID', '事由 1 个字 → 拒绝')
  expectConfigError({ UNPUBLISH_DEMO_COMPANIES_CONFIRM: UNPUBLISH_DEMO_COMPANIES_CONFIRMATION, UNPUBLISH_DEMO_COMPANIES_REASON: '演'.repeat(201) }, 'UNPUBLISH_DEMO_COMPANIES_REASON_INVALID', '事由 201 个字 → 拒绝')
  const max = readDemoCompanyUnpublishConfig({ UNPUBLISH_DEMO_COMPANIES_CONFIRM: UNPUBLISH_DEMO_COMPANIES_CONFIRMATION, UNPUBLISH_DEMO_COMPANIES_REASON: '演'.repeat(200) })
  check(max.mode === 'apply' && Array.from(max.reason ?? '').length === 200, '事由 200 个字（按字符数，不按字节）→ 执行模式')
  const trimmed = readDemoCompanyUnpublishConfig({ UNPUBLISH_DEMO_COMPANIES_CONFIRM: UNPUBLISH_DEMO_COMPANIES_CONFIRMATION, UNPUBLISH_DEMO_COMPANIES_REASON: `  ${REASON}  ` })
  check(trimmed.mode === 'apply' && trimmed.reason === REASON, '事由首尾空白被去掉')

  console.log('\n[2] 目标数据库描述不泄露口令')
  const pg = describeDatabaseTarget('postgresql://produser:S3cret%21pass@pg.internal.example:5432/ai_job_print?sslmode=require')
  check(pg.includes('pg.internal.example:5432') && pg.includes('ai_job_print'), 'PostgreSQL：打印主机、端口、库名', pg)
  check(!pg.includes('S3cret') && !pg.includes('produser') && !pg.includes('sslmode'), 'PostgreSQL：不含密码、用户名、查询参数', pg)
  check(describeDatabaseTarget('file:./prisma/dev.db') === 'SQLite 文件 ./prisma/dev.db', 'SQLite：打印文件路径')
}

async function main(): Promise<void> {
  console.log('\n=== 维护命令：下架演示企业 ===')
  checkConfig()

  prepareDb()
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  try {
    await seed(prisma)
    const initial = await snapshot(prisma)
    check(initial.companyCount === 9, '夹具：9 家企业已写入', initial.companyCount)

    console.log('\n[3] dry-run（不设确认词）')
    const dry = runCli({})
    check(dry.status === 0, 'dry-run 退出码 0', { status: dry.status, stderr: dry.stderr.slice(-400) })
    check(dry.stdout.includes('将改 2 行 / 已下架 1 行'), 'dry-run 输出「将改 2 行 / 已下架 1 行」', dry.stdout.slice(-600))
    check(dry.stdout.includes(`目标数据库：SQLite 文件 ${dbPath}`), 'dry-run 打印目标数据库')
    check(EXPECTED_TARGETS.every((id) => dry.stdout.includes(id)) && dry.stdout.includes(BOTH_ALREADY), 'dry-run 清单列出 id')
    check(![NAME_ONLY, SOURCE_ONLY, REAL_PUBLISHED, REAL_DRAFT, HALF_WIDTH, BARE_WORD].some((id) => dry.stdout.includes(id)), 'dry-run 清单不含未带双标记的行')
    const afterDry = await snapshot(prisma)
    check(sameSnapshot(initial, afterDry), 'dry-run 前后逐行快照完全一致、审计表无新行')

    console.log('\n[4] 确认词错 / 缺事由：退出码 2，不改库')
    const cases: Array<[string, Record<string, string>]> = [
      ['确认词错', { UNPUBLISH_DEMO_COMPANIES_CONFIRM: 'YES', UNPUBLISH_DEMO_COMPANIES_REASON: REASON }],
      ['确认词对、缺事由', { UNPUBLISH_DEMO_COMPANIES_CONFIRM: UNPUBLISH_DEMO_COMPANIES_CONFIRMATION }],
      ['确认词对、事由 1 个字', { UNPUBLISH_DEMO_COMPANIES_CONFIRM: UNPUBLISH_DEMO_COMPANIES_CONFIRMATION, UNPUBLISH_DEMO_COMPANIES_REASON: '清' }],
    ]
    for (const [label, env] of cases) {
      const result = runCli(env)
      check(result.status === 2, `${label} → 退出码 2`, { status: result.status, stderr: result.stderr.slice(-300) })
      check(sameSnapshot(initial, await snapshot(prisma)), `${label} → 库与审计完全不变`)
    }

    console.log('\n[5] 审计写失败整体回滚；审计必须走事务客户端')
    const realAudit = new AuditService(prisma)
    let calls = 0
    let usedBaseClient = false
    const flakyAudit: AuditWriter = {
      async writeRequired(tx, args) {
        calls += 1
        if ((tx as unknown) === (prisma as unknown)) usedBaseClient = true
        if (calls === 2) throw new Error('INJECTED_AUDIT_FAILURE')
        return realAudit.writeRequired(tx, args)
      },
    }
    let rolledBackError = ''
    try {
      await runDemoCompanyUnpublish(prisma, flakyAudit, { mode: 'apply', reason: REASON })
    } catch (error) {
      rolledBackError = error instanceof Error ? error.message : String(error)
    }
    check(rolledBackError === 'INJECTED_AUDIT_FAILURE', '第二条审计失败 → 命令整体报错', rolledBackError)
    check(calls === 2, '审计按行写入（失败前写过 1 条）', calls)
    check(!usedBaseClient, '审计写入用的是事务客户端，不是事务外的连接')
    check(sameSnapshot(initial, await snapshot(prisma)), '回滚后状态与审计都不变（第一行的改动与审计一起撤销）')

    console.log('\n[6] 执行')
    const apply = runCli({ UNPUBLISH_DEMO_COMPANIES_CONFIRM: UNPUBLISH_DEMO_COMPANIES_CONFIRMATION, UNPUBLISH_DEMO_COMPANIES_REASON: REASON })
    check(apply.status === 0, '执行退出码 0', { status: apply.status, stderr: apply.stderr.slice(-400) })
    check(apply.stdout.includes('已下架 2 行，写审计 2 条；跳过 1 行'), '执行输出汇总', apply.stdout.slice(-600))
    check(apply.stdout.includes(`目标数据库：SQLite 文件 ${dbPath}`) && apply.stdout.includes(`事由：${REASON}`), '执行打印目标数据库与事由')
    const afterApply = await snapshot(prisma)
    check(afterApply.companyCount === initial.companyCount, '企业行数不变（不删行）', afterApply.companyCount)
    check(afterApply.orgs === initial.orgs, '机构行逐字段不变')
    check(afterApply.jobs === initial.jobs, '岗位行逐字段不变（本命令只管企业）')
    for (const id of EXPECTED_TARGETS) {
      const before = initial.companies.get(id)
      const after = afterApply.companies.get(id)
      check(after?.['publishStatus'] === 'unpublished', `${id}：publishStatus → unpublished`, after?.['publishStatus'])
      check(
        withoutKeys(before, ['publishStatus', 'updatedAt']) === withoutKeys(after, ['publishStatus', 'updatedAt']),
        `${id}：除 publishStatus / updatedAt 外逐字段不变（reviewStatus 等不动）`,
      )
    }
    for (const id of UNTOUCHED) {
      check(serialize(initial.companies.get(id)) === serialize(afterApply.companies.get(id)), `${id}：逐字段不变（含 updatedAt）`)
    }

    const audits = await prisma.auditLog.findMany({ where: { action: 'company.maintenance_unpublish' }, orderBy: { targetId: 'asc' } })
    check(afterApply.auditCount - initial.auditCount === 2 && audits.length === 2, '审计恰好 2 条（每行一条，已是 unpublished 的不写）', audits.length)
    check(serialize(audits.map((a) => a.targetId)) === serialize(EXPECTED_TARGETS), '审计 targetId 与被下架的行一一对应', audits.map((a) => a.targetId))
    for (const row of audits) {
      const payload = JSON.parse(row.payloadJson) as Record<string, unknown>
      const before = initial.companies.get(row.targetId ?? '')
      check(
        row.actorId === null && row.actorRole === 'system-cli' && row.targetType === 'company_profile',
        `${row.targetId}：审计 actorId=null、actorRole=system-cli、targetType=company_profile`,
        { actorId: row.actorId, actorRole: row.actorRole, targetType: row.targetType },
      )
      check(
        payload['reason'] === REASON && payload['fromPublishStatus'] === before?.['publishStatus'] && payload['toPublishStatus'] === 'unpublished',
        `${row.targetId}：审计 payload 含事由与真实旧状态`,
        payload,
      )
      check(payload['marker'] === DEMO_COMPANY_MARK && payload['companyName'] === before?.['name'], `${row.targetId}：审计 payload 记录判据与企业名`, payload)
      check(serialize(Object.keys(payload).sort()) === serialize(AUDIT_PAYLOAD_KEYS), `${row.targetId}：审计 payload 键集合封闭（不带个人信息）`, Object.keys(payload))
    }

    console.log('\n[7] 第二次执行：幂等')
    const again = runCli({ UNPUBLISH_DEMO_COMPANIES_CONFIRM: UNPUBLISH_DEMO_COMPANIES_CONFIRMATION, UNPUBLISH_DEMO_COMPANIES_REASON: REASON })
    check(again.status === 0, '第二次执行退出码 0', { status: again.status, stderr: again.stderr.slice(-400) })
    check(again.stdout.includes('已下架 0 行，写审计 0 条；跳过 3 行'), '第二次执行输出 0 行改动', again.stdout.slice(-600))
    check(sameSnapshot(afterApply, await snapshot(prisma)), '第二次执行后逐行不变（含 updatedAt）、无新审计')

    const dryAfter = runCli({})
    check(dryAfter.status === 0 && dryAfter.stdout.includes('将改 0 行 / 已下架 3 行'), '执行后 dry-run 显示「将改 0 行 / 已下架 3 行」', dryAfter.stdout.slice(-400))
  } finally {
    await prisma.onModuleDestroy()
  }

  console.log(`\n结果：${passed} 通过，${failed} 失败`)
  if (failed > 0) throw new Error(`VERIFY FAILED: ${failed} 条断言失败`)
}

function prepareDb(): void {
  closeSync(openSync(dbPath, 'a'))
  try {
    // 直接调 prisma CLI 入口，不经 pnpm exec（借用他处 node_modules 时 pnpm exec 会隐式改写依赖目录）。
    execFileSync(process.execPath, [path.join(apiRoot, 'node_modules', 'prisma', 'build', 'index.js'), 'db', 'push'], {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    })
  } catch (error) {
    const details = error as { stdout?: Buffer; stderr?: Buffer }
    console.error(details.stdout?.toString() ?? '')
    console.error(details.stderr?.toString() ?? '')
    throw error
  }
}

function cleanupDb(): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(`${dbPath}${suffix}`, { force: true })
}

// 事务里若用事务外连接写库，SQLite 会互等、事件循环清空后 node 以退出码 0 静默退出。
// 没走到结尾就退出一律判失败，不让「半途退出」冒充通过。
let finished = false
process.on('exit', (code) => {
  if (finished || code !== 0) return
  console.error('  FAIL 门禁没有跑完就退出（疑似事务内用了事务外连接导致互等）')
  cleanupDb()
  process.exitCode = 1
})

main()
  .then(() => {
    finished = true
    cleanupDb()
  })
  .catch((error: unknown) => {
    console.error('\n', error instanceof Error ? error.message : error)
    cleanupDb()
    process.exit(1)
  })
