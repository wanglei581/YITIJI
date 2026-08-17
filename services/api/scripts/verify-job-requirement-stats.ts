/**
 * 岗位要求计数（S3-JOBCOUNT）门禁。
 *
 * 这条能力存在的唯一理由是「AI 挂了也还能看」，所以门禁分两半：
 *
 *  A. 静态：证明它**不可能**依赖 AI，也不可能变成推荐/投递
 *     —— 纯规则文件不 import Nest/Prisma/env/LLM；全链路不出现 E3；
 *        响应不含岗位标识；路由声明在 jobs/:id 之前；共享契约与后端副本字段一致。
 *
 *  B. 行为：证明**样本量不足时不给数字**（红线：不得给一个看起来像统计结果的数字）
 *     —— 整批不足 / 单维度不足 / 无岗位 / 只有标题，四条分支逐一断言 items 为空。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:job-requirement-stats
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  aggregateJobRequirementStats,
  JOB_REQUIREMENT_MIN_SAMPLE_SIZE,
  JOB_REQUIREMENT_MIN_STATED_COUNT,
  JOB_REQUIREMENT_SCAN_LIMIT,
  type JobRequirementSourceRow,
  type JobRequirementStatsData,
  type JobRequirementDimensionKey,
} from '../src/jobs/job-requirement-stats.rules'

let passCount = 0
function pass(msg: string) { passCount += 1; console.log(`  PASS ${msg}`) }
function fail(msg: string): never { console.error(`  FAIL ${msg}`); throw new Error(`VERIFY FAILED: ${msg}`) }
function check(cond: boolean, msg: string) { cond ? pass(msg) : fail(msg) }

const API_ROOT = join(__dirname, '..')
const REPO_ROOT = join(API_ROOT, '..', '..')
const read = (rel: string, base = API_ROOT) => readFileSync(join(base, rel), 'utf8')

/**
 * 去掉块注释与整行注释再做「不得出现 X」的静态断言。
 * 不去注释的话，本文件要求写在源码注释里的那些禁令（「不 import @nestjs」「不得出现 E3」）
 * 会被自己的门禁抓出来 —— 抓的是说明文字，不是真实依赖。
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n')
}

const RULES_SRC = read('src/jobs/job-requirement-stats.rules.ts')
const SERVICE_SRC = read('src/jobs/job-requirement-stats.service.ts')
const CONTROLLER_SRC = read('src/jobs/jobs.controller.ts')
const SHARED_SRC = read('packages/shared/src/types/jobRequirementStats.ts', REPO_ROOT)
const SHARED_INDEX = read('packages/shared/src/index.ts', REPO_ROOT)

/** 证书词典是 rules 的数据侧拆分，必须受同一套「不依赖 AI」静态约束。 */
const CERT_SRC = read('src/jobs/job-requirement-certificates.ts')

const RULES_CODE = stripComments(RULES_SRC)
const SERVICE_CODE = stripComments(SERVICE_SRC)
const SHARED_CODE = stripComments(SHARED_SRC)
const CERT_CODE = stripComments(CERT_SRC)

// ══════════════════════════════════════════════════════════════════════════
// A. 静态门禁
// ══════════════════════════════════════════════════════════════════════════

console.log('\n[A] 静态：这条降级路径不得依赖 AI，也不得变成推荐/投递')

// A1 纯规则/词典文件与运行时、框架、模型解耦 —— 否则「AI 挂了还能用」就是空话
for (const [name, src] of [['rules', RULES_CODE], ['certificates', CERT_CODE]] as const) {
  for (const forbidden of ['@nestjs/', 'PrismaService', 'process.env', 'Llm', 'openai', 'AiLogService']) {
    check(!src.includes(forbidden), `${name} 不引用 ${forbidden}`)
  }
  check(!/\bfetch\s*\(|axios|http\.request/.test(src), `${name} 不发起任何网络请求`)
}
// 词典只许被 rules 消费一处，避免出现第二套「数哪些词」的口径
check(CERT_CODE.includes('export const CERTIFICATE_DICTIONARY'), '证书词典集中在 certificates 文件')
check(!RULES_CODE.includes('aliases:'), 'rules 里不得再内联第二份证书词典')

// A2 证据分级恒 E2：确定性计数标成 E3 会把「不依赖 AI」这件事说反
check(RULES_CODE.includes("evidenceLevel: 'E2'"), 'rules 输出 evidenceLevel: E2')
for (const [name, src] of [['rules', RULES_CODE], ['certificates', CERT_CODE], ['service', SERVICE_CODE], ['shared', SHARED_CODE]] as const) {
  check(!/['"]E3['"]/.test(src), `${name} 代码里不出现 E3 取值`)
}
check(/evidenceLevel:\s*'E2'/.test(SHARED_CODE), '共享契约把 evidenceLevel 锁成字面量 E2')

// A3 服务层不注入任何 AI 依赖，也不落 AI 调用日志（没有模型调用可记）
for (const forbidden of ['Llm', 'AiLogService', 'AiUsageAccumulator', 'aiErrorCodeOf']) {
  check(!SERVICE_CODE.includes(forbidden), `service 不注入 ${forbidden}`)
}

// A4 合规：响应不得夹带岗位标识（否则这张统计表会变成一份可点的岗位清单）
const SELECT_BLOCK = SERVICE_CODE.slice(SERVICE_CODE.indexOf('select:'), SERVICE_CODE.indexOf('orderBy:'))
for (const identity of ['id', 'title', 'company', 'sourceUrl', 'externalId', 'companyProfileId']) {
  check(!new RegExp(`^\\s*${identity}:\\s*true`, 'm').test(SELECT_BLOCK), `service select 不取岗位标识列 ${identity}`)
}
check(/^\s*sourceOrgId:\s*true/m.test(SELECT_BLOCK), 'service 只取 sourceOrgId 用于来源机构计数')

// A5 合规：不得出现投递/推荐/裁决语义（CLAUDE.md §2）
const BANNED_COPY = ['一键投递', '立即投递', '平台投递', '企业收简历', '候选人管理', '推荐岗位', '匹配度', '录用结果预测']
for (const banned of BANNED_COPY) {
  check(!RULES_SRC.includes(banned), `rules 文案不含「${banned}」`)
}
check(RULES_SRC.includes('不是市场需求'), 'rules 带上「条数不是市场需求」的边界口径')
check(RULES_SRC.includes('不代收简历、不代为投递'), 'rules 带上「不代收简历、不代为投递」的边界口径')

// A6 路由顺序：Nest 按声明顺序匹配，requirement-stats 落在 :id 之后就永远打不到
const statsIdx = CONTROLLER_SRC.indexOf("@Get('jobs/requirement-stats')")
const byIdIdx = CONTROLLER_SRC.indexOf("@Get('jobs/:id')")
check(statsIdx > 0, '控制器声明了 GET jobs/requirement-stats')
check(byIdIdx > 0 && statsIdx < byIdIdx, 'requirement-stats 声明在 jobs/:id 之前')
const STATS_HANDLER = CONTROLLER_SRC.slice(statsIdx, byIdIdx)
check(!STATS_HANDLER.includes('@UseGuards'), '计数端点与 GET /jobs 同为公开只读，不加鉴权守卫')

// A7 计数与列表必须命中同一批岗位，否则统计的是用户翻不到的岗位。
// 只查 import 里有这个名字不够 —— 反向验证证明「留着 import、body 里另拼一份 where」
// 能骗过那种写法，所以这里断的是**赋值语句**，并禁止 service 自己拼审核/发布条件。
const KIOSK_CODE = stripComments(read('src/jobs/jobs-kiosk.service.ts'))
const WHERE_CALL = /const where = buildPublishedJobWhere\(/
check(WHERE_CALL.test(KIOSK_CODE), 'GET /jobs 的 where 由统一构造器赋值')
check(WHERE_CALL.test(SERVICE_CODE), '计数端点的 where 由同一构造器赋值')
for (const gate of ['reviewStatus', 'publishStatus']) {
  check(!new RegExp(`${gate}\\s*:`).test(SERVICE_CODE), `service 不自己拼 ${gate} 条件（只能走统一构造器）`)
}

// A8 共享契约必须被导出，且与后端副本字段一致（副本漂移=前端接错）
check(SHARED_INDEX.includes("export * from './types/jobRequirementStats'"), '共享契约已在 shared index 导出')
const fieldNames = (src: string, iface: string): string[] => {
  const start = src.indexOf(`interface ${iface} {`)
  if (start < 0) fail(`找不到 interface ${iface}`)
  const body = src.slice(start, src.indexOf('\n}', start))
  return [...body.matchAll(/^\s{2}(\w+)[?]?:/gm)].map((m) => m[1]!).sort()
}
for (const iface of ['JobRequirementSampleInfo', 'JobRequirementDimensionStat', 'JobRequirementStatsData', 'JobRequirementStatItem']) {
  const a = fieldNames(SHARED_SRC, iface).join(',')
  const b = fieldNames(RULES_SRC, iface).join(',')
  check(a === b, `${iface} 共享契约与后端副本字段一致 (${a || '∅'})`)
}
check(
  SHARED_CODE.includes(`JOB_REQUIREMENT_MIN_SAMPLE_SIZE = ${JOB_REQUIREMENT_MIN_SAMPLE_SIZE}`)
  && SHARED_CODE.includes(`JOB_REQUIREMENT_MIN_STATED_COUNT = ${JOB_REQUIREMENT_MIN_STATED_COUNT}`),
  '两侧样本量门槛常量一致',
)

// ══════════════════════════════════════════════════════════════════════════
// B. 行为门禁
// ══════════════════════════════════════════════════════════════════════════

const EMPTY_FILTER = { keyword: null, city: null, category: null, industry: null, sourceOrgId: null }

function row(overrides: Partial<JobRequirementSourceRow> = {}): JobRequirementSourceRow {
  return {
    sourceOrgId: 'org-1',
    syncTime: new Date('2026-08-09T07:30:00.000Z'),
    description: '负责设备日常维护。',
    requirements: '大专及以上学历，2 年以上设备维护工作经验，持电工证。',
    educationRequirement: null,
    experienceRequirement: null,
    skillsJson: '[]',
    ...overrides,
  }
}

function run(rows: JobRequirementSourceRow[], matchedTotal = rows.length): JobRequirementStatsData {
  return aggregateJobRequirementStats({ filter: EMPTY_FILTER, matchedTotal, rows })
}

function dim(data: JobRequirementStatsData, key: JobRequirementDimensionKey) {
  const d = data.dimensions.find((x) => x.dimension === key)
  if (!d) fail(`响应缺少维度 ${key}`)
  return d
}

function countOf(data: JobRequirementStatsData, key: JobRequirementDimensionKey, itemKey: string): number {
  return dim(data, key).items.find((i) => i.key === itemKey)?.count ?? 0
}

/** 够样本量的底噪：12 条同样的岗位，四个维度都写满。 */
const BASELINE = Array.from({ length: 12 }, () => row({
  educationRequirement: '本科及以上',
  experienceRequirement: '3-5年',
  skillsJson: '["PLC","SolidWorks"]',
}))

console.log('\n[B1] 样本量不足：如实报数，但不给分布（红线①）')

{
  const data = run([], 0)
  check(data.sample.matchedTotal === 0 && data.sample.countedTotal === 0, '无岗位：两个总数都是 0')
  check(data.sample.issue === 'no_matching_jobs', '无岗位：issue = no_matching_jobs')
  check(data.sample.sufficient === false, '无岗位：sufficient = false')
  check(data.dimensions.every((d) => d.items.length === 0), '无岗位：所有维度 items 为空')
  check(data.dimensions.length === 4, '无岗位：四个维度仍然如实列出（不是整块消失）')
}

{
  // 只有标题的岗位一律不计入 —— 原型口径：「另有 61 条来源平台只给了标题，不参与计数」
  const rows = Array.from({ length: 20 }, () => row({ description: null, requirements: '   ' }))
  const data = run(rows)
  check(data.sample.matchedTotal === 20, '只有标题：matchedTotal 如实报 20')
  check(data.sample.countedTotal === 0, '只有标题：countedTotal = 0')
  check(data.sample.titleOnlyTotal === 20, '只有标题：titleOnlyTotal = 20')
  check(data.sample.issue === 'no_readable_jobs', '只有标题：issue = no_readable_jobs')
  check(data.dimensions.every((d) => d.items.length === 0), '只有标题：所有维度 items 为空')
}

{
  // 边界：正好差 1 条到门槛
  const n = JOB_REQUIREMENT_MIN_SAMPLE_SIZE - 1
  const rows = Array.from({ length: n }, () => row({ educationRequirement: '本科及以上' }))
  const data = run(rows)
  check(data.sample.countedTotal === n, `样本 ${n} 条：countedTotal 如实报 ${n}`)
  check(data.sample.sufficient === false, `样本 ${n} 条：sufficient = false`)
  check(data.sample.issue === 'below_min_sample', `样本 ${n} 条：issue = below_min_sample`)
  check(data.sample.minSampleSize === JOB_REQUIREMENT_MIN_SAMPLE_SIZE, '样本不足时如实回门槛值，前端可解释「差多少」')
  check(dim(data, 'education').statedCount === n, `样本 ${n} 条：statedCount 仍如实回 ${n}`)
  check(data.dimensions.every((d) => d.items.length === 0), `样本 ${n} 条：所有维度 items 为空 —— 不给看起来像统计结果的数字`)
}

{
  // 边界：正好达到门槛
  const rows = Array.from({ length: JOB_REQUIREMENT_MIN_SAMPLE_SIZE }, () => row({ educationRequirement: '本科及以上' }))
  const data = run(rows)
  check(data.sample.sufficient === true, `样本 ${JOB_REQUIREMENT_MIN_SAMPLE_SIZE} 条：sufficient = true`)
  check(data.sample.issue === null, '达到门槛：issue = null')
  check(countOf(data, 'education', 'bachelor') === JOB_REQUIREMENT_MIN_SAMPLE_SIZE, '达到门槛：学历分布才出现')
}

console.log('\n[B2] 单维度样本不足：整批够、这一维不够，照样不给数字')

{
  const rows = [
    ...BASELINE.map(() => row({ educationRequirement: '本科及以上', skillsJson: '[]', requirements: '踏实肯干。' })),
    ...Array.from({ length: JOB_REQUIREMENT_MIN_STATED_COUNT - 1 }, () => row({
      educationRequirement: '本科及以上',
      requirements: '踏实肯干，持健康证。',
    })),
  ]
  const data = run(rows)
  check(data.sample.sufficient === true, '整批样本充足')
  const cert = dim(data, 'certificate')
  check(cert.statedCount === JOB_REQUIREMENT_MIN_STATED_COUNT - 1, `证书维度 statedCount = ${JOB_REQUIREMENT_MIN_STATED_COUNT - 1}（如实）`)
  check(cert.sufficient === false, '证书维度 sufficient = false')
  check(cert.issue === 'below_min_stated', '证书维度 issue = below_min_stated')
  check(cert.items.length === 0, '证书维度 items 为空 —— 不给「4 条要健康证」这种数字')
  check(dim(data, 'education').sufficient === true, '同一响应里学历维度照常给分布（不是一刀切全关）')
  const skill = dim(data, 'skill')
  check(skill.statedCount === 0 && skill.items.length === 0 && skill.sources.length === 0, '无人填技能标签：statedCount 0、来源为空、不给分布')
}

console.log('\n[B3] 计数本身：数出来的必须是岗位正文里真有的')

{
  const rows = [
    ...Array.from({ length: 6 }, () => row({ requirements: '大专及以上学历，本科优先。' })),
    ...Array.from({ length: 5 }, () => row({ requirements: '本科及以上，硕士优先。' })),
    ...Array.from({ length: 2 }, () => row({ requirements: '博士研究生学历。' })),
  ]
  const data = run(rows)
  check(countOf(data, 'education', 'college') === 6, '「大专及以上，本科优先」按最低学历记入大专')
  check(countOf(data, 'education', 'bachelor') === 5, '「本科及以上，硕士优先」按最低学历记入本科')
  check(countOf(data, 'education', 'doctor') === 2, '「博士研究生」记入博士，不被「研究生」拉低到硕士')
  check(dim(data, 'education').sources.join() === 'text', '字段为空时来源如实标为 text')
}

{
  // 真实 seed（prisma/seed.ts 初中数学教师那条）里踩到过的坑，文本原样照抄：
  // 任职要求以「…普通话二级甲等以上。」结尾，紧接着描述写「承担初中数学教学」。
  // 「初中」的邻域窗口跨句够到了上一句句尾的「以上」，于是这条本科岗被判成「初中及以下」。
  // 两道防线各挡一半：切句读（窗口不跨句）+ 要求旁证（岗位内容里的档位词不算要求）。
  const rows = Array.from({ length: 12 }, () => row({
    requirements: '数学相关专业本科及以上，持教师资格证，普通话二级甲等以上。',
    description: '承担初中数学教学与班级管理，参与教研与课程设计。',
    educationRequirement: null,
  }))
  const data = run(rows)
  check(countOf(data, 'education', 'junior_high_or_below') === 0, '「承担初中数学教学」不被当成学历要求（跨句取证已挡住）')
  check(countOf(data, 'education', 'bachelor') === 12, '同一条岗位仍按任职要求里的「本科及以上」记入本科')
}

{
  // 旁证要求带来的代价：没有量词的写法会漏掉。写成断言，别让它变成隐形假设。
  const rows = Array.from({ length: 12 }, () => row({ requirements: '要求本科，踏实肯干。', educationRequirement: null }))
  const data = run(rows)
  check(dim(data, 'education').statedCount === 0, '已知代价：正文里「要求本科」没有「及以上/学历」旁证，宁可漏算不误算')
  check(dim(data, 'education').note.includes('宁可少算不多算'), '学历维度 note 披露了这条取舍')
}

{
  // 结构化字段路径不需要旁证：字段本身就是「学历要求」
  const rows = Array.from({ length: 12 }, () => row({ educationRequirement: '本科' }))
  const data = run(rows)
  check(countOf(data, 'education', 'bachelor') === 12, '结构化字段裸值「本科」直接归类，不要求旁证')
}

{
  const rows = [
    ...Array.from({ length: 5 }, () => row({ requirements: '2026 届毕业生，专业不限。' })),
    ...Array.from({ length: 4 }, () => row({ requirements: '有 2 年以上前端项目经验。' })),
    ...Array.from({ length: 3 }, () => row({ requirements: '工作经验不限，可接受应届。' })),
  ]
  const data = run(rows)
  check(countOf(data, 'experience', 'y1_3') === 4, '「2 年以上…经验」记入 1–3 年')
  check(countOf(data, 'experience', 'unlimited') === 3, '「工作经验不限」记入经验不限')
  check(dim(data, 'experience').statedCount === 7, '「2026 届」没有经验锚点，不被当成经验要求')
}

{
  // 锚点窗口的真正用途（**同一句之内**，切句读挡不住的那一半）：
  // 一整句里既有「经验」二字，又有几十字外的公司成立年份。窗口一旦放开，
  // 「成立于 2008 年」会被读成「要求 2008 年经验」→ 10 年以上。
  const rows = Array.from({ length: 12 }, () => row({
    requirements: '欢迎有相关经验的同学加入这家成立于 2008 年的自动化设备公司',
    description: null,
  }))
  const data = run(rows)
  check(dim(data, 'experience').statedCount === 0, '同句内锚点窗口外的年份（「成立于 2008 年」）不计为经验要求')
  check(dim(data, 'experience').items.length === 0, '没有可信年限时该维度不给分布')
}

{
  const rows = [
    ...Array.from({ length: 7 }, () => row({ requirements: '持电工证，需高处作业证。' })),
    ...Array.from({ length: 5 }, () => row({ requirements: '有电工证优先，无需提供健康证。' })),
  ]
  const data = run(rows)
  check(countOf(data, 'certificate', 'electrician') === 12, '电工证按岗位条数计（两组都命中）')
  check(countOf(data, 'certificate', 'work_at_height') === 7, '高处作业证只在真写了的 7 条里计')
  check(countOf(data, 'certificate', 'health') === 0, '「无需提供健康证」被前置否定词挡掉，不计为一条要求')
  check(dim(data, 'certificate').statedCount === 12, '证书 statedCount 按「写了任一证书的岗位数」计，不是命中之和')
}

{
  // 已知局限，写成断言而不是留在脑子里：否定词只看关键词**之前**的一小段。
  // 前置检查会误伤「持健康证；无需体检」这类正常要求，所以刻意不做后置检查 ——
  // 代价是「健康证无需提供」这种后置否定会被计入。维度 note 里已如实写明「本机不做语义区分」。
  const rows = Array.from({ length: 12 }, () => row({ requirements: '健康证无需提供。' }))
  const data = run(rows)
  check(countOf(data, 'certificate', 'health') === 12, '已知局限：后置否定（「健康证无需提供」）仍会被计入，口径已在 note 中披露')
  check(dim(data, 'certificate').note.includes('否定词'), '证书维度 note 说明了否定词处理方式')
}

{
  // 同一岗位内同一证书写两遍只算一条
  const rows = Array.from({ length: 12 }, () => row({
    requirements: '需电工证；电工证需在有效期内。',
    description: '持电工证者优先。',
  }))
  const data = run(rows)
  check(countOf(data, 'certificate', 'electrician') === 12, '同一岗位重复出现的证书只计一次')
}

{
  const rows = Array.from({ length: 12 }, (_, i) => row({
    skillsJson: i < 9 ? '["PLC","plc","SolidWorks"]' : '["UG/NX"]',
  }))
  const data = run(rows)
  check(countOf(data, 'skill', 'plc') === 9, '技能大小写归一后同一岗位只计一次')
  check(countOf(data, 'skill', 'solidworks') === 9, 'SolidWorks 计 9 条')
  check(countOf(data, 'skill', 'ug/nx') === 3, '不做同义合并：UG/NX 独立计数')
  const items = dim(data, 'skill').items
  check(items[0]!.count >= items[items.length - 1]!.count, '技能 items 按条数降序')
  check(dim(data, 'skill').sources.join() === 'field', '技能只认结构化字段，来源标 field')
}

console.log('\n[B4] 口径元数据：样本描述必须够前端如实说明')

{
  const rows = [
    ...Array.from({ length: 8 }, () => row({ sourceOrgId: 'org-1', syncTime: new Date('2026-08-01T00:00:00.000Z') })),
    ...Array.from({ length: 4 }, () => row({ sourceOrgId: 'org-2', syncTime: new Date('2026-08-09T07:30:00.000Z') })),
    ...Array.from({ length: 3 }, () => row({ sourceOrgId: 'org-3', description: null, requirements: null })),
  ]
  const data = run(rows, 900)
  check(data.sample.countedTotal === 12 && data.sample.titleOnlyTotal === 3, '正文/只有标题分别计数')
  check(data.sample.sourceOrgCount === 2, '来源机构数只数进入计数的那批（只有标题的 org-3 不算）')
  check(data.sample.latestSyncTime === '2026-08-09T07:30:00.000Z', '同步时间取计数样本里最近的一条')
  check(data.sample.truncated === true, 'matchedTotal 大于取回条数时如实标 truncated')
  check(data.sample.scanLimit === JOB_REQUIREMENT_SCAN_LIMIT, '如实回单次扫描上限')
  check(run(rows, 15).sample.truncated === false, '未截断时 truncated = false')
  check(data.evidenceLevel === 'E2', '响应证据分级为 E2')
  check(data.boundaryNotes.length >= 4 && data.boundaryNotes.some((n) => n.includes('不是市场需求')), '响应随表带边界说明')
  check(data.dimensions.every((d) => d.note.trim().length > 0), '每个维度都带口径说明，前端不用自己发明措辞')
  check(data.rulesVersion.length > 0 && data.certificateDictionaryVersion.length > 0, '口径版本与证书词典版本可读')
}

{
  // 结构化字段有值但本机归类不了 —— 必须如实进「未归类」，不能静默丢掉
  const rows = Array.from({ length: 12 }, () => row({ educationRequirement: '同等学力可议' }))
  const data = run(rows)
  check(dim(data, 'education').statedCount === 12, '字段有值即算「写了」')
  check(countOf(data, 'education', 'unclassified') === 12, '归类不了的取值进「未归类」，不静默丢弃')
  check(dim(data, 'education').sources.join() === 'field', '字段优先时来源标 field')
}

console.log(`\n岗位要求计数门禁全部通过：${passCount} PASS`)
