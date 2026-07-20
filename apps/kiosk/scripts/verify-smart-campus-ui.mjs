/**
 * 智慧校园 · bigdata 严格冻结 / 前台无假数据 守卫。
 *
 * 背景:智慧校园「校园大数据」本期严格冻结——既不在任何入口展示,直达 URL 也只能见
 * 「未开放」真实状态,绝不展示示例 / 演示 / 假统计。本脚本把这些约束钉死为断言,
 * 任何分支误把 bigdata 入口或 mock 聚合数据加回前台,立即 FAIL。
 *
 * 检查维度:
 *   A. /smart-campus/freshman-insights 页面:只展示「未开放」,不含任何 mock 数据来源或示例统计。
 *   B. mock 聚合数据服务 freshmanInsights.ts 已物理删除。
 *   C. 智慧校园专区(SmartCampusHomePage)不再列出 bigdata 入口(无 freshman-insights 链接)。
 *   D. 首页(HomePage)智慧校园横排不再列出 bigdata 入口(无 freshman-insights 链接)。
 *   E. smart_campus 投放的扩展应用可启动(回归守卫):共享启动助手承载三种启动;
 *      /smart-campus 消费 config.items 且复用启动助手 + placement=smart_campus 上报;
 *      扩展区受 length>0 门控(无投放项时保持原型 51 态);toolbox 与 campus 两侧同源。
 *
 * 运行:pnpm --filter @ai-job-print/kiosk verify:smart-campus-ui
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

let failed = 0
function pass(msg) { console.log(`  PASS ${msg}`) }
function fail(msg) { console.error(`  FAIL ${msg}`); failed++ }

function read(rel) {
  const p = join(ROOT, rel)
  if (!existsSync(p)) return null
  return readFileSync(p, 'utf8')
}

function mustContain(rel, markers, label) {
  const src = read(rel)
  if (src === null) { fail(`${label} — 文件缺失: ${rel}`); return }
  const missing = markers.filter((m) => !src.includes(m))
  if (missing.length > 0) fail(`${label} — ${rel} 缺少标记: ${missing.join(' | ')}`)
  else pass(label)
}

function mustNotContain(rel, markers, label) {
  const src = read(rel)
  if (src === null) { fail(`${label} — 文件缺失: ${rel}`); return }
  const hits = markers.filter((m) => src.includes(m))
  if (hits.length > 0) fail(`${label} — ${rel} 出现违规标记: ${hits.join(' | ')}`)
  else pass(label)
}

function mustNotExist(rel, label) {
  if (existsSync(join(ROOT, rel))) fail(`${label} — 文件应已删除但仍存在: ${rel}`)
  else pass(label)
}

console.log('\n=== 智慧校园 bigdata 冻结 / 前台无假数据验证 ===')

// ── A. freshman-insights 直达页:只见「未开放」,无任何 mock/示例统计 ──────────
const FRESHMAN_PAGE = 'src/pages/smart-campus/FreshmanInsightsPage.tsx'
mustContain(FRESHMAN_PAGE, ['暂未开放', '返回智慧校园'], 'A1 freshman-insights 直达只展示「未开放」真实状态')
mustNotContain(
  FRESHMAN_PAGE,
  ['getFreshmanInsights', 'MOCK_FRESHMAN', 'isMock', '示例数据', 'topMajors', 'ageDistribution', 'conic-gradient'],
  'A2 freshman-insights 不含任何 mock 数据来源 / 示例统计渲染',
)

// ── B. mock 聚合数据服务已删除 ──────────────────────────────────────────────
mustNotExist('src/services/api/freshmanInsights.ts', 'B mock 聚合数据服务 freshmanInsights.ts 已删除')

// ── C. 智慧校园专区不再列出 bigdata 入口 ────────────────────────────────────
mustNotContain(
  'src/pages/smart-campus/SmartCampusHomePage.tsx',
  ['freshman-insights', "key: 'bigdata'"],
  'C SmartCampusHomePage 不再列出校园大数据入口',
)

// ── D. 首页智慧校园横排不再列出 bigdata 入口 ────────────────────────────────
mustNotContain(
  'src/pages/home/HomePage.tsx',
  ['freshman-insights'],
  'D HomePage 智慧校园横排不再列出校园大数据入口',
)

// ── E. smart_campus 投放的扩展应用可启动（回归守卫）────────────────────────
// 背景：首页 prototype-v1 重写后，后台以 placement=smart_campus 投放的可启动 app
// 一度在前台无处可启动（旧首页可启动、新首页/原型无此设计）。修复为在
// /smart-campus 以「原型外生产动态状态」条件渲染可启动扩展区。以下断言把该能力钉死。
const CAMPUS_PAGE = 'src/pages/smart-campus/SmartCampusHomePage.tsx'
const LAUNCH_HELPERS = 'src/pages/home/components/kioskAppLaunch.ts'

// E1. 共享启动助手存在且承载三种启动分发（站内/外链/二维码），根因（逻辑私有于 toolbox）已消除。
mustContain(
  LAUNCH_HELPERS,
  ['launchKioskAppItem', 'itemLaunchable', 'itemBadge', 'internal_route', 'external_url', 'qr_code'],
  'E1 共享启动助手 kioskAppLaunch 承载站内/外链/二维码分发',
)

// E2. /smart-campus 消费 config.items 并复用共享启动助手（每个配置项可启动）。
mustContain(
  CAMPUS_PAGE,
  ['config.items', 'launchKioskAppItem', 'itemLaunchable', 'extensionItems'],
  'E2 SmartCampusHomePage 消费 config.items 并复用共享启动助手（可启动）',
)

// E3. 事件上报未丢失：复用 placement=smart_campus 的启动弹窗（离场确认 + 匿名上报）。
mustContain(
  CAMPUS_PAGE,
  ['QrLaunchModal', 'ExternalLaunchModal', 'placement="smart_campus"'],
  'E3 事件上报未丢失（Qr/External 弹窗 placement=smart_campus）',
)

// E4. 无扩展项 = 原型 51 态：扩展区受 extensionItems.length > 0 条件门控，不污染标准验收态。
mustContain(
  CAMPUS_PAGE,
  ['extensionItems.length > 0'],
  'E4 无扩展项时保持原型51态（扩展区由 length>0 条件门控）',
)

// E5. 启动弹窗组件为 placement 无关共享件，smart_campus 与 toolbox 同源，避免再次发散。
mustContain(
  'src/pages/toolbox/ToolboxZonePage.tsx',
  ["from '../home/components/kioskAppLaunch'"],
  'E5 ToolboxZonePage 亦从共享助手导入（两侧同源不发散）',
)

console.log('')
if (failed > 0) {
  console.error(`❌ ${failed} 项失败 — 智慧校园 bigdata 冻结校验未通过\n`)
  process.exit(1)
}
console.log('✅ ALL PASS — 智慧校园 bigdata 严格冻结、前台无假数据、smart_campus 扩展应用可启动\n')
