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
 *   F. 【2026-08-11 新增】不得编造校方信息、不得声称校方授权:
 *      本轮审查发现迎新页硬编码四个办事窗口含具体楼栋位置(「行政楼 1F」「东门内 50m」),
 *      并打「校方官方指引」徽标——这些位置不来自任何学校,构成编造校方信息 + 不实接入暗示。
 *      服务页同样编造楼层并声称「校方合作」;智慧校园首页称「校方授权的官方校园服务入口」;
 *      首页横排标「校方已开启」(该开关平台 Admin 同样可设置,不能单独归因给校方)。
 *      本维度把这些钉死为断言,防止随设计稿改版重新引入。
 *      恢复条件:CampusInfoEdition / CampusServiceWindow 模型落地 + 学校在 Partner 后台配置并审核发布。
 *
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
mustContain(
  'src/pages/home/HomePage.tsx',
  ['功能保留 · 当前未开启', "to: '/smart-campus'"],
  'D2 智慧校园一级入口常驻，默认关闭时展示真实锁定态',
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

// ── F. Phase 0 S0-A A2：「已开通」口径真实性 ────────────────────────────────
// 静态指引 cards（迎新/行李/VR/校园卡等）只是说明页，不得计为「本校已开通服务」。
// 仅 config.items → extensionItems 中经校方配置且真实可启动的项可称「已配置入口」；
// 无扩展项时不得暗示系统已接通。
mustNotContain(
  CAMPUS_PAGE,
  ['本校已开通', 'cards.length + extensionItems.length'],
  'F1 不得用 cards.length + extensionItems.length 生成「本校已开通 X 项服务」',
)
mustContain(
  CAMPUS_PAGE,
  ['可查看指引', '已配置入口'],
  'F2 静态页称「可查看指引」、扩展项称「已配置入口」须区分',
)
// F3. enabled===false 时不得展示「可查看指引 0 项」徽章（与页面「本机暂未开启」空态重复）。
// 要求：statusBadge 在 !config.enabled 时为 null，且 badge 仅在 statusBadge 有值时渲染。
mustContain(
  CAMPUS_PAGE,
  ['!config.enabled', '? null', 'badge={statusBadge ?'],
  'F3 enabled===false 时 statusBadge 为 null，不渲染 header badge（避免「可查看指引 0 项」）',
)

// ── G. 不得编造校方信息 / 不得声称校方授权（2026-08-11 新增） ──
function mustNotContainOutsideComments(rel, markers, label) {
  const src = read(rel)
  if (src === null) { fail(`${label} — 文件缺失: ${rel}`); return }
  // 整块剥离 JSX 注释 {/* ... */} 与块注释，再剥离行注释——
  // 注释中保留原文用于说明修正原因与恢复条件，不应因此 FAIL。
  const visible = src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n')
  const hits = markers.filter((m) => visible.includes(m))
  if (hits.length > 0) fail(`${label} — ${rel} 用户可见文案出现违规标记: ${hits.join(' | ')}`)
  else pass(label)
}
// 说明：本组断言针对「前端声称、后端无来源」的伪造能力（CLAUDE.md §9）。
// 编造的楼栋位置一旦重新出现，说明有人又把设计稿里的占位文案当真实数据落地了。
const FABRICATED_CAMPUS_LOCATIONS = ['行政楼 1F', '行政楼 2F', '综合楼 1F', '东门内 50m', '行政楼一层', '宿舍楼一层']
// 2026-08-11 追加「校方审核」「校方配置」：扩展应用审核接口仅限平台管理员
//（admin-toolbox.controller.ts:28,149），系统无校方审批角色与记录；
// 智慧校园开关与扩展投放平台 Admin 同样可设置，均不能单独归因给校方。
const FAKE_SCHOOL_ENDORSEMENT = ['校方官方指引', '校方官方信息入口', '校方授权', '校方合作', '校方已开启', '校方审核', '校方配置']

// 注：注释中保留原文用于说明修正原因，因此统一只检查「用户可见文案」。
mustNotContainOutsideComments(
  'src/pages/smart-campus/SmartCampusWelcomePage.tsx',
  FABRICATED_CAMPUS_LOCATIONS,
  'G1 迎新页不得出现编造的办事窗口楼栋位置',
)
mustNotContainOutsideComments(
  'src/pages/smart-campus/SmartCampusServicePage.tsx',
  FABRICATED_CAMPUS_LOCATIONS,
  'G2 智慧校园服务页不得出现编造的楼层位置',
)

for (const [rel, label] of [
  ['src/pages/smart-campus/SmartCampusWelcomePage.tsx', 'G3 迎新页'],
  ['src/pages/smart-campus/SmartCampusServicePage.tsx', 'G4 智慧校园服务页'],
  ['src/pages/smart-campus/SmartCampusHomePage.tsx', 'G5 智慧校园专区首页'],
  ['src/pages/home/HomePage.tsx', 'G6 一体机首页'],
]) {
  mustNotContainOutsideComments(rel, FAKE_SCHOOL_ENDORSEMENT, `${label}不得声称校方授权 / 校方官方 / 校方已开启`)
}

// F7：子页必须走统一门禁——关闭开关或机器搬离校园后，深链接不得残留校园内容
mustContain('src/routes/index.tsx', ['SmartCampusGuard'], 'G7 智慧校园子路由必须包 SmartCampusGuard')
mustContain(
  'src/pages/smart-campus/SmartCampusGuard.tsx',
  ['config.enabled', '本机暂未开启智慧校园服务'],
  'G8 SmartCampusGuard 校验总开关并给出真实空态',
)

console.log('')
if (failed > 0) {
  console.error(`❌ ${failed} 项失败 — 智慧校园 bigdata 冻结校验未通过\n`)
  process.exit(1)
}
console.log('✅ ALL PASS — 智慧校园 bigdata 严格冻结、前台无假数据、扩展应用可启动、无编造校方信息\n')
