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
 *   E. Admin 总开关联动子模块:开启时自动勾选迎新,关闭时清空子模块,避免"保存成功但入口不显示"。
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

// ── E. Admin 总开关必须联动子模块，避免保存 enabled=true 但后端归零 ────────
mustContain(
  '../admin/src/routes/smart-campus/index.tsx',
  ['toggleEnabled', 'welcome: true', 'welcome: false', 'panorama: false'],
  'E Admin 总开关联动子模块，避免无子模块时入口不显示',
)

console.log('')
if (failed > 0) {
  console.error(`❌ ${failed} 项失败 — 智慧校园 bigdata 冻结校验未通过\n`)
  process.exit(1)
}
console.log('✅ ALL PASS — 智慧校园 bigdata 严格冻结、前台无假数据\n')
