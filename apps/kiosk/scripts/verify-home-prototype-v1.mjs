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
function cssRuleBlocks(source) {
  const blocks = []
  const stack = []
  let boundary = 0
  let quote = ''
  let escaped = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === ';') {
      boundary = index + 1
      continue
    }
    if (char === '{') {
      stack.push({ prelude: source.slice(boundary, index).trim(), open: index })
      boundary = index + 1
      continue
    }
    if (char === '}') {
      const block = stack.pop()
      if (block) blocks.push({ prelude: block.prelude, body: source.slice(block.open + 1, index) })
      boundary = index + 1
    }
  }
  return blocks
}
function cssSelectorList(prelude) {
  const selectors = []
  let start = 0
  let squareDepth = 0
  let parenDepth = 0
  let quote = ''
  let escaped = false

  for (let index = 0; index < prelude.length; index += 1) {
    const char = prelude[index]
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") quote = char
    else if (char === '[') squareDepth += 1
    else if (char === ']') squareDepth = Math.max(0, squareDepth - 1)
    else if (char === '(') parenDepth += 1
    else if (char === ')') parenDepth = Math.max(0, parenDepth - 1)
    else if (char === ',' && squareDepth === 0 && parenDepth === 0) {
      selectors.push(prelude.slice(start, index).trim())
      start = index + 1
    }
  }
  selectors.push(prelude.slice(start).trim())
  return selectors.filter(Boolean)
}
function cssSelectorsEquivalent(candidate, expected) {
  const fusionScope = /^\[\s*data-kiosk-presentation\s*=\s*(?:"fusion-youth"|'fusion-youth'|fusion-youth)\s*\]$/
  if (fusionScope.test(candidate.trim()) && fusionScope.test(expected.trim())) return true
  return candidate.trim() === expected.trim()
}
function cssRules(source, selector) {
  return cssRuleBlocks(source)
    .filter(({ prelude }) => cssSelectorList(prelude).some((candidate) => cssSelectorsEquivalent(candidate, selector)))
    .map(({ prelude, body }) => `${prelude} {${body}}`)
}
function pxProp(rule, prop) {
  const m = rule.match(new RegExp(`(?:^|[\\n{;])\\s*${escapeRegExp(prop)}:\\s*(\\d+)px`))
  return m ? Number(m[1]) : null
}
function cssCustomPropertyValues(source, selector, property) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '')
  return cssRules(withoutComments, selector).flatMap((rule) => {
    const open = rule.indexOf('{')
    const close = rule.lastIndexOf('}')
    if (open < 0 || close <= open) return []

    return rule
      .slice(open + 1, close)
      .split(';')
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .flatMap((declaration) => {
        const colon = declaration.indexOf(':')
        if (colon < 0 || declaration.slice(0, colon).trim() !== property) return []
        const value = declaration.slice(colon + 1).trim()
        return [value]
      })
  })
}
function hasUniqueCssCustomProperty(source, selector, property, expectedValue) {
  const values = cssCustomPropertyValues(source, selector, property)
  return values.length === 1 && values[0] === expectedValue
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
const paletteScope = "[data-kiosk-presentation='fusion-youth']"

expect(proto.length > 0, '原型 01-home.html 可读（真值锚点存在）')
expect(shared.length > 0, '原型 shared.css 可读（真值锚点存在）')

// ── 从原型派生的结构真值 → 校验实现 ─────────────────────────────
// [1] Topbar 高度：shared.css .topbar { height: N px }
const protoTopbar = pxProp(cssRule(shared, '.topbar'), 'height')
expect(protoTopbar === 76, `原型 shared.css .topbar 高度真值=76（实测 ${protoTopbar}）`)
const shellCss = read('../../packages/ui/src/styles/kiosk-shell.css')
expect(pxProp(cssRule(shellCss, "[data-kiosk-presentation='fusion-youth'] .ui-kiosk-topbar"), 'height') === protoTopbar, `共享壳 .ui-kiosk-topbar 高度对齐原型 ${protoTopbar}px`)

// [2] 登录按钮：01-home .login-btn { min-height:88; border-radius:var(--r-md) }，shared --r-md=18
const protoLogin = pxProp(cssRule(proto, '.login-btn'), 'min-height')
const protoRmd = (shared.match(/--r-md:\s*(\d+)px/) ?? [])[1]
expect(protoLogin === 88, `原型 .login-btn min-height 真值=88（实测 ${protoLogin}）`)
expect(protoRmd === '18', `原型 shared --r-md 真值=18px（实测 ${protoRmd}）`)
expect(pxProp(cssRule(pv, '.kpv1 .login-btn'), 'min-height') === protoLogin, `实现 .kpv1 .login-btn min-height 对齐原型 ${protoLogin}px`)
expect(/\.kpv1 \.login-btn\s*\{[^}]*border-radius:\s*var\(--pv-r-md\)/.test(pv), '实现登录按钮圆角用 --pv-r-md（=原型 r-md 18px）')
expect(/--pv-r-md:\s*18px/.test(pv), '实现 --pv-r-md token=18px 对齐原型')

// [3] tile 高度：shared 基类 .tile=96（shared.css 真值）；
// 01-home 已升级至 AI OS .svc-tile，旧 .groups/.tile.col 高度由 prototype-v1.css 实现层保留。
const protoTileBase = pxProp(cssRule(shared, '.tile'), 'min-height')
expect(protoTileBase === 96, `原型 shared 基类 .tile min-height 真值=96（实测 ${protoTileBase}）`)
expect(pxProp(cssRule(pv, '.kpv1 .tile'), 'min-height') === protoTileBase, `实现基类 .kpv1 .tile min-height 对齐原型 ${protoTileBase}px`)
expect(pxProp(cssRule(pv, '.kpv1 .groups .tile'), 'min-height') === 76, '实现 .kpv1 .groups .tile min-height=76px（prototype-v1.0 保留值）')
expect(pxProp(cssRule(pv, '.kpv1 .tiles.c2 .tile, .kpv1 .tiles.c1 .tile'), 'min-height') === 70, '实现 c1/c2 .tile min-height=70px（prototype-v1.0 保留值）')
expect(pxProp(cssRule(pv, '.kpv1 .tile.col'), 'min-height') === 90, '实现 .tile.col min-height=90px（prototype-v1.0 保留值）')
// [4] 卡片品类色：01-home AI OS 版不含此规则；实现层 prototype-v1.css 保留左侧竖条
const implStripe = cssRule(pv, '.kpv1 .groups .card::before')
expect(/width:\s*6px/.test(implStripe) && /inset:\s*0 auto 0 0/.test(implStripe), '实现卡片品类色=左侧 6px 竖条对齐原型')
expect(!/\.kpv1 \.card[^{]*\{[^}]*border-top:\s*4px/.test(pv), '实现不得用 shared 基类的 4px 顶边（首页已覆写为左侧竖条）')

// [5] 网格列数：01-home 已升级至 AI OS .svc-grid；旧 .tiles.cN 实现层保留兼容
for (const [cls, cols] of [['c3', 'repeat(3, 1fr)'], ['c2', 'repeat(2, 1fr)'], ['c5', 'repeat(5, 1fr)'], ['c1', '1fr']]) {
  expect(new RegExp(`\\.kpv1 \\.tiles\\.${cls}\\s*\\{[^}]*grid-template-columns:\\s*${escapeRegExp(cols)}`).test(pv), `实现 .tiles.${cls} 对齐原型 ${cols}`)
}

// [6] 底部导航高度：shared .navbar { height:116px }
const protoNav = pxProp(cssRule(shared, '.navbar'), 'height')
expect(protoNav === 116, `原型 shared .navbar 高度真值=116（实测 ${protoNav}）`)
expect(pxProp(cssRule(shellCss, "[data-kiosk-presentation='fusion-youth'] .ui-kiosk-nav"), 'height') === protoNav, `共享壳 .ui-kiosk-nav 高度对齐原型 ${protoNav}px`)

// ── 结构：统一 .tile 网格，废弃 primary/secondary 两级模型 ──────────
expect(home.includes("import '../../styles/prototype-v1.css'"), 'HomePage 导入 prototype-v1 作用域样式')
expect(!home.includes('home-service-desk.css'), 'HomePage 不再导入旧 service-desk 首页样式')
expect(!home.includes('home-fusion-youth-override.css'), 'HomePage 不得重新导入旧 fusion-youth override')
expect(
  !existsSync(join(root, 'src/pages/home/home-fusion-youth-override.css')),
  '旧 fusion-youth override 已删除，首页样式保持 prototype-v1 单一来源',
)
expect(
  hasUniqueCssCustomProperty(pv, paletteScope, '--pv-paper', 'var(--k-paper, #f4f1e8)'),
  'prototype-v1 fusion 作用域唯一保留米白 paper 语义色',
)
expect(
  hasUniqueCssCustomProperty(pv, paletteScope, '--pv-ink', 'var(--k-ink, #10302b)'),
  'prototype-v1 fusion 作用域唯一保留深绿 ink 语义色',
)
expect(
  hasUniqueCssCustomProperty(pv, paletteScope, '--pv-teal', 'var(--k-teal, #1f9e86)'),
  'prototype-v1 fusion 作用域唯一保留青绿 teal 语义色',
)
expect(
  !hasUniqueCssCustomProperty(
    `${paletteScope} { /* --pv-paper: var(--k-paper, #f4f1e8); */ }`,
    paletteScope,
    '--pv-paper',
    'var(--k-paper, #f4f1e8)',
  ),
  'palette 守卫拒绝仅存在于注释的声明',
)
expect(
  !hasUniqueCssCustomProperty(
    `${paletteScope} { --pv-ink: var(--k-ink, #10302b) BROKEN; }`,
    paletteScope,
    '--pv-ink',
    'var(--k-ink, #10302b)',
  ),
  'palette 守卫拒绝带非法尾缀的声明',
)
expect(
  !hasUniqueCssCustomProperty(
    `${paletteScope} { --pv-teal: var(--k-teal, #1f9e86); --pv-teal: hotpink; }`,
    paletteScope,
    '--pv-teal',
    'var(--k-teal, #1f9e86)',
  ),
  'palette 守卫拒绝后续覆盖的重复声明',
)
expect(
  !hasUniqueCssCustomProperty(
    `${paletteScope} { --pv-paper: var(--k-paper, #f4f1e8); } ${paletteScope} { --pv-paper: hotpink; }`,
    paletteScope,
    '--pv-paper',
    'var(--k-paper, #f4f1e8)',
  ),
  'palette 守卫拒绝后续同选择器规则块覆盖',
)
for (const [label, overridingRule] of [
  ['换行与 Tab 空白', `${paletteScope}\n\t{ --pv-paper: hotpink; }`],
  ['双引号等价属性选择器', '[data-kiosk-presentation="fusion-youth"] { --pv-paper: hotpink; }'],
  ['selector list', `.unrelated, ${paletteScope} { --pv-paper: hotpink; }`],
  ['空值自定义属性', `${paletteScope} { --pv-paper: ; }`],
]) {
  expect(
    !hasUniqueCssCustomProperty(
      `${paletteScope} { --pv-paper: var(--k-paper, #f4f1e8); } ${overridingRule}`,
      paletteScope,
      '--pv-paper',
      'var(--k-paper, #f4f1e8)',
    ),
    `palette 守卫拒绝合法 CSS 跨块覆盖：${label}`,
  )
}
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
expect(/className="kpv1 kpv1--content-only"/.test(home), '首页根节点使用 .kpv1 作用域（content-only）')
expect(/<div className="groups"[^>]*aria-label="当前可使用功能"/.test(home), '首页服务区用中性 .groups 网格容器并保留可访问名称')
expect(!/<main className="groups"/.test(home), '首页服务区不在 KioskLayout 主地标内嵌套 main')
expect(/tile\.emphasis === 'primary' \? 'primary' : ''/.test(home), '磁贴 emphasis→.tile.primary（统一网格，无独立次级列表）')
expect(!/home-reference-primary-list|home-reference-secondary-list/.test(home), '首页不再使用 primary/secondary 双列表结构')

// ── 原型文案（1:1）──────────────────────────────────────────────
expect(proto.includes('一趟办完') && /简历、打印、岗位信息<em>一趟办完<\/em>/.test(home), '欢迎区主标题 1:1 原型「简历、打印、岗位信息一趟办完」')
expect(home.includes('游客可直接使用大部分功能 · 触摸下方卡片开始'), '欢迎区副标题实现包含「游客可直接」文案（01-home AI OS 已更新，实现过渡期保留）')
expect(proto.includes('登录 / 注册') && home.includes('登录 / 注册'), '登录按钮文案 1:1 原型「登录 / 注册」')
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

// ── 真实设备状态：由共享 KioskLayout 顶栏消费 fail-closed hook，首页不再自绘 topbar ──
expect(existsSync(join(root, 'src/hooks/useTerminalDeviceStatus.ts')), '真实设备状态 hook 存在')
expect(/useTerminalDeviceStatus\(\s*true\s*\)/.test(kioskRoot), 'KioskRoot 始终拉取真实设备状态')
expect(kioskRoot.includes('<KioskTopbarStatus'), '共享顶栏注入真实设备状态胶囊')
expect(!/function KioskTopBar/.test(home), '首页不再自绘 KioskTopBar')
expect(!/>\s*打印机在线\s*</.test(home) && !home.includes('网络正常'), '首页不硬编码「打印机在线」/「网络正常」字面量')

// ── 真实登录弹窗 + 动态专区开关（承接旧守卫）──────────────────────
expect(home.includes('<MemberLoginDialog'), '首页挂载真实登录弹窗 MemberLoginDialog')
expect(/onContinueAsGuest=\{\(\) => \{\s*continueAsGuest\(\)/.test(home), '登录弹窗游客回调进入真实游客态')
expect(/const toolbox = useToolboxConfig\(\)/.test(home) && /const campus = useSmartCampusConfig\(\)/.test(home), '动态专区消费真实终端/校园配置 hook')
expect(/if \(!showToolbox && !showCampus\) return null/.test(home), '两专区都未启用时 zone-row 不渲染（诚实占位）')
expect(/\.kpv1 \.zone-row \.zone-card:only-child\s*\{[^}]*grid-column:\s*1 \/ -1/.test(pv), '单专区启用时 :only-child 自动通栏（对齐原型规则）')

// ── 底部三 Tab：改由共享 KioskLayout.ui-kiosk-nav 提供 ────────────
expect(!/function HomeNavbar/.test(home), '首页不再自绘 HomeNavbar')
expect(kioskRoot.includes('hideBottomNav={isCampusZone || usesPageActionbar}'), '首页使用共享底栏（校园专区或页面自带 actionbar 时隐藏）')
const layoutSrc = read('../../packages/ui/src/layouts/KioskLayout.tsx')
expect(layoutSrc.includes("label: '首页'") && layoutSrc.includes("label: 'AI助手'") && layoutSrc.includes("label: '我的'"), '共享底栏保留三 Tab 文案')
expect(layoutSrc.includes('ui-kiosk-nav'), '共享底栏使用 ui-kiosk-nav')

// ── 合规：禁用文案 + 合规提示条 ──────────────────────────────────
for (const [re, label] of [[/一键投递/, '一键投递'], [/立即投递/, '立即投递'], [/(?<!来源)平台投递/, '脱离来源语境的平台投递']]) {
  expect(!re.test(home) && !re.test(pv), `首页不含合规禁用文案：${label}`)
}
expect(/className="notice"/.test(home) && home.includes('本终端仅提供信息展示与跳转'), '首页保留合规提示条（第三方来源 + 跳转办理）')

// ── 网站备案信息：首页最后一个内容节点，两个官方查询链接 + 纯文本品牌 ──────────────
const filingOrder = [
  '鲁ICP备2026023517号-2',
  '鲁公网安备37021402007308号',
  '职易达AI',
]
const filingBlock = home.match(/<footer className="filing-info"[\s\S]*?<\/footer>/)?.[0] ?? ''
expect(filingOrder.every((text) => filingBlock.includes(text)), '首页展示 ICP、公安备案与「职易达AI」')
expect(
  filingOrder.every(
    (text, index) => index === 0 || filingBlock.indexOf(filingOrder[index - 1]) < filingBlock.indexOf(text),
  ),
  '备案与品牌文字顺序稳定',
)
expect(/href="https:\/\/beian\.miit\.gov\.cn\/"[\s\S]*?鲁ICP备2026023517号-2/.test(filingBlock), 'ICP 备案号链接工信部备案系统')
expect(
  /href="https:\/\/beian\.mps\.gov\.cn\/#\/query\/webSearch\?code=37021402007308"[\s\S]*?鲁公网安备37021402007308号/.test(filingBlock),
  '公安备案号链接公安部备案查询',
)
expect(/<span className="filing-brand">职易达AI<\/span>/.test(filingBlock), '「职易达AI」保持纯文本，不新增外链')
expect(/<footer className="filing-info"[\s\S]*?<\/footer>\s*<\/KioskPageFrame>/.test(home), '备案信息是首页最后一个内容节点')
expect(/\.kpv1 \.filing-info\s*\{[^}]*flex-wrap:\s*wrap/.test(pv), '备案信息允许窄屏换行')
expect(/\.kpv1 \.filing-info a\s*\{[^}]*min-height:\s*48px/.test(pv), '备案链接符合一体机 48px 最小触控高度')

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

// ── KioskRoot：统一 service-desk + fusion-youth；首页接入共享壳 ──────
expect(/visualTheme="service-desk"/.test(kioskRoot), 'KioskRoot 全路由统一 service-desk')
expect(/presentation="fusion-youth"/.test(kioskRoot), 'KioskRoot 全路由统一 fusion-youth')
expect(!kioskRoot.includes('SERVICE_DESK_EXACT_ROUTES'), '已拆除 SERVICE_DESK_EXACT_ROUTES 主题分叉')
expect(/hideHeader=\{isCampusZone\}/.test(kioskRoot) && kioskRoot.includes('hideBottomNav={isCampusZone || usesPageActionbar}'), '共享顶栏仅校园专区隐藏；共享底栏在校园专区或页面自带 actionbar 时隐藏')
expect(/className="kpv1 kpv1--content-only"/.test(home) || /className=\{'kpv1 kpv1--content-only'\}/.test(home) || home.includes('kpv1--content-only'), '首页内容区使用 kpv1--content-only')

// ── CI / package.json 接线 ──────────────────────────────────────
expect(pkg.includes('"verify:home-prototype-v1": "node scripts/verify-home-prototype-v1.mjs"'), 'package.json 注册 verify:home-prototype-v1')
expect(!pkg.includes('verify:home-service-desk'), 'package.json 已退役 verify:home-service-desk（首页重建为 prototype-v1）')

if (failures > 0) {
  console.error(`\nFAIL ${failures} 项 — 首页 prototype-v1 合同未满足\n`)
  process.exit(1)
}
console.log('\nALL PASS — 首页 prototype-v1 合同符合原型真值\n')
