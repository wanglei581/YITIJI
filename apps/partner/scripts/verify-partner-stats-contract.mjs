/**
 * Partner /stats 契约与诚实性门禁（C1，2026-08-16）
 *
 * 守两件事：
 *  A. 前端 adapter 与 `GET /partner/stats` 的契约不再破损
 *     —— 不发 timezone（会被 forbidNonWhitelisted 拒成 400）、
 *        不取 body.data（orgs 模块控制器返回裸对象）。
 *  B. 页面不伪造能力
 *     —— 归因缺不可变 sourceOrgId 快照时显示「暂无归因数据」而不是编一个漏斗；
 *        曝光/跳转不得写成投递/预约/意向/简历；
 *        空态必须给出原因与下一步，不是一句「暂无数据」。
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
  ['暂无归因数据', 'attribution'],
  'B3. 归因不可用时页面如实标注「暂无归因数据」',
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
  ['minSampleThreshold', '样本不足', '不提供求职者个人明细'],
  'B5. /stats 页声明最小样本阈值且不提供个人明细',
)

// B6. 空态必须解释原因并给下一步，而不是一句「暂无数据」
mustContain(
  PAGE,
  ['去数据源配置', '查看同步日志', '没有启用中的数据源', '等管理员审核'],
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
  'C2. honest-placeholders 仍钉住其余四页空壳',
  repoRoot,
)

console.log('\nALL PASS')
