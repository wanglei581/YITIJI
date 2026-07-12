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
  expect(pattern.test(source), `${message}${pattern.test(source) ? '' : ` — pattern ${pattern} not found`}`)
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
expectMatches(allCss, /var\(--sd-control-min,\s*48px\)/, '普通触控目标最小 48px')
expectMatches(allCss, /var\(--sd-primary-control-min,\s*56px\)/, '主 CTA 最小 56px')
expectMatches(allCss, /var\(--sd-nav-height,\s*112px\)/, '底栏布局使用 112px 语义变量')

for (const [pattern, label] of [
  [/#fdfbf4/i, '#fdfbf4'],
  [/#0e302b/i, '#0e302b'],
  [/(?:Songti|SimSun|Noto Serif|Source Han Serif|宋体)/i, '宋体/衬线字体'],
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

for (const marker of [
  'continueAsGuest',
  "navigate('/login', { state: { from: location.pathname } })",
  '<ContinuePanel />',
  'ACTIVE_PRINT_STATUSES',
  "navigate('/me/print-orders')",
  'function ToolboxSection()',
  'if (!config.enabled) return null',
  'items.length > 0',
  '<strong>待配置</strong>',
  '<ToolboxSection />',
  '<SmartCampusHorizontalSection />',
  "useInkRipple('.khome .sub, .khome .btn, .khome .id-stat')",
  '岗位和招聘会仅作为第三方 / 官方来源信息入口，投递与预约请前往来源平台完成。',
]) {
  expect(home.includes(marker), `首页行为合同保留：${marker}`)
}
expect(home.indexOf('<ToolboxSection />') < home.indexOf('<SmartCampusHorizontalSection />'), '百宝箱仍排在智慧校园之前')

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
