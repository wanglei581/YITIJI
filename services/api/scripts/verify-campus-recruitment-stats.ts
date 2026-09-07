/**
 * 校园招聘聚合（包 N2）门禁。
 *
 * A. 静态：不依赖 AI；只读已审核已发布；每组带来源；不含招聘闭环指标。
 * B. 行为：空输入给空集合 + reason；未发布/非校招不计入；数字可追到来源。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:campus-recruitment-stats
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  aggregateCampusRecruitmentStats,
  CAMPUS_RECRUITMENT_STATS_NOTES,
  CAMPUS_RECRUITMENT_STATS_SCAN_LIMIT,
  isCampusFair,
  shanghaiYearMonth,
  type CampusFairRow,
  type CampusJobRow,
  type CampusRecruitmentStatsData,
} from '../src/jobs/campus-recruitment-stats.rules'

let passCount = 0
function pass(msg: string) { passCount += 1; console.log(`  PASS ${msg}`) }
function fail(msg: string): never { console.error(`  FAIL ${msg}`); throw new Error(`VERIFY FAILED: ${msg}`) }
function check(cond: boolean, msg: string) { cond ? pass(msg) : fail(msg) }

const API_ROOT = join(__dirname, '..')
const REPO_ROOT = join(API_ROOT, '..', '..')
const read = (rel: string, base = API_ROOT) => readFileSync(join(base, rel), 'utf8')

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n')
}

const RULES_SRC = read('src/jobs/campus-recruitment-stats.rules.ts')
const SERVICE_SRC = read('src/jobs/campus-recruitment-stats.service.ts')
const CONTROLLER_SRC = read('src/jobs/kiosk-campus-recruitment-stats.controller.ts')
const MODULE_SRC = read('src/jobs/jobs.module.ts')
const SHARED_SRC = read('packages/shared/src/types/campusRecruitmentStats.ts', REPO_ROOT)
const SHARED_INDEX = read('packages/shared/src/index.ts', REPO_ROOT)
const KIOSK_PAGE = read('apps/kiosk/src/pages/campus/FreshmanInsightsPage.tsx', REPO_ROOT)
const KIOSK_GROUPS = read('apps/kiosk/src/pages/campus/CampusInsightsGroups.tsx', REPO_ROOT)
const KIOSK_CLIENT = read('apps/kiosk/src/services/api/campusRecruitmentStats.ts', REPO_ROOT)

const RULES_CODE = stripComments(RULES_SRC)
const SERVICE_CODE = stripComments(SERVICE_SRC)
const CONTROLLER_CODE = stripComments(CONTROLLER_SRC)
const SHARED_CODE = stripComments(SHARED_SRC)

console.log('\n[A] 静态：只读聚合，不得依赖 AI，不得变成招聘闭环')

for (const [name, src] of [['rules', RULES_CODE], ['service', SERVICE_CODE], ['controller', CONTROLLER_CODE]] as const) {
  check(!/\bLlm\b|\bPaidAiThrottle\b|\bopenai\b|\bAiLogService\b/.test(src), `${name} 不引用计费 AI`)
  check(!/\bfetch\s*\(|axios|http\.request/.test(src), `${name} 不发起外网请求`)
}
for (const forbidden of ['@nestjs/', 'PrismaService', 'process.env']) {
  check(!RULES_CODE.includes(forbidden), `rules 不引用 ${forbidden}`)
}

check(CONTROLLER_CODE.includes("@Controller('kiosk/campus')"), '控制器前缀含 kiosk/campus')
check(CONTROLLER_CODE.includes("@Get('recruitment-stats')"), '声明 GET recruitment-stats')
check(CONTROLLER_CODE.includes('@TerminalScopedThrottle(30)'), '按台限流 @TerminalScopedThrottle(30)')
check(!CONTROLLER_CODE.includes('@UseGuards'), '匿名可读，不加鉴权守卫')
check(!CONTROLLER_CODE.includes('PaidAiThrottle'), '不是计费 AI 路由')
check(MODULE_SRC.includes('KioskCampusRecruitmentStatsController'), 'JobsModule 注册了控制器')
check(MODULE_SRC.includes('CampusRecruitmentStatsService'), 'JobsModule 注册了服务')

check(SERVICE_CODE.includes("reviewStatus: 'approved'"), '招聘会只取 approved')
check(SERVICE_CODE.includes("publishStatus: 'published'"), '招聘会只取 published')
check(SERVICE_CODE.includes('buildPublishedJobWhere'), '岗位 where 复用已发布构造器')
check(SERVICE_CODE.includes("category: 'campus'"), '岗位只取 category=campus')
check(SERVICE_CODE.includes('withPublicFairDemoExclusion'), '公开招聘会走演示数据排除')

const BANNED = ['一键投递', '立即投递', '平台投递', '候选人管理', '录用率', '签约率', 'offerCount', 'candidateCount', 'hireRate']
for (const [name, src] of [
  ['rules', RULES_CODE],
  ['service', SERVICE_CODE],
  ['controller', CONTROLLER_CODE],
  ['shared', SHARED_CODE],
  ['kiosk-page', stripComments(KIOSK_PAGE)],
  ['kiosk-groups', stripComments(KIOSK_GROUPS)],
] as const) {
  for (const banned of BANNED) {
    check(!src.includes(banned), `${name} 不含「${banned}」`)
  }
}

check(SHARED_INDEX.includes("export * from './types/campusRecruitmentStats'"), '共享契约已导出')
check(
  SHARED_CODE.includes(`CAMPUS_RECRUITMENT_STATS_SCAN_LIMIT = ${CAMPUS_RECRUITMENT_STATS_SCAN_LIMIT}`),
  '两侧扫描上限一致',
)
check(
  JSON.stringify(CAMPUS_RECRUITMENT_STATS_NOTES) === JSON.stringify([
    '本页只聚合已审核且已发布的校园招聘会与校招岗位，每个数字都带来源机构与同步时间。',
    '不含招聘结果类指标；本平台无法证实录用、签约或候选人规模。',
    '无经核验数据时返回空集合，不使用示例数字。',
  ]),
  '口径说明不含示例数字承诺',
)

const fieldNames = (src: string, iface: string): string[] => {
  const start = src.indexOf(`interface ${iface} {`)
  if (start < 0) fail(`找不到 interface ${iface}`)
  const body = src.slice(start, src.indexOf('\n}', start))
  return [...body.matchAll(/^\s{2}(\w+)[?]?:/gm)].map((m) => m[1]!).sort()
}
for (const iface of [
  'CampusRecruitmentTimeBucket',
  'CampusRecruitmentSourceGroup',
  'CampusRecruitmentStatsData',
]) {
  const a = fieldNames(SHARED_SRC, iface).join(',')
  const b = fieldNames(RULES_SRC, iface).join(',')
  check(a === b, `${iface} 共享契约与后端副本字段一致 (${a || '∅'})`)
}

check(KIOSK_PAGE.includes('暂无经核验的校园招聘统计'), '空态保留诚实标题')
check(KIOSK_PAGE.includes('不会展示示例数据'), '空态保留不展示示例数据')
check(KIOSK_PAGE.includes('查看招聘会'), '提供查看招聘会出口')
check(KIOSK_PAGE.includes('重新加载'), '失败可重试')
check(KIOSK_PAGE.includes("navigate('/job-fairs')"), '查看招聘会跳到既有列表')
check(KIOSK_GROUPS.includes('FusionSourceMeta'), '每组展示来源机构与同步时间')
check(KIOSK_CLIENT.includes('/kiosk/campus/recruitment-stats'), '一体机请求校招聚合路径')
check(KIOSK_CLIENT.includes("API_MODE !== 'http'"), 'mock 模式不编数字，走空集合')

console.log('\n[B] 行为：空集合诚实，只计已发布校招')

const generatedAt = new Date('2099-01-01T00:00:00.000Z')

function run(fairs: CampusFairRow[], jobs: CampusJobRow[] = []): CampusRecruitmentStatsData {
  return aggregateCampusRecruitmentStats({
    fairs,
    jobs,
    generatedAt,
    truncated: false,
    scanLimit: CAMPUS_RECRUITMENT_STATS_SCAN_LIMIT,
  })
}

const empty = run([], [])
check(empty.groups.length === 0, '无数据时 groups 为空')
check(empty.reason === 'no_published_campus_records', '无数据时给出 reason')
check(empty.notes.length > 0, '无数据时仍给出口径说明')
check(!empty.groups.some((g) => g.fairCount > 0 || g.openJobCount > 0), '空集合不含假数字')

check(isCampusFair({
  theme: 'campus', title: '秋季招聘', venue: '体育馆', description: null, sourceName: '就业中心',
}), 'theme=campus 识别为校招会')
check(isCampusFair({
  theme: 'general', title: '高校毕业生双选会', venue: '体育馆', description: null, sourceName: '人社局',
}), '标题含双选/高校识别为校招会')
check(!isCampusFair({
  theme: 'industry', title: '制造业专场', venue: '会展中心', description: '社招', sourceName: '行业协会',
}), '行业专场不计入')

const fair: CampusFairRow = {
  id: 'fair-1',
  sourceOrgId: 'org-school',
  sourceName: '青岛大学就业中心',
  syncTime: new Date('2099-03-01T00:00:00.000Z'),
  theme: 'campus',
  title: '2026 届双选会',
  venue: '青岛大学体育馆',
  description: null,
  startAt: new Date('2099-03-15T02:00:00.000Z'),
  companies: [
    { name: '海尔', positionCount: 3 },
    { name: '海信', positionCount: 2 },
    { name: '海尔', positionCount: 1 },
  ],
}
const industryFair: CampusFairRow = {
  ...fair,
  id: 'fair-industry',
  theme: 'industry',
  title: '制造业专场',
  venue: '会展中心',
  sourceName: '行业协会',
  companies: [{ name: '某厂', positionCount: 9 }],
}

const filled = run([fair, industryFair], [
  { sourceOrgId: 'org-school', sourceName: '青岛大学就业中心', syncTime: new Date('2099-03-02T00:00:00.000Z') },
  { sourceOrgId: 'org-school', sourceName: '青岛大学就业中心', syncTime: new Date('2099-02-01T00:00:00.000Z') },
])
check(filled.reason === null, '有数据时 reason 为 null')
check(filled.groups.length === 1, '行业专场不计入，只留校招来源组')
const group = filled.groups[0]!
check(group.sourceOrgId === 'org-school', '组键为 sourceOrgId')
check(group.sourceName === '青岛大学就业中心', '带来源机构名')
check(group.syncTime === '2099-03-02T00:00:00.000Z', 'syncTime 取组内最近同步')
check(group.fairCount === 1, '场次数不计行业专场')
check(group.companyCount === 2, '参会企业按名称去重')
check(group.fairPositionCount === 6, '场内岗位 3+2+1')
check(group.jobListingCount === 2, '校招岗位条数')
check(group.openJobCount === 8, '在招岗位 = 场内 + 岗位库')
check(group.timeDistribution.length === 1, '时间分布按开场月份')
check(group.timeDistribution[0]?.period === shanghaiYearMonth(fair.startAt), '月份桶用上海墙钟')
check(group.timeDistribution[0]?.fairCount === 1, '该月场次为 1')

const keys = Object.keys(group)
for (const banned of ['hireRate', 'offerCount', 'candidateCount', 'expectedAttendance', 'viewCount']) {
  check(!keys.includes(banned), `响应组不含 ${banned}`)
}

console.log(`\n=== ALL PASS (${passCount}) ===`)
