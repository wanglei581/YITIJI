/**
 * Partner /stats 契约与诚实性门禁（C1，2026-08-16）
 *
 * 守两件事：
 *  A. 前端 adapter 与 `GET /partner/stats` 的契约不再破损
 *     —— 不发 timezone（会被 forbidNonWhitelisted 拒成 400）、
 *        不取 body.data（orgs 模块控制器返回裸对象）。
 *  B. 页面不伪造能力
 *     —— 浏览、打开来源入口和资料打印还不能按本机构统计时，写明不显示这些数字，而不是编一个漏斗；
 *        曝光/跳转不得写成投递/预约/意向/简历；
 *        空态必须给出原因与下一步，不是一句「暂无数据」。
 *
 *  D. 终端数据页（2026-09-29）：/terminals 只读 GET /partner/terminal-operations，
 *     http 模式不出演示数据；服务人次、AI 可用率照实「暂不能统计」；导出 CSV 共用转义。
 *
 * 后端侧（DTO 白名单 / 信封 / 跨租户 / 运行时形状）由
 * `pnpm --filter @ai-job-print/api verify:partner-stats-contract` 覆盖。
 *
 * Run: pnpm --filter @ai-job-print/partner verify:partner-stats-contract
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const repoRoot = join(root, '..', '..')

function fail(message) {
  console.error(`FAIL ${message}`)
  process.exit(1)
}

function pass(message) {
  console.log(`PASS ${message}`)
}

function read(path, base = root) {
  const full = join(base, path)
  if (!existsSync(full)) fail(`missing ${path}`)
  return readFileSync(full, 'utf8')
}

function mustContain(path, tokens, message, base = root) {
  const text = read(path, base)
  const missing = tokens.filter((token) => !text.includes(token))
  if (missing.length) fail(`${message}; missing=${missing.join(', ')}`)
  pass(message)
}

function mustNotContain(path, tokens, message, base = root) {
  const text = read(path, base)
  const hit = tokens.find((token) => text.includes(token))
  if (hit) fail(`${message}; hit=${hit}`)
  pass(message)
}

/**
 * 去掉行注释与块注释后的源码。
 * 契约类断言（发不发某个参数、解不解某个字段）必须只看真正会执行的代码——
 * 否则解释「为什么不再发 timezone」的注释本身会把断言打挂。
 */
function readCode(path, base = root) {
  return read(path, base)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\/\/.*$/, ''))
    .join('\n')
}

function codeMustNotContain(path, tokens, message, base = root) {
  const code = readCode(path, base)
  const hit = tokens.find((token) => code.includes(token))
  if (hit) fail(`${message}; hit=${hit}`)
  pass(message)
}

const ADAPTER = 'src/services/api/stats.ts'
const PAGE = 'src/routes/stats/index.tsx'
const DASHBOARD = 'src/routes/dashboard/index.tsx'

console.log('\n=== Partner /stats 契约与诚实性门禁 ===')

mustContain('package.json', ['"verify:partner-stats-contract"'], '0. Partner package 注册 /stats 契约门禁')

// ── A. 契约 ────────────────────────────────────────────────────────────────

// A1. 不再发送 timezone：服务端 DTO 只白名单 period，多发即 400 VALIDATION_FAILED
codeMustNotContain(
  ADAPTER,
  ['timezone=', 'timezone%3D', 'Asia%2FShanghai'],
  'A1. adapter 不再向 /partner/stats 发送 timezone 查询参数',
)
mustContain(
  ADAPTER,
  ['/partner/stats?period=${period}`'],
  'A1b. adapter 请求串只带 period 一个参数',
)
mustContain(
  ADAPTER,
  ['pendingReviewJobs', 'pendingReviewFairs', 'pendingReviewPolicies', 'pendingReviewCompanies'],
  'A1c. snapshot 类型含 pending+reviewing 分类型字段',
)

// A2. 不再解包 body.data：orgs 模块控制器一律返回裸对象
codeMustNotContain(
  ADAPTER,
  ['body.data', '{ data: PartnerStatsResponse }'],
  'A2. adapter 不再按 ApiResponse 信封解包 body.data',
)
mustContain(
  ADAPTER,
  ['await res.json() as PartnerStatsResponse'],
  'A2b. adapter 直接把裸对象作为响应体',
)

// A3. 时区改由服务端声明，且前端类型与 demo 数据同步跟上
mustContain(
  ADAPTER,
  ['timezone: string', 'StatsAttribution', 'minSampleThreshold', 'pendingReview'],
  'A3. adapter 类型覆盖服务端声明的 timezone / 归因 / 待审核字段',
)

// ── B. 诚实性 ──────────────────────────────────────────────────────────────

// B1. 空壳已真正被替换（旧占位文案必须消失）
mustNotContain(
  PAGE,
  ['统计报表本阶段不开放', '假报表', '功能建设中', '敬请期待'],
  'B1. /stats 页不再是占位空壳',
)

// B2. 页面确实消费真实接口
mustContain(
  PAGE,
  ['getPartnerStats', 'data.snapshot', 'data.sync', 'data.trend', 'data.statusDist'],
  'B2. /stats 页消费 getPartnerStats 的真实字段',
)

// B3. 不伪造漏斗：归因不可用时如实标注，且不得引入 FunnelCard 画一个出来
mustContain(
  PAGE,
  ['还不能按本机构统计', '这里不显示这些数字'],
  'B3. 浏览与跳转还不能按本机构统计时，页面如实说明不显示这些数字',
)
codeMustNotContain(
  PAGE,
  ['FunnelCard', 'funnel'],
  'B3b. /stats 页不引入漏斗组件伪造转化链路',
)

// B4. 合规文案：曝光/跳转不得写成投递/预约/意向/简历口径
mustNotContain(
  PAGE,
  ['一键投递', '立即投递', '平台投递', '投递数', '投递量', '意向数', '简历数', '预约数', '候选人'],
  'B4. /stats 页不把曝光/跳转写成投递/预约/意向/简历口径',
)
mustContain(
  PAGE,
  ['不做平台内投递', '不代表投递结果'],
  'B4b. /stats 页显式声明「打开来源平台」不等于投递结果',
)

// B5. N≥5 最小样本 + 只给机构级聚合
mustContain(
  PAGE,
  ['不列出求职者个人'],
  'B5. /stats 页声明不列出求职者个人',
)

// B6. 空态必须解释原因并给下一步，而不是一句「暂无数据」
mustContain(
  PAGE,
  ['去数据源配置', '查看同步日志', '没有启用中的数据源', '审核发布入口尚未开放（平台不代审、不代发）'],
  'B6. /stats 空态给出原因与下一步动作',
)
mustNotContain(
  PAGE,
  ['暂无数据<', '>暂无数据'],
  'B6b. /stats 页不使用无信息量的「暂无数据」空态',
)

// B7. 无可比基期照实说明，不显示 ∞% 也不伪造 0%
mustContain(
  PAGE,
  ['无可比基期', 'deltaPercent === null'],
  'B7. 无可比基期时如实说明，不伪造环比',
)

// B8. PTR-15：无归因数据时不承诺「效果」
mustContain(
  PAGE,
  ["withFrontendHint('同步概况'", '还不能按本机构统计'],
  'B8. /stats 副标题为「同步概况」，浏览与跳转仍如实说明还不能按本机构统计',
)
mustNotContain(
  PAGE,
  ['产生了什么效果', '同步效果', '曝光与跳转效果'],
  'B8b. /stats 页不承诺效果或曝光漏斗',
)

// B9. PTR-13：工作台「待审核」与统计页同一服务端口径 snapshot.pendingReview
mustContain(
  DASHBOARD,
  ['getPartnerStats', 'stats.snapshot', 'pendingReview'],
  'B9. 工作台待审核数取自 GET /partner/stats snapshot.pendingReview',
)
mustNotContain(
  DASHBOARD,
  ['data.pendingTotal', 'pendingTotal }'],
  'B9b. 工作台待审核标题不再使用 dashboard.pendingTotal',
)
mustContain(
  DASHBOARD,
  ['snapshot.pendingReviewJobs', 'snapshot.pendingReviewFairs', 'snapshot.pendingReviewPolicies', 'firstPendingPath(snapshot)'],
  'B9c. 去查看跳转与计数同用 snapshot 的 pending+reviewing 分类型字段',
)
mustNotContain(
  DASHBOARD,
  ['data.jobs.pending > 0', 'data.fairs.pending > 0', 'data.policies.pending > 0'],
  'B9d. firstPendingPath 不再按 dashboard 的 pending-only 计数跳转',
)

// ── C. 与 honest-placeholders 门禁的交接 ───────────────────────────────────

const HONEST = 'apps/admin/scripts/verify-honest-placeholders.mjs'
mustNotContain(
  HONEST,
  ["join(repoRoot, 'apps/partner/src/routes/stats/index.tsx')"],
  'C1. honest-placeholders 已摘除 /stats 空壳钉子',
  repoRoot,
)
mustContain(
  HONEST,
  [
    "join(adminRoot, 'src/routes/peripherals/index.tsx')",
    "join(adminRoot, 'src/routes/permissions/index.tsx')",
    "join(repoRoot, 'apps/partner/src/routes/terminals/index.tsx')",
    "join(repoRoot, 'apps/partner/src/routes/account/index.tsx')",
  ],
  'C2. honest-placeholders 仍钉住其余四页',
  repoRoot,
)
// 2026-09-29：/terminals 接真后改钉「读真实接口、http 模式不出演示数据」，不再钉空壳文案
mustContain(
  HONEST,
  [
    "'getPartnerTerminalOperations'",
    "join(repoRoot, 'apps/partner/src/services/api/terminalOps.ts')",
    `"if (API_MODE !== 'http') return buildDemoTerminalOps(period)"`,
    "exactCount: { 'buildDemoTerminalOps(': 2 }",
  ],
  'C3. honest-placeholders 对 /terminals 改钉真实接口与「http 不出演示数据」',
  repoRoot,
)
mustNotContain(
  HONEST,
  ['终端明细暂由平台统一运营'],
  'C3b. honest-placeholders 不再要求 /terminals 保留空壳文案',
  repoRoot,
)

// ── D. 终端数据页（/terminals ↔ GET /partner/terminal-operations）───────────

const OPS_ADAPTER = 'src/services/api/terminalOps.ts'
const OPS_PAGE = 'src/routes/terminals/index.tsx'
const OPS_CARDS = 'src/routes/terminals/TerminalOpsCards.tsx'
const OPS_FORMAT = 'src/routes/terminals/terminalOpsFormat.ts'

mustContain(
  OPS_ADAPTER,
  ['/partner/terminal-operations?period=${period}`', 'await res.json()) as PartnerTerminalOpsResponse'],
  'D1. adapter 请求串只带 period，直接取裸对象',
)
codeMustNotContain(
  OPS_ADAPTER,
  ['orgId', 'terminalId', 'timezone=', 'body.data', 'consoleScreen'],
  'D1b. adapter 不发送机构 / 终端 / 时区参数，不借用数据大屏服务',
)
mustContain(
  OPS_ADAPTER,
  ["if (API_MODE !== 'http') return buildDemoTerminalOps(period)", 'return fetchTerminalOps(period)', "dataMode: 'demo'"],
  'D2. http 模式只走真实接口；演示数据只在 mock 模式出现且带 demo 标记',
)
mustContain(
  OPS_PAGE,
  ['getPartnerTerminalOperations', 'FRONTEND_HINT.terminals', "data.dataMode === 'demo'", '本机构还没有绑定终端', '终端由平台绑定后这里会显示运营数据', 'downloadCsv', 'buildTerminalOpsCsv'],
  'D3. 页面消费真实接口、演示数据有标注、空态说明由平台绑定、导出走共用 CSV',
)
mustContain(
  OPS_CARDS,
  ['暂不能统计', '打印扫描服务次数', '不等于人次', '暂不能按本机构终端统计', '出纸成功率', '故障与恢复'],
  'D4. 四张指标卡：服务人次与 AI 可用率照实「暂不能统计」，服务次数写明不等于人次',
)
mustContain(
  OPS_FORMAT,
  ['统计窗口', '服务人次', 'AI 可用率', 'METRIC_NOTES.sample', "value === null ? '样本不足，不显示'"],
  'D5. 导出 CSV 表头前写统计窗口与两项「暂不能统计」原因；1–4 不显示具体数字',
)
mustContain(
  'src/lib/csv.ts',
  ['\\uFEFF', "split('\"').join('\"\"')", 'FORMULA_LEAD'],
  'D6. 共用 CSV：UTF-8 BOM、双引号转义、公式注入防护',
)
mustContain(
  'src/services/api/partnerMockAdapter.ts',
  ["import { escapeCsvCell } from '../../lib/csv'"],
  'D6b. 模板下载与终端数据导出共用同一个单元格转义',
)
codeMustNotContain(
  'src/services/api/partnerMockAdapter.ts',
  ['function escapeCsvCell'],
  'D6c. mock adapter 不再保留私有转义',
)
for (const file of [OPS_PAGE, OPS_CARDS, OPS_FORMAT, 'src/routes/terminals/TerminalOpsDrawer.tsx']) {
  mustNotContain(
    file,
    ['一键投递', '立即投递', '平台投递', '投递数', '简历数', '候选人', '手机号', 'endUserId'],
    `D7. ${file} 不出现投递 / 简历 / 个人口径`,
  )
}
mustContain(
  'src/layouts/PartnerLayoutWrapper.tsx',
  ["'/terminals':  'terminals'", "label: '终端数据'"],
  'D8. 侧栏「数据与账号」组有「终端数据」入口',
)

console.log('\nALL PASS')
