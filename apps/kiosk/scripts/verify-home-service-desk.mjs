import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const resolve = (relativePath) => join(root, relativePath)
const read = (relativePath) => (existsSync(resolve(relativePath)) ? readFileSync(resolve(relativePath), 'utf8') : '')

let failures = 0
function pass(message) {
  console.log(`  PASS ${message}`)
}
function fail(message) {
  failures += 1
  console.error(`  FAIL ${message}`)
}
function expect(condition, message) {
  if (condition) pass(message)
  else fail(message)
}
function expectMatches(source, pattern, message) {
  const matched = pattern.test(source)
  expect(matched, `${message}${matched ? '' : ` — pattern ${pattern} not found`}`)
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  if (start < 0) return ''
  const end = endMarker ? source.indexOf(endMarker, start + startMarker.length) : source.length
  return source.slice(start, end < 0 ? source.length : end)
}
function cssRule(source, selector) {
  const selectorStart = source.indexOf(`${selector} {`)
  if (selectorStart < 0) return ''
  const bodyStart = source.indexOf('{', selectorStart)
  let depth = 0
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(selectorStart, index + 1)
    }
  }
  return ''
}
function pixelProperty(rule, property) {
  const pattern = new RegExp(`(?:^|[\\n{])\\s*${escapeRegExp(property)}:\\s*(?:var\\([^,]+,\\s*)?(\\d+)px`)
  const match = rule.match(pattern)
  return match ? Number(match[1]) : null
}
function expectMinimumHeight(source, selector, minimum, label) {
  const value = pixelProperty(cssRule(source, selector), 'min-height')
  expect(value !== null && value >= minimum, `${label} min-height >= ${minimum}px（当前 ${value ?? '缺失'}）`)
}

console.log('\n=== Kiosk 首页青序 LightFlow 静态合同 ===')

const packageJson = read('package.json')
const home = read('src/pages/home/HomePage.tsx')
const kioskRoot = read('src/layouts/KioskRoot.tsx')
const kioskLayout = read('../../packages/ui/src/layouts/KioskLayout.tsx')
const aggregatePath = 'src/pages/home/home-service-desk.css'
const splitPaths = [
  'src/pages/home/styles/home-shell.css',
  'src/pages/home/styles/home-services.css',
  'src/pages/home/styles/home-continuation.css',
  'src/pages/home/styles/home-responsive.css',
]
const cssPaths = [aggregatePath, ...splitPaths]
const aggregate = read(aggregatePath)
const shell = read(splitPaths[0])
const services = read(splitPaths[1])
const continuation = read(splitPaths[2])
const responsive = read(splitPaths[3])
const allCss = cssPaths.map(read).join('\n')
const homeStats = between(home, 'function useHomeStats(', '/* ── Hero')
const identityPanel = between(home, 'function IdentityPanel()', '/* ── 服务分组')
const continuePanel = between(home, 'function ContinuePanel()', '/* ── 智慧校园')
const smartCampusSection = between(home, 'function SmartCampusHorizontalSection()', '/* ── 百宝箱')
const toolboxSection = between(home, 'function ToolboxSection()', 'export function HomePage()')
const homePage = between(home, 'export function HomePage()')

expect(
  packageJson.includes('"verify:home-service-desk": "node scripts/verify-home-service-desk.mjs"'),
  'package.json 注册 verify:home-service-desk',
)
expect(home.includes("import './home-service-desk.css'"), 'HomePage 导入青序 LightFlow 聚合样式')
expect(!home.includes("import './home-inkpaper.css'"), 'HomePage 不再导入旧 inkpaper 首页样式')
expect(!existsSync(resolve('src/pages/home/home-inkpaper.css')), '旧 home-inkpaper.css 已删除')

const expectedImports = [
  "@import './styles/home-shell.css';",
  "@import './styles/home-services.css';",
  "@import './styles/home-continuation.css';",
  "@import './styles/home-responsive.css';",
]
const aggregateLines = aggregate.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
expect(
  aggregateLines.length === expectedImports.length && expectedImports.every((line, index) => aggregateLines[index] === line),
  '聚合 CSS 只按固定顺序导入四个职责文件',
)
for (const path of cssPaths) {
  const source = read(path)
  const lineCount = source ? source.split(/\r?\n/).length : 0
  expect(source.length > 0, `${path} 存在且非空`)
  expect(lineCount > 0 && lineCount < 300, `${path} 少于 300 行（当前 ${lineCount}）`)
}

for (const [source, selectors, label] of [
  [shell, ['.khome {', '.khome .k-top', '.khome .hero', '.khome .identity', '.khome .btn', '.khome .k-ripple', '@keyframes kRise'], 'shell'],
  [services, ['.khome .sec-head', '.khome .home-grid', '.khome .cat-card', '.khome .sub', '.khome .sub.disabled', '.khome .sub:focus-visible'], 'services'],
  [continuation, ['.khome .cat-empty', '.khome .continue', '.khome .compliance'], 'continuation'],
]) {
  expect(selectors.every((selector) => source.includes(selector)), `${label} CSS 覆盖约定职责`)
}
expectMatches(responsive, /@media\s*\(max-width:\s*900px\)/, '响应式样式覆盖 <=900px')
expectMatches(responsive, /@media[^{}]*390px[^{}]*844px/, '响应式样式显式覆盖 390x844')
expectMatches(responsive, /@media[^{}]*390px[^{}]*700px/, '响应式样式显式覆盖 390x700')
expectMatches(responsive, /@media[^{}]*1080px[^{}]*1920px/, '响应式样式显式覆盖 1080x1920')
expectMatches(responsive, /@media\s*\(prefers-reduced-motion:\s*reduce\)/, '响应式样式支持 reduced motion')

const compact390 = cssRule(responsive, '@media (width: 390px)')
const compact390x844 = cssRule(responsive, '@media (width: 390px) and (height: 844px)')
const compact390x700 = cssRule(responsive, '@media (width: 390px) and (max-height: 700px)')
expect(compact390.length > 0, '390px 通用紧凑规则独立于视口高度')
expectMatches(cssRule(compact390, '.khome .k-brand span'), /display:\s*none/, '390px 隐藏品牌副标题')
expectMatches(
  cssRule(compact390, '.khome .k-pill'),
  /min-width:\s*48px[\s\S]*?font-size:\s*0/,
  '390px 状态药丸保留触控宽度并隐藏文字',
)
expectMatches(cssRule(compact390, '.khome .hero h1'), /font-size:\s*33px/, '390px Hero 标题使用紧凑字号')
expectMatches(cssRule(compact390, '.khome .cat-title h3'), /font-size:\s*19px/, '390px 服务标题使用紧凑字号')
expectMatches(
  cssRule(compact390, '.khome .id-actions'),
  /width:\s*100%[\s\S]*?margin:\s*0/,
  '390px 身份操作区占满可用宽度',
)
expectMatches(
  cssRule(compact390, '.khome .id-actions .btn'),
  /flex:\s*1[\s\S]*?min-width:\s*0/,
  '390px 身份按钮可等分收缩且不产生最小宽度溢出',
)
expectMatches(cssRule(compact390, '.khome .btn.cta'), /min-width:\s*0/, '390px 登录主 CTA 取消桌面最小宽度')
expectMatches(
  compact390,
  /\.khome \.sub-grid,\s*\.khome \.cat-card\.span2 \.sub-grid\s*\{[^}]*grid-template-columns:\s*1fr 1fr\s*!important/,
  '390px 服务子入口保持两列紧凑网格',
)
expectMatches(cssRule(compact390x844, '.khome .identity'), /margin-top:\s*-12px/, '390x844 仅补充高屏 identity 叠压差异')
expectMatches(cssRule(compact390x700, '.khome .k-top'), /position:\s*relative/, '390x700 补充短屏非 sticky 顶栏差异')
expectMatches(cssRule(compact390x700, '.khome .hero p'), /display:\s*none/, '390x700 补充短屏 Hero 说明隐藏差异')
expectMatches(cssRule(compact390x700, '.khome .identity'), /margin-top:\s*10px/, '390x700 补充短屏 identity 间距差异')
for (const selector of ['.khome .k-pill', '.khome .id-actions', '.khome .id-actions .btn', '.khome .btn.cta']) {
  expect(
    !compact390x844.includes(selector) && !compact390x700.includes(selector),
    `${selector} 防溢出合同只定义在 390px 通用规则中`,
  )
}

for (const token of [
  '--sd-color-canvas',
  '--sd-color-surface',
  '--sd-color-text-strong',
  '--sd-color-primary',
  '--sd-category-blue-bg',
  '--sd-category-mint-bg',
  '--sd-category-orange-bg',
  '--sd-category-lavender-bg',
  '--sd-category-cyan-bg',
  '--sd-category-sand-bg',
]) {
  expect(allCss.includes(`var(${token}`), `首页样式复用 UI-0 语义 token ${token}`)
}
expectMinimumHeight(services, '.khome .sub', 48, '服务子入口')
expectMinimumHeight(services, '.khome .cat-head', 48, '可点击服务组标题')
expectMinimumHeight(shell, '.khome .id-stat', 48, '登录态统计按钮')
expectMinimumHeight(shell, '.khome .btn', 48, '普通按钮')
expectMinimumHeight(shell, '.khome .btn.lg', 56, '主 CTA')
const navRule = cssRule(
  responsive,
  "[data-visual-theme='service-desk'][data-ux-density='touch'] .ui-kiosk-nav",
)
expect(pixelProperty(navRule, 'height') === 112, 'service-desk touch 底栏 height 绑定 112px')
expect(pixelProperty(navRule, 'min-height') === 112, 'service-desk touch 底栏 min-height 绑定 112px')
expectMinimumHeight(
  responsive,
  "[data-visual-theme='service-desk'][data-ux-density='touch'] .ui-kiosk-nav > button",
  56,
  '底栏 Tab 按钮',
)
expectMatches(identityPanel, /className="btn primary lg cta"\s+onClick=\{goLogin\}/, '登录主 CTA 绑定 56px lg 按钮类')
expectMatches(continuePanel, /className="btn primary lg"\s+onClick=\{suggestion\.onGo\}/, '续办主 CTA 绑定 56px lg 按钮类')

for (const [pattern, label] of [
  [/#fdfbf4/i, '#fdfbf4'],
  [/#0e302b/i, '#0e302b'],
  [/#11322b/i, '#11322b'],
  [/#10302b|#1f9e86|#157a67|#f4f1e8|#efeadd|#fffdf8|#f7f4ec|#0c2f29|#124b41|#1c7a67/i, '旧首页墨青/米纸色'],
  [/(?:Georgia|Songti|SimSun|Noto Serif|Source Han Serif|宋体|(?<!sans-)serif\b)/i, 'Georgia/宋体/衬线字体'],
  [/(?:--paper(?:-2)?|--serif|--ink(?:-2)?|--teal(?:-deep|-soft)?)\s*:/i, '旧纸纹/墨青局部变量'],
  [/(?:repeating-linear-gradient|mask-image)/i, '纸纹背景'],
]) {
  expect(!pattern.test(allCss), `新 CSS 不含旧墨青纸感特征 ${label}`)
}

expectMatches(
  kioskRoot,
  /visualTheme=\{pathname\s*===\s*'\/'\s*\?\s*'service-desk'\s*:\s*'legacy'\}/,
  'Kiosk 仅 pathname === / 启用 service-desk',
)
expectMatches(kioskRoot, /density="touch"/, 'Kiosk 首页视觉密度保持 touch')
expect((kioskRoot.match(/service-desk/g) ?? []).length === 1, 'KioskRoot 只有一个 service-desk 路由 opt-in')

const groupsBlock = home.match(/const SERVICE_GROUPS:[\s\S]*?\n\]\n\nconst SUB_ACCENT/)?.[0] ?? ''
const groupCount = (groupsBlock.match(/^    accent:/gm) ?? []).length
expect(groupCount === 6, `SERVICE_GROUPS 保持六组（当前 ${groupCount}）`)
for (const title of ['AI简历服务', '岗位信息', '招聘会', '打印扫描', 'AI面试训练', '政策服务']) {
  expect(groupsBlock.includes(`title: '${title}'`), `保留服务组：${title}`)
}

const expectedRoutes = new Map([
  ['AI简历诊断', '/resume/source?intent=diagnose'],
  ['AI简历优化', '/resume/source?intent=optimize'],
  ['简历素材库', '/resume/templates'],
  ['职业规划', '/resume/career-plan'],
  ['简历打印', '/print/upload?source=resume'],
  ['求职材料', '/resume/materials'],
  ['全职岗位', '/jobs?category=fulltime'],
  ['实习岗位', '/jobs?category=intern'],
  ['兼职信息', '/jobs?category=parttime'],
  ['全部岗位', '/jobs'],
  ['找企业', '/companies'],
  ['岗位大师', '/resume/job-fit'],
  ['社会招聘会', '/job-fairs'],
  ['校园招聘会', '/campus'],
  ['扫码签到', '/job-fairs/checkin'],
  ['文档打印', '/print/upload?source=document'],
  ['纸质扫描', '/scan/start'],
  ['格式转换', '/print-scan/convert'],
  ['模拟面试', '/interview/setup'],
  ['面试技巧', '/interview/tips'],
  ['面试报告', '/interview/reports'],
  ['就业政策', '/renshi?tab=policy'],
  ['社保指南', '/renshi?tab=social'],
  ['档案 / 登记', '/renshi?tab=register'],
])
for (const [title, route] of expectedRoutes) {
  const pattern = new RegExp(`\\{[^{}]*title:\\s*'${escapeRegExp(title)}'[^{}]*to:\\s*'${escapeRegExp(route)}'[^{}]*\\}`)
  expect(pattern.test(groupsBlock), `入口 ${title} 保持真实路由 ${route}`)
}
for (const title of ['证件复印', '云打印', '证件照打印']) {
  const pattern = new RegExp(`\\{[^{}]*title:\\s*'${title}'[^{}]*disabled:\\s*Boolean\\(true\\)[^{}]*\\}`)
  expect(pattern.test(groupsBlock), `当前禁用入口保持禁用：${title}`)
}
expect((groupsBlock.match(/disabled:\s*Boolean\(true\)/g) ?? []).length === 3, 'SERVICE_GROUPS 仅保留当前三个禁用入口')

expectMatches(
  home,
  /import\s*\{\s*getMyAiRecords,\s*getMyDocuments,\s*getMyResumes\s*\}\s*from\s*'\.\.\/\.\.\/services\/api\/memberAssets'/,
  '首页统计继续导入真实会员资产 service',
)
expectMatches(home, /import\s*\{\s*getMyFavorites\s*\}\s*from\s*'\.\.\/\.\.\/services\/api\/memberFavorites'/, '首页统计继续导入真实收藏 service')
expectMatches(home, /import\s*\{\s*getMyPrintOrders\s*\}\s*from\s*'\.\.\/\.\.\/services\/api\/memberPrintOrders'/, '续办继续导入真实打印订单 service')
expectMatches(
  homeStats,
  /Promise\.all\(\[\s*getMyResumes\(token,\s*\{\s*pageSize:\s*1\s*\}\),\s*getMyDocuments\(token,\s*\{\s*pageSize:\s*1\s*\}\),\s*getMyAiRecords\(token,\s*\{\s*pageSize:\s*1\s*\}\),\s*getMyFavorites\(token,\s*undefined,\s*\{\s*pageSize:\s*1\s*\}\),\s*\]\)/,
  '首页统计并行调用四个真实 service 且使用服务端 total 查询',
)
expectMatches(
  homeStats,
  /\.then\(\(\[resumes,\s*documents,\s*aiRecords,\s*favorites\]\)\s*=>\s*\{[\s\S]*?setStats\(\{\s*resumes:\s*resumes\.total,\s*documents:\s*documents\.total,\s*aiRecords:\s*aiRecords\.total,\s*favorites:\s*favorites\.total,\s*\}\)/,
  '首页统计把四个真实响应 total 逐项映射到状态',
)
expectMatches(homeStats, /if\s*\(!isLoggedIn\)\s*\{\s*setStats\(null\)[\s\S]*?const token = getToken\(\)[\s\S]*?if\s*\(!token\)/, '首页统计受真实登录态与 token 门控')

expectMatches(identityPanel, /const \{ isLoggedIn, guestMode, displayName, continueAsGuest, logout, getToken \} = useAuth\(\)/, '身份条 handler 来自真实 useAuth')
expectMatches(identityPanel, /const \{ stats, loading \} = useHomeStats\(isLoggedIn, getToken\)/, '身份条消费真实统计 hook')
expectMatches(identityPanel, /const goLogin = \(\) => navigate\('\/login', \{ state: \{ from: location\.pathname \} \}\)/, '登录 handler 保留来源路径')
expectMatches(
  identityPanel,
  /\{ label: '简历', value: loading \|\| !stats \? '—' : String\(stats\.resumes\), href: '\/me\/resumes' \}[\s\S]*?\{ label: '文档', value: loading \|\| !stats \? '—' : String\(stats\.documents\), href: '\/me\/documents' \}[\s\S]*?\{ label: 'AI记录', value: loading \|\| !stats \? '—' : String\(stats\.aiRecords\), href: '\/me\/ai-records' \}[\s\S]*?\{ label: '收藏', value: loading \|\| !stats \? '—' : String\(stats\.favorites\), href: '\/me\/favorites' \}/,
  '统计格展示真实统计状态并保留四个明细路由',
)
expectMatches(identityPanel, /onClick=\{\(\) => navigate\(cell\.href\)\}/, '统计格点击绑定真实明细路由 handler')
expectMatches(
  identityPanel,
  /\{!guestMode && \(\s*<button\s+type="button"\s+className="btn ghost"\s+onClick=\{continueAsGuest\}>\s*游客体验\s*<\/button>\s*\)\}/,
  '游客按钮仅在非游客态渲染并绑定 continueAsGuest',
)
expectMatches(
  identityPanel,
  /<button\s+type="button"\s+className="btn primary lg cta"\s+onClick=\{goLogin\}>\s*立即登录 \/ 注册/,
  '登录按钮直接绑定 goLogin',
)
expectMatches(identityPanel, /className="btn ghost"\s+onClick=\{\(\) => logout\(\)\}>\s*退出/, '退出按钮直接绑定 logout')
expectMatches(identityPanel, /className="btn primary lg"\s+onClick=\{\(\) => navigate\('\/profile'\)\}>\s*进入我的/, '进入我的按钮直接绑定 /profile')

expectMatches(
  continuePanel,
  /const \[suggestion, setSuggestion\] = useState<ResumeSuggestion \| null>\(null\)/,
  '续办建议初始为空，不使用固定 suggestion',
)
expectMatches(
  continuePanel,
  /Promise\.all\(\[getMyPrintOrders\(token,\s*\{\s*pageSize:\s*5\s*\}\),\s*getMyResumes\(token,\s*\{\s*pageSize:\s*5\s*\}\)\]\)/,
  '续办并行调用真实打印订单与简历 service',
)
expectMatches(
  continuePanel,
  /const activePrint = orders\.items\.find\(\(o: MemberPrintOrderItem\) => ACTIVE_PRINT_STATUSES\.has\(o\.status\)\)[\s\S]*?if \(activePrint\) \{[\s\S]*?detail: `\$\{activePrint\.fileName \?\? '打印文件'\} · \$\{PRINT_STATUS_TEXT\[activePrint\.status\] \?\? activePrint\.status\}`,[\s\S]*?onGo: \(\) => navigate\('\/me\/print-orders'\)/,
  '打印续办从真实订单响应筛选并映射文件名、状态和进度路由',
)
expectMatches(
  continuePanel,
  /const diagnosed = resumes\.items\.find\([\s\S]*?r\.kind === 'parse' && r\.status === 'completed' && !r\.optimized,[\s\S]*?if \(diagnosed\) \{[\s\S]*?navigate\(`\/resume\/optimize\?taskId=\$\{encodeURIComponent\(diagnosed\.taskId\)\}`,[\s\S]*?state: \{ taskId: diagnosed\.taskId \}/,
  '简历续办从真实简历响应筛选并映射 taskId',
)
expect((continuePanel.match(/setSuggestion\(\{/g) ?? []).length === 2, '续办 suggestion 仅由两条真实响应分支生成')
expectMatches(continuePanel, /if \(!suggestion\) return null\s*\n\s*return \(\s*<section className="continue"/, '无真实建议时隐藏，有建议时可达渲染')
expectMatches(homePage, /<IdentityPanel \/>\s*<ContinuePanel \/>/, 'HomePage 直接渲染可达的 ContinuePanel')

expectMatches(toolboxSection, /const config = useToolboxConfig\(\)/, '百宝箱读取真实终端配置 hook')
expectMatches(toolboxSection, /const items = config\.enabled \? \[\.\.\.\(config\.items \?\? \[\]\)\]\.sort\(\(a, b\) => a\.sortOrder - b\.sortOrder\) : \[\]/, '百宝箱条目由真实配置开关与排序生成')
expectMatches(toolboxSection, /if \(!config\.enabled\) return null\s*\n\s*return \(/, '百宝箱仅在真实配置启用时进入渲染')
expectMatches(toolboxSection, /\{items\.length > 0 \? \([\s\S]*?\{items\.map\([\s\S]*?<ToolboxItemButton[\s\S]*?<\/div>\s*\) : \([\s\S]*?<strong>待配置<\/strong>/, '百宝箱真实条目与受控空态均在可达 JSX 分支')

expectMatches(smartCampusSection, /const config = useSmartCampusConfig\(\)/, '智慧校园读取真实终端配置 hook')
expectMatches(smartCampusSection, /\.filter\(\(key\) => config\.modules\[key\]\)[\s\S]*?const campusItems = \[\.\.\.\(config\.items \?\? \[\]\)\]\.sort/, '智慧校园入口由真实模块与投放条目生成')
expectMatches(smartCampusSection, /if \(!config\.enabled \|\| \(enabledTiles\.length === 0 && campusItems\.length === 0\)\) return null\s*\n\s*return \(/, '智慧校园仅在启用且有真实入口时进入渲染')
expectMatches(smartCampusSection, /enabledTiles\.map\(\(tile\) => \([\s\S]*?<ServiceTileButton[\s\S]*?campusItems\.map\(\(item\) => \([\s\S]*?<ToolboxItemButton/, '智慧校园可达 JSX 映射真实模块与投放条目')
expectMatches(homePage, /<ToolboxSection \/>\s*<SmartCampusHorizontalSection \/>/, 'HomePage 直接按顺序渲染百宝箱与智慧校园')
expectMatches(homePage, /useInkRipple\('\.khome \.sub, \.khome \.btn, \.khome \.id-stat'\)/, '首页可达组件保留触控涟漪绑定')
expectMatches(homePage, /岗位和招聘会仅作为第三方 \/ 官方来源信息入口，投递与预约请前往来源平台完成。/, '首页可达组件保留合规脚注')

for (const [key, label] of [['home', '首页'], ['assistant', 'AI助手'], ['profile', '我的']]) {
  expectMatches(kioskLayout, new RegExp(`key:\\s*'${key}'[^}]*label:\\s*'${label}'`), `底部导航保留 ${label} Tab`)
}
expect((kioskLayout.match(/\{ key:/g) ?? []).length === 3, '底部导航仍为三项')

for (const [pattern, label] of [
  [/一键投递/, '一键投递'],
  [/立即投递/, '立即投递'],
  [/(?<!来源)平台投递/, '脱离“去来源平台投递”语境的平台投递'],
]) {
  expect(!pattern.test(home) && !pattern.test(allCss), `首页不含合规禁用文案：${label}`)
}

if (failures > 0) {
  console.error(`\nFAIL ${failures} 项失败 — Kiosk 首页青序 LightFlow 合同未满足\n`)
  process.exit(1)
}

console.log('\nALL PASS — Kiosk 首页青序 LightFlow 合同符合预期\n')
