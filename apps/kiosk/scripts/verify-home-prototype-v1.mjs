// verify-home-prototype-v1 · 首页 prototype-v1 静态合同
//
// 唯一真值来源：docs/design/kiosk-proto-2026-07/01-home.html + shared.css
//（最高真值 = shared.css 基类 + 01-home 局部覆写后的最终渲染；页面覆写 > 基类）。
// 本守卫每条结构断言都从原型文件“派生期望值”再校验实现，禁止把实现值当期望。
// 同时承接旧 verify-home-service-desk 的全部真实能力契约（真实路由 / 禁用入口 /
// 合规文案 / 设备状态诚实 / 登录弹窗 / 动态专区 / 三 Tab / 触控尺寸）。
//
// 取代对象：verify-home-service-desk.mjs（其首页视觉断言因首页整体重建为 prototype-v1
// 而失效，非弱化；本守卫在真实能力上等价或更强）。
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(root, '..', '..')
const read = (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : '')
const readProto = (p) =>
  existsSync(join(repoRoot, 'docs/design/kiosk-proto-2026-07', p))
    ? readFileSync(join(repoRoot, 'docs/design/kiosk-proto-2026-07', p), 'utf8')
    : ''

let failures = 0
const pass = (m) => console.log(`  PASS ${m}`)
const fail = (m) => {
  failures += 1
  console.error(`  FAIL ${m}`)
}
const expect = (cond, m) => (cond ? pass(m) : fail(m))
const escapeRegExp = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// 抽取一段 CSS 规则块（selector { ... }）
function cssRule(source, selector) {
  const start = source.indexOf(`${selector} {`) >= 0 ? source.indexOf(`${selector} {`) : source.indexOf(`${selector}{`)
  if (start < 0) return ''
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1)
  }
  return ''
}
function pxProp(rule, prop) {
  const m = rule.match(new RegExp(`(?:^|[\\n{;])\\s*${escapeRegExp(prop)}:\\s*(\\d+)px`))
  return m ? Number(m[1]) : null
}

console.log('\n=== 首页 prototype-v1 静态合同（真值：01-home.html + shared.css）===')

const proto = readProto('01-home.html')
const shared = readProto('shared.css')
const home = read('src/pages/home/HomePage.tsx')
const pv = read('src/styles/prototype-v1.css')
const serviceGroups = read('src/pages/home/serviceGroups.ts')
const kioskRoot = read('src/layouts/KioskRoot.tsx')
const icons = read('src/pages/home/prototypeIcons.tsx')
const pkg = read('package.json')

expect(proto.length > 0, '原型 01-home.html 可读（真值锚点存在）')
expect(shared.length > 0, '原型 shared.css 可读（真值锚点存在）')

// ── 从原型派生的结构真值 → 校验实现 ─────────────────────────────
// [1] Topbar 高度：shared.css .topbar { height: N px }
const protoTopbar = pxProp(cssRule(shared, '.topbar'), 'height')
expect(protoTopbar === 76, `原型 shared.css .topbar 高度真值=76（实测 ${protoTopbar}）`)
expect(pxProp(cssRule(pv, '.kpv1 .topbar'), 'height') === protoTopbar, `实现 .kpv1 .topbar 高度对齐原型 ${protoTopbar}px`)

// [2] 登录按钮：01-home .login-btn { min-height:88; border-radius:var(--r-md) }，shared --r-md=18
const protoLogin = pxProp(cssRule(proto, '.login-btn'), 'min-height')
const protoRmd = (shared.match(/--r-md:\s*(\d+)px/) ?? [])[1]
expect(protoLogin === 88, `原型 .login-btn min-height 真值=88（实测 ${protoLogin}）`)
expect(protoRmd === '18', `原型 shared --r-md 真值=18px（实测 ${protoRmd}）`)
expect(pxProp(cssRule(pv, '.kpv1 .login-btn'), 'min-height') === protoLogin, `实现 .kpv1 .login-btn min-height 对齐原型 ${protoLogin}px`)
expect(/\.kpv1 \.login-btn\s*\{[^}]*border-radius:\s*var\(--pv-r-md\)/.test(pv), '实现登录按钮圆角用 --pv-r-md（=原型 r-md 18px）')
expect(/--pv-r-md:\s*18px/.test(pv), '实现 --pv-r-md token=18px 对齐原型')

// [3] tile 高度：shared 基类 .tile=96；01-home 覆写 .groups .tile=76、c1/c2=70、.tile.col=90
const protoTileBase = pxProp(cssRule(shared, '.tile'), 'min-height')
const protoTileGroups = pxProp(cssRule(proto, '.groups .tile'), 'min-height')
const protoTileC2 = pxProp(cssRule(proto, '.tiles.c2 .tile, .tiles.c1 .tile'), 'min-height')
const protoTileCol = pxProp(cssRule(proto, '.tile.col'), 'min-height')
expect(protoTileBase === 96, `原型 shared 基类 .tile min-height 真值=96（实测 ${protoTileBase}）`)
expect(protoTileGroups === 76, `原型 01-home .groups .tile 覆写真值=76（实测 ${protoTileGroups}）`)
expect(protoTileC2 === 70, `原型 01-home c1/c2 .tile 覆写真值=70（实测 ${protoTileC2}）`)
expect(protoTileCol === 90, `原型 01-home .tile.col 覆写真值=90（实测 ${protoTileCol}）`)
expect(pxProp(cssRule(pv, '.kpv1 .tile'), 'min-height') === protoTileBase, `实现基类 .kpv1 .tile min-height 对齐原型 ${protoTileBase}px`)
expect(pxProp(cssRule(pv, '.kpv1 .groups .tile'), 'min-height') === protoTileGroups, `实现 .kpv1 .groups .tile 覆写对齐原型 ${protoTileGroups}px`)
expect(pxProp(cssRule(pv, '.kpv1 .tiles.c2 .tile, .kpv1 .tiles.c1 .tile'), 'min-height') === protoTileC2, `实现 c1/c2 .tile 覆写对齐原型 ${protoTileC2}px`)
expect(pxProp(cssRule(pv, '.kpv1 .tile.col'), 'min-height') === protoTileCol, `实现 .tile.col 覆写对齐原型 ${protoTileCol}px`)

// [4] 卡片品类色：01-home .groups .card::before 左侧竖条 width:6px inset:0 auto 0 0（非顶边 4px）
const protoStripe = cssRule(proto, '.groups .card::before')
expect(/width:\s*6px/.test(protoStripe) && /inset:\s*0 auto 0 0/.test(protoStripe), '原型卡片品类色真值=左侧 6px 竖条（inset:0 auto 0 0）')
const implStripe = cssRule(pv, '.kpv1 .groups .card::before')
expect(/width:\s*6px/.test(implStripe) && /inset:\s*0 auto 0 0/.test(implStripe), '实现卡片品类色=左侧 6px 竖条对齐原型')
expect(!/\.kpv1 \.card[^{]*\{[^}]*border-top:\s*4px/.test(pv), '实现不得用 shared 基类的 4px 顶边（首页已覆写为左侧竖条）')

// [5] 网格列数：01-home .tiles.c3/c2/c1/c5
for (const [cls, cols] of [['c3', 'repeat(3, 1fr)'], ['c2', 'repeat(2, 1fr)'], ['c5', 'repeat(5, 1fr)'], ['c1', '1fr']]) {
  expect(new RegExp(`\\.tiles\\.${cls}\\s*\\{[^}]*grid-template-columns:\\s*${escapeRegExp(cols)}`).test(proto), `原型 .tiles.${cls} 真值=${cols}`)
  expect(new RegExp(`\\.kpv1 \\.tiles\\.${cls}\\s*\\{[^}]*grid-template-columns:\\s*${escapeRegExp(cols)}`).test(pv), `实现 .tiles.${cls} 对齐原型 ${cols}`)
}

// [6] 底部导航高度：shared .navbar { height:116px }
const protoNav = pxProp(cssRule(shared, '.navbar'), 'height')
expect(protoNav === 116, `原型 shared .navbar 高度真值=116（实测 ${protoNav}）`)
expect(pxProp(cssRule(pv, '.kpv1 .navbar'), 'height') === protoNav, `实现 .kpv1 .navbar 高度对齐原型 ${protoNav}px`)

// ── 结构：统一 .tile 网格，废弃 primary/secondary 两级模型 ──────────
expect(home.includes("import '../../styles/prototype-v1.css'"), 'HomePage 导入 prototype-v1 作用域样式')
expect(!home.includes('home-service-desk.css'), 'HomePage 不再导入旧 service-desk 首页样式')
expect(!home.includes('ReferenceServicePanel'), '首页废弃旧 ReferenceServicePanel 两级模型')
expect(!home.includes('ReferenceServiceNav'), '首页停止渲染 ReferenceServiceNav')
expect(!existsSync(join(root, 'src/components/lightflow/ReferenceServiceNav.tsx')), 'ReferenceServiceNav 孤儿组件已删除（全仓零引用）')
expect(!existsSync(join(root, 'src/components/lightflow/reference-service-nav.css')), 'reference-service-nav.css 孤儿样式已删除')
expect(!existsSync(join(root, 'src/components/lightflow/reference-layout.css')), 'reference-layout.css 孤儿样式已删除（唯一 importer 已随组件删除）')
// 旧 .khome 首页样式链整条删除（home-service-desk.css @import 的 shell/services/
// responsive/continuation，及独立孤儿 home-prototype.css）；首页样式唯一来源为 prototype-v1.css。
for (const legacy of [
  'src/pages/home/home-service-desk.css',
  'src/pages/home/styles/home-shell.css',
  'src/pages/home/styles/home-services.css',
  'src/pages/home/styles/home-responsive.css',
  'src/pages/home/styles/home-continuation.css',
  'src/pages/home/styles/home-prototype.css',
]) {
  expect(!existsSync(join(root, legacy)), `旧 .khome 首页样式已删除：${legacy}`)
}
expect(/className="kpv1"/.test(home), '首页根节点使用 .kpv1 作用域')
expect(/<div className="groups"[^>]*aria-label="当前可使用功能"/.test(home), '首页服务区用中性 .groups 网格容器并保留可访问名称')
expect(!/<main className="groups"/.test(home), '首页服务区不在 KioskLayout 主地标内嵌套 main')
expect(/tile\.emphasis === 'primary' \? 'primary' : ''/.test(home), '磁贴 emphasis→.tile.primary（统一网格，无独立次级列表）')
expect(!/home-reference-primary-list|home-reference-secondary-list/.test(home), '首页不再使用 primary/secondary 双列表结构')

// ── 原型文案（1:1）──────────────────────────────────────────────
expect(proto.includes('一趟办完') && /简历、打印、岗位信息<em>一趟办完<\/em>/.test(home), '欢迎区主标题 1:1 原型「简历、打印、岗位信息一趟办完」')
expect(proto.includes('游客可直接使用大部分功能') && home.includes('游客可直接使用大部分功能 · 触摸下方卡片开始'), '欢迎区副标题 1:1 原型文案')
expect(proto.includes('登录 / 注册') && home.includes('登录 / 注册'), '登录按钮文案 1:1 原型「登录 / 注册」')
expect(proto.includes('推荐先做'), '原型含「推荐先做」徽章')
expect(/badge\.label/.test(home) && /group\.badge/.test(home), '首页保留「推荐先做」徽章（来自 serviceGroups.badge）')

// ── 原型外动态状态：登录态复用 88px 登录框，文字改「进入我的」，不显示统计 ──
expect(home.includes('进入我的'), '登录态复用登录框，文字改「进入我的」（原型外动态状态）')
expect(/isLoggedIn \?[\s\S]*?className="login-btn"[\s\S]*?进入我的/.test(home), '登录态入口仍用 .login-btn 88px 外框')
expect(!/id-stats|id-stat\b|stats\.resumes|stats\.documents|stats\.aiRecords/.test(home), '首页不显示原型没有的简历/文档/AI记录统计')

// ── 真实能力：路由 / 禁用入口 / 六组（承接旧守卫，等价或更强）──────
const groupsBlock = serviceGroups.match(/export const SERVICE_GROUPS[\s\S]*?\n\]/)?.[0] ?? ''
expect(home.includes("from './serviceGroups'"), '首页从 serviceGroups 消费真实路由数据')
const groupCount = (groupsBlock.match(/^\s{2,4}id:/gm) ?? []).length
expect(groupCount === 6, `SERVICE_GROUPS 保持六组（实测 ${groupCount}）`)
const expectedRoutes = new Map([
  ['AI简历诊断', '/resume/source?intent=diagnose'], ['AI简历优化', '/resume/source?intent=optimize'],
  ['简历素材库', '/resume/templates'], ['职业规划', '/resume/career-plan'],
  ['简历打印', '/print/upload?source=resume'], ['求职材料', '/resume/materials'],
  ['全职岗位', '/jobs?category=fulltime'], ['实习岗位', '/jobs?category=intern'],
  ['兼职信息', '/jobs?category=parttime'], ['全部岗位', '/jobs'],
  ['找企业', '/companies'], ['岗位大师', '/resume/job-fit'],
  ['社会招聘会', '/job-fairs'], ['校园招聘会', '/campus'], ['扫码签到', '/job-fairs/checkin'],
  ['文档打印', '/print/upload?source=document'], ['纸质扫描', '/scan/start'], ['格式转换', '/print-scan/convert'],
  ['模拟面试', '/interview/setup'], ['面试技巧', '/interview/tips'], ['面试报告', '/interview/reports'],
  ['就业政策', '/renshi?tab=policy'], ['社保指南', '/renshi?tab=social'], ['档案 / 登记', '/renshi?tab=register'],
])
for (const [title, route] of expectedRoutes) {
  const re = new RegExp(`\\{[^{}]*title:\\s*'${escapeRegExp(title)}'[^{}]*to:\\s*'${escapeRegExp(route)}'[^{}]*\\}`)
  expect(re.test(groupsBlock), `真实路由保留：${title} → ${route}`)
}
for (const title of ['证件复印', '证件照打印']) {
  expect(new RegExp(`\\{[^{}]*title:\\s*'${title}'[^{}]*disabled:\\s*Boolean\\(true\\)[^{}]*\\}`).test(groupsBlock), `禁用入口保持禁用：${title}`)
}
expect((groupsBlock.match(/disabled:\s*Boolean\(true\)/g) ?? []).length === 2, 'SERVICE_GROUPS 仅两个禁用入口')
expect(!/title:\s*'云打印'/.test(groupsBlock), '云打印入口保持按取舍决策删除')
expect(/disabled=\{disabled\}/.test(home) && /tile\.disabled \|\| !tile\.to/.test(home), '磁贴禁用态由真实 disabled/to 驱动')

// ── 真实设备状态：topbar 消费 hook，不硬编码在线/网络正常 ──────────
const topBar = home.slice(home.indexOf('function KioskTopBar'), home.indexOf('function HomeWelcome'))
expect(/const deviceStatus = useHomeDeviceStatus\(\)/.test(topBar), '顶栏消费真实 useHomeDeviceStatus')
expect(/\{deviceStatus\.label\}/.test(topBar), '顶栏状态文案来自真实 deviceStatus.label')
expect(!/>\s*打印机在线\s*</.test(topBar) && !topBar.includes('网络正常'), '顶栏不硬编码「打印机在线」/「网络正常」字面量')
expect(existsSync(join(root, 'src/pages/home/hooks/useHomeDeviceStatus.ts')), '真实设备状态 hook 存在')

// ── 真实登录弹窗 + 动态专区开关（承接旧守卫）──────────────────────
expect(home.includes('<MemberLoginDialog'), '首页挂载真实登录弹窗 MemberLoginDialog')
expect(/onContinueAsGuest=\{\(\) => \{\s*continueAsGuest\(\)/.test(home), '登录弹窗游客回调进入真实游客态')
expect(/const toolbox = useToolboxConfig\(\)/.test(home) && /const campus = useSmartCampusConfig\(\)/.test(home), '动态专区消费真实终端/校园配置 hook')
expect(/if \(!showToolbox && !showCampus\) return null/.test(home), '两专区都未启用时 zone-row 不渲染（诚实占位）')
expect(/\.kpv1 \.zone-row \.zone-card:only-child\s*\{[^}]*grid-column:\s*1 \/ -1/.test(pv), '单专区启用时 :only-child 自动通栏（对齐原型规则）')
expect(proto.includes('zone-card:only-child'), '原型定义 :only-child 通栏规则（真值）')

// ── 底部三 Tab（原型 nav-item 首页/AI助手/我的）──────────────────
for (const [label] of [['首页'], ['AI助手'], ['我的']]) {
  expect(new RegExp(`nav-item[^>]*>[\\s\\S]{0,120}?${label}`).test(home), `底部导航保留 Tab：${label}`)
}
expect(/nav-item active/.test(home) && /aria-current="page"/.test(home), '首页 Tab 高亮 active 且 aria-current')
expect((home.match(/className="nav-item/g) ?? []).length === 3, '底部导航为三项')

// ── 合规：禁用文案 + 合规提示条 ──────────────────────────────────
for (const [re, label] of [[/一键投递/, '一键投递'], [/立即投递/, '立即投递'], [/(?<!来源)平台投递/, '脱离来源语境的平台投递']]) {
  expect(!re.test(home) && !re.test(pv), `首页不含合规禁用文案：${label}`)
}
expect(/className="notice"/.test(home) && home.includes('本终端仅提供信息展示与跳转'), '首页保留合规提示条（第三方来源 + 跳转办理）')

// ── ContinuePanel：原型外生产动态状态，条件挂载 + 自门控 ──────────────
// 决策(2026-07-20)：登录且确有可恢复任务(进行中打印/已诊断未优化简历)时渲染；
// 匿名或无任务 → 组件返回 null，标准原型验收态首页与 01-home 1:1。故断言：
//   ① 组件文件保留；② 首页已挂载 <ContinuePanel />；③ 组件自门控 return null；
//   ④ 保留真实任务恢复 API。
expect(existsSync(join(root, 'src/pages/home/components/ContinuePanel.tsx')), 'ContinuePanel 组件文件保留（业务/数据/API 未删）')
expect(/<ContinuePanel\s*\/>/.test(home), '首页条件挂载 ContinuePanel（生产动态态，自门控不破坏原型 1:1）')
const continuePanel = read('src/pages/home/components/ContinuePanel.tsx')
expect(/if \(!suggestion\) return null/.test(continuePanel), 'ContinuePanel 自门控：无可恢复任务时 return null（标准原型态不渲染）')
expect(/getMyPrintOrders|getMyResumes/.test(continuePanel), 'ContinuePanel 保留真实打印订单/简历任务恢复 API')

// ── 图标 1:1：内联 SVG 24×24 stroke 1.6（不复用 KIcon sprite）────────
expect(/viewBox="0 0 24 24"/.test(icons) && /strokeWidth=\{1\.6\}/.test(icons), 'prototype 图标为 24×24 stroke 1.6 内联 SVG')
expect(!/KIcon/.test(home), '首页图标不复用 KIcon sprite（用原型内联 ProtoIcon 保证图标形式 1:1）')

// ── KioskRoot：首页隐藏共享底栏；service-desk 白名单/主题三元不变 ──────
expect(/hideBottomNav=\{pathname === '\/' \|\| isCampusZone\}/.test(kioskRoot), '首页隐藏共享 KioskLayout 底栏（改由 .kpv1 自绘 116px 原型导航）')
expect(/visualTheme=\{isServiceDeskRoute \? 'service-desk' : 'legacy'\}/.test(kioskRoot), 'KioskRoot visualTheme 三元保持不变（不动 service-desk 语义）')
expect(kioskRoot.includes("const SERVICE_DESK_EXACT_ROUTES: readonly string[] = ["), 'KioskRoot 保留 service-desk 精确白名单（k1/k2a/k2b/profile-entry 依赖）')

// ── CI / package.json 接线 ──────────────────────────────────────
expect(pkg.includes('"verify:home-prototype-v1": "node scripts/verify-home-prototype-v1.mjs"'), 'package.json 注册 verify:home-prototype-v1')
expect(!pkg.includes('verify:home-service-desk'), 'package.json 已退役 verify:home-service-desk（首页重建为 prototype-v1）')

if (failures > 0) {
  console.error(`\nFAIL ${failures} 项 — 首页 prototype-v1 合同未满足\n`)
  process.exit(1)
}
console.log('\nALL PASS — 首页 prototype-v1 合同符合原型真值\n')
