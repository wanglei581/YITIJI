// verify-home-prototype-v1 · 首页视觉基线静态合同（V3 意图台试点版，2026-08-09）
//
// 真值来源升级：首页已按 phase2-home-pilot-plan.md 从 kiosk-proto-2026-07/01-home
// 迁移到 docs/design/kiosk-ai-os-v3-2026-08/01-home-v5.html（鲜彩玻璃 warm）+
// styles/vivid.css（六服务身份色）+ styles/tokens.css（触控 token）。
// 本守卫每条视觉断言都从 V3 设计基线「派生期望值」再校验实现，禁止把实现值当期望。
// 同时继续承接全部真实能力契约（真实路由 / 登录 / 设备状态诚实 / 动态专区门控 /
// 合规文案 / 备案信息 / ContinuePanel / 三 Tab / 触控尺寸）。
//
// 脚本名保持 verify-home-prototype-v1 不变：CI 接线与相邻门禁（member-login-dialog）
// 以该名建立顺序合同，改名收益低于接线风险。
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(root, '..', '..')
const read = (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : '')
const readDesign = (p) =>
  existsSync(join(repoRoot, 'docs/design/kiosk-ai-os-v3-2026-08', p))
    ? readFileSync(join(repoRoot, 'docs/design/kiosk-ai-os-v3-2026-08', p), 'utf8')
    : ''

let failures = 0
const pass = (m) => console.log(`  PASS ${m}`)
const fail = (m) => {
  failures += 1
  console.error(`  FAIL ${m}`)
}
const expect = (cond, m) => (cond ? pass(m) : fail(m))
const escapeRegExp = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

console.log('\n=== 首页 V3 视觉基线静态合同（真值：01-home-v5.html + vivid.css + tokens.css）===')

const proto = readDesign('01-home-v5.html')
const vivid = readDesign('styles/vivid.css')
const tokens = readDesign('styles/tokens.css')
const home = read('src/pages/home/HomePage.tsx')
const pv = read('src/styles/prototype-v1.css')
const homeCss = read('src/pages/home/home-v3.css')
const serviceGroups = read('src/pages/home/serviceGroups.ts')
const kioskRoot = read('src/layouts/KioskRoot.tsx')
const icons = read('src/pages/home/prototypeIcons.tsx')
const helpCenter = read('src/pages/help/HelpCenterPage.tsx')
const pkg = read('package.json')

expect(proto.length > 0, 'V3 原型 01-home-v5.html 可读（真值锚点存在）')
expect(vivid.length > 0, 'V3 vivid.css 可读（身份色真值锚点存在）')
expect(tokens.length > 0, 'V3 tokens.css 可读（触控 token 真值锚点存在）')

// ── 从 V3 设计基线派生的视觉真值 → 校验实现 ─────────────────────
// [1] 六服务身份色渐变（vivid.css .card--*）逐值对齐 hv3 卡片
const CAT_MAP = [
  ['print', 'hv3-cat-print'],
  ['resume', 'hv3-cat-resume'],
  ['job', 'hv3-cat-job'],
  ['fair', 'hv3-cat-fair'],
  ['mock', 'hv3-cat-interview'], // 真实实现避开 mock* 标识符禁用规则，类名改 interview，色值不变
  ['policy', 'hv3-cat-policy'],
]
for (const [protoCat, implClass] of CAT_MAP) {
  const derived = new RegExp(
    `\\.card--${protoCat}\\s*\\{\\s*--c1:\\s*(#[0-9a-fA-F]{3,8});\\s*--c2:\\s*(#[0-9a-fA-F]{3,8});`,
  ).exec(vivid)
  const c1 = derived?.[1]
  const c2 = derived?.[2]
  const implRule = new RegExp(
    `\\.kpv1\\.hv3 \\.${escapeRegExp(implClass)}[^{]*\\{[^}]*--hv3-c1:\\s*${escapeRegExp(c1 ?? '∅')};[^}]*--hv3-c2:\\s*${escapeRegExp(c2 ?? '∅')};`,
  )
  expect(Boolean(c1 && c2) && implRule.test(homeCss), `身份色渐变对齐 vivid .card--${protoCat}（${c1} → ${c2}）`)
}
// [2] 身份识别主色（vivid :root --cat-print）驱动 hero 强调色
const catPrint = (vivid.match(/--cat-print:\s*(#[0-9a-fA-F]{3,8})/) ?? [])[1]
expect(catPrint === '#0d8a6a', `vivid --cat-print 真值=#0d8a6a（实测 ${catPrint}）`)
expect(new RegExp(`--hv3-cat-print:\\s*${escapeRegExp(catPrint ?? '∅')}`).test(homeCss), '实现 --hv3-cat-print 对齐 vivid --cat-print')
// [3] 触控 token（tokens.css --touch-min）
const touchMin = (tokens.match(/--touch-min:\s*(\d+)px/) ?? [])[1]
expect(touchMin === '48', `tokens --touch-min 真值=48px（实测 ${touchMin}）`)
expect(new RegExp(`--hv3-touch-min:\\s*${escapeRegExp(touchMin ?? '∅')}px`).test(homeCss), '实现 --hv3-touch-min 对齐 tokens --touch-min')
expect(/--hv3-touch-primary:\s*56px/.test(homeCss), '实现 --hv3-touch-primary=56px（CLAUDE.md §9 主按钮建议值）')
// [4] V5 关键构图元素在实现中存在：玻璃指令胶囊 / 场景快捷 / 身份色卡网格 / 仪表
expect(proto.includes('vcommand') && /\.kpv1\.hv3 \.hv3-command\s*\{/.test(homeCss), 'V5 玻璃指令胶囊已落地（hv3-command）')
expect(proto.includes('vscenes') && /\.kpv1\.hv3 \.hv3-scene\s*\{/.test(homeCss), 'V5 场景快捷 chips 已落地（hv3-scene）')
expect(proto.includes('vgrid-a') && /\.kpv1\.hv3 \.hv3-grid-a\s*\{/.test(homeCss) && /\.kpv1\.hv3 \.hv3-grid-b\s*\{/.test(homeCss), 'V5 双列大卡 + 四列紧凑卡网格已落地')
expect(proto.includes('vpanel') && /\.kpv1\.hv3 \.hv3-panel\s*\{/.test(homeCss), 'V5 本机仪表已落地（hv3-panel）')
// [5] 设计红线：禁紫蓝渐变基调（README §6.4 / tokens.css 注释「刻意不设紫色」）
expect(!/#7c3aed|#8b5cf6|#6d28d9|#4c1d95|purple/i.test(homeCss), 'hv3 层不引入紫色/紫蓝渐变（V3 设计红线）')

// ── 结构：hv3 层挂在 kpv1 content-only 根上，样式作用域不外泄 ──────
expect(home.includes("import '../../styles/prototype-v1.css'"), 'HomePage 保留 prototype-v1 集成层（kpv1 壳 + 复用组件）')
expect(home.includes("import './home-v3.css'"), 'HomePage 导入 hv3 视觉层')
expect(!home.includes('home-service-desk.css'), 'HomePage 不再导入旧 service-desk 首页样式')
expect(!home.includes('home-fusion-youth-override.css'), 'HomePage 不得重新导入旧 fusion-youth override')
expect(/className="kpv1 kpv1--content-only hv3"/.test(home), '首页根节点使用 .kpv1 content-only + .hv3 作用域')
expect(/<nav\s+className="hv3-services"\s+aria-label="服务入口">/.test(home), '首页服务区使用 nav[aria-label=服务入口]')
expect(!/<main className=/.test(home), '首页不在 KioskLayout 主地标内嵌套 main')
expect(!/function SvcGrid/.test(home) && !/svc-grid/.test(home), '旧 SvcGrid 扁平磁贴结构已退役')
expect(/className="hv3-card-main svc-tile"/.test(home), '主入口保留 .svc-tile 触控合同类（浏览器 ≥56px 断言锚点）')

// ── 定稿文案（浏览器合同锚点 1:1）───────────────────────────────
expect(home.includes('简历、岗位、打印，<em>一趟办完</em>'), '欢迎区主标题保留「简历、岗位、打印，一趟办完」')
expect(home.includes('现场准备材料、了解机会，并在本机完成打印扫描'), '欢迎区副标题保留现场办理文案')
expect(home.includes('登录 / 注册'), '登录按钮文案保留「登录 / 注册」')
expect(home.includes('让小青安排') && home.includes('将进入 AI 顾问，由你确认办理方案'), 'AI 接待台保留「让小青安排」与确认口径')

// ── 登录态：复用 .login-btn，文字改「进入我的」，不显示未实现统计 ──
expect(home.includes('进入我的'), '登录态复用登录框，文字改「进入我的」')
expect(/isLoggedIn \?[\s\S]*?className="login-btn"[\s\S]*?进入我的/.test(home), '登录态入口仍用 .login-btn 外框')
expect(!/id-stats|id-stat\b|stats\.resumes|stats\.documents|stats\.aiRecords/.test(home), '首页不显示未实现的简历/文档/AI记录统计')

// ── 真实能力：六服务卡主入口 + 小功能直点子入口（与 verify-fusion-home 互为冗余守卫） ──
const expectedEntries = [
  ['打印扫描', '/print-scan'],
  ['AI简历服务', '/resume-service'],
  ['岗位信息', '/jobs-service'],
  ['招聘会', '/fairs-service'],
  ['AI面试训练', '/interview-service'],
  ['政策服务', '/policy-service'],
]
for (const [title, route] of expectedEntries) {
  const re = new RegExp(`title:\\s*'${escapeRegExp(title)}',[\\s\\S]{0,200}?to:\\s*'${escapeRegExp(route)}'`)
  expect(re.test(serviceGroups), `主入口保留：${title} → ${route}`)
}
const expectedSubEntries = [
  ['上传打印', '/print/upload'],
  ['扫描原件', '/scan/start'],
  ['图片转PDF', '/print-scan/convert'],
  ['签章', '/print-scan/sign'],
  ['简历诊断', '/resume/source?intent=diagnose'],
  ['简历生成', '/resume/generate'],
  ['岗位匹配', '/resume/job-fit'],
  ['素材模板', '/resume/templates'],
  ['职业规划', '/resume/career-plan'],
  ['岗位列表', '/jobs'],
  ['找企业', '/companies'],
  ['线下机构', '/offline-agencies'],
  ['场次列表', '/job-fairs'],
  ['校园招聘', '/campus'],
  ['现场签到', '/job-fairs/checkin'],
  ['开始练习', '/interview/setup'],
  ['历史报告', '/interview/reports'],
  ['就业政策', '/renshi?tab=policy'],
  ['社保指南', '/renshi?tab=social'],
  ['档案登记', '/renshi?tab=register'],
]
for (const [label, route] of expectedSubEntries) {
  const re = new RegExp(`\\{ label: '${escapeRegExp(label)}', to: '${escapeRegExp(route)}' \\}`)
  expect(re.test(serviceGroups), `小功能直点入口保留：${label} → ${route}`)
}

// ── legacy SERVICE_GROUPS 合同锚点（不渲染，禁漂移；清理须随门禁改造另行立项） ──
const legacyBlock = serviceGroups.slice(serviceGroups.indexOf('export const SERVICE_GROUPS'))
expect(serviceGroups.includes('export const SERVICE_GROUPS'), 'legacy SERVICE_GROUPS 合同锚点保留')
expect((legacyBlock.match(/disabled:\s*Boolean\(true\)/g) ?? []).length === 2, 'legacy 仅两个 Boolean(true) 禁用入口')
expect(!/title:\s*'云打印'/.test(legacyBlock), '云打印入口保持按取舍决策删除')

// ── 真实设备状态：共享壳 fail-closed hook + 首页仪表诚实口径 ──
expect(existsSync(join(root, 'src/hooks/useTerminalDeviceStatus.ts')), '真实设备状态 hook 存在')
expect(/useTerminalDeviceStatus\(\s*true\s*\)/.test(kioskRoot), 'KioskRoot 始终拉取真实设备状态')
expect(kioskRoot.includes('<KioskTopbarStatus'), '共享顶栏注入真实设备状态胶囊')
expect(!/function KioskTopBar/.test(home), '首页不再自绘 KioskTopBar')
expect(!/>\s*打印机在线\s*</.test(home) && !home.includes('网络正常'), '首页不硬编码「打印机在线」/「网络正常」字面量')
expect(home.includes('仅展示本机实时检测到的状态'), '仪表保留「仅展示本机实时检测到的状态」')
expect(home.includes('材料扫描进入后检测') && home.includes('双面能力提交前确认'), '未实时检测项如实标注（不写「正常」）')

// ── 统一全屏登录页 + 动态专区开关 ────────────────────────────────
expect(!home.includes('<MemberLoginDialog'), '首页不再挂载独立登录弹窗')
expect(/const openLogin = \(\) => navigate\('\/login', \{ state: \{ from: '\/' \} \}\)/.test(home), '首页登录入口统一跳转 /login 并保留首页返回路径')
expect(/const toolbox = useToolboxConfig\(\)/.test(home) && /const campus = useSmartCampusConfig\(\)/.test(home), '动态专区消费真实终端/校园配置 hook')
expect(/if \(!showToolbox && !showCampus\) return null/.test(home), '两专区都未启用时 zone-row 不渲染（诚实占位）')
expect(/\.kpv1 \.zone-row \.zone-card:only-child\s*\{[^}]*grid-column:\s*1 \/ -1/.test(pv), '单专区启用时 :only-child 自动通栏')

// ── 底部三 Tab：共享 KioskLayout.ui-kiosk-nav 提供 ────────────────
expect(!/function HomeNavbar/.test(home), '首页不再自绘 HomeNavbar')
expect(kioskRoot.includes('hideBottomNav={isCampusZone || usesPageActionbar}'), '首页使用共享底栏（校园专区或页面自带 actionbar 时隐藏）')
const layoutSrc = read('../../packages/ui/src/layouts/KioskLayout.tsx')
expect(layoutSrc.includes("label: '首页'") && layoutSrc.includes("label: 'AI顾问'") && layoutSrc.includes("label: '我的'"), '共享底栏保留三 Tab 文案')
expect(layoutSrc.includes('ui-kiosk-nav'), '共享底栏使用 ui-kiosk-nav')

// ── 合规：禁用文案 + 合规提示条 ──────────────────────────────────
for (const [re, label] of [[/一键投递/, '一键投递'], [/立即投递/, '立即投递'], [/(?<!来源)平台投递/, '脱离来源语境的平台投递']]) {
  expect(!re.test(home) && !re.test(pv) && !re.test(homeCss) && !re.test(serviceGroups), `首页不含合规禁用文案：${label}`)
}
expect(/className="notice"/.test(home) && home.includes('本终端仅提供信息展示与跳转'), '首页保留合规提示条（第三方来源 + 跳转办理）')

// ── 网站备案信息：保持在帮助中心 ─────────────────────────────────
const filingOrder = [
  '鲁ICP备2026023517号-2',
  '鲁公网安备37021402007308号',
  '职易达AI',
]
expect(!/filing-info|鲁ICP备|鲁公网安备/.test(home), '首页不再重复展示备案信息')
const filingStart = helpCenter.indexOf('{/* 网站备案信息 */}')
const filingBlock = filingStart >= 0 ? helpCenter.slice(filingStart) : ''
expect(filingOrder.every((text) => filingBlock.includes(text)), '帮助中心展示 ICP、公安备案与「职易达AI」')
expect(/aria-label="网站备案信息"/.test(filingBlock), '帮助中心备案区保留稳定的可访问名称')
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
expect(/\{' · 职易达AI'\}/.test(filingBlock), '「职易达AI」在帮助中心保持纯文本，不新增外链')

// ── ContinuePanel：真实可恢复任务面板，条件挂载 + 自门控 ──────────────
expect(existsSync(join(root, 'src/pages/home/components/ContinuePanel.tsx')), 'ContinuePanel 组件文件保留（业务/数据/API 未删）')
expect(/<ContinuePanel\s*\/>/.test(home), '首页条件挂载 ContinuePanel（自门控，无任务不渲染）')
const continuePanel = read('src/pages/home/components/ContinuePanel.tsx')
expect(/if \(!suggestion\) return null/.test(continuePanel), 'ContinuePanel 自门控：无可恢复任务时 return null')
expect(/getMyPrintOrders|getMyResumes/.test(continuePanel), 'ContinuePanel 保留真实打印订单/简历任务恢复 API')

// ── 图标：24×24 stroke 1.6 内联 SVG（V3 原型同款线性风格） ────────
expect(/viewBox="0 0 24 24"/.test(icons) && /strokeWidth=\{1\.6\}/.test(icons), 'prototype 图标为 24×24 stroke 1.6 内联 SVG')
expect(!/KIcon/.test(home), '首页图标不复用 KIcon sprite（ProtoIcon 保证线性风格一致）')

// ── KioskRoot：统一 service-desk + fusion-youth；首页接入共享壳 ──────
expect(/visualTheme="service-desk"/.test(kioskRoot), 'KioskRoot 全路由统一 service-desk')
expect(/presentation="fusion-youth"/.test(kioskRoot), 'KioskRoot 全路由统一 fusion-youth')
expect(!kioskRoot.includes('SERVICE_DESK_EXACT_ROUTES'), '未复活 SERVICE_DESK_EXACT_ROUTES 主题分叉')
expect(/hideHeader=\{isCampusZone\}/.test(kioskRoot), '共享顶栏仅校园专区隐藏')

// ── CI / package.json 接线 ──────────────────────────────────────
expect(pkg.includes('"verify:home-prototype-v1": "node scripts/verify-home-prototype-v1.mjs"'), 'package.json 注册 verify:home-prototype-v1')
expect(!pkg.includes('verify:home-service-desk'), 'package.json 保持退役 verify:home-service-desk')

if (failures > 0) {
  console.error(`\nFAIL ${failures} 项 — 首页 V3 视觉基线合同未满足\n`)
  process.exit(1)
}
console.log('\nALL PASS — 首页 V3 视觉基线合同符合设计真值\n')
