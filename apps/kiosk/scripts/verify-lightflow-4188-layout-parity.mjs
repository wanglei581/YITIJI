import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => {
  const absolutePath = join(kioskRoot, relativePath)
  return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : ''
}

let failures = 0
function expect(condition, message) {
  if (condition) console.log(`PASS ${message}`)
  else {
    failures += 1
    console.error(`FAIL ${message}`)
  }
}

function expectIncludes(source, marker, message) {
  expect(source.includes(marker), `${message}${source.includes(marker) ? '' : ` — missing ${marker}`}`)
}

function expectAbsent(source, marker, message) {
  expect(!source.includes(marker), `${message}${source.includes(marker) ? ` — unexpected ${marker}` : ''}`)
}

function expectMatches(source, pattern, message) {
  expect(pattern.test(source), `${message}${pattern.test(source) ? '' : ` — missing ${pattern}`}`)
}

function expectPageScopedCss(source, label, allowedRoot) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const selectorBlocks = [...withoutComments.matchAll(/([^{}]+)\{/g)]
    .map((match) => match[1].trim())
    .filter((selector) => selector && !selector.startsWith('@'))

  expect(selectorBlocks.length > 0, `${label} 定义页面局部选择器`)
  for (const selectorBlock of selectorBlocks) {
    for (const selector of selectorBlock.split(',')) {
      const normalized = selector.trim()
      expect(normalized.startsWith(allowedRoot), `${label} 选择器限定在 ${allowedRoot}：${normalized}`)
    }
  }
  expect(!/(?:^|[^\w-])(?:html|body|:root)\b|\.me-inkdetail\b/.test(withoutComments), `${label} 不覆盖全局根或 /me/*`)
}

const expectedItems = [
  ['简历服务', '#resume'],
  ['岗位信息', '#jobs'],
  ['招聘会', '#job-fairs'],
  ['打印扫描', '#print-scan'],
  ['面试训练', '#interview'],
  ['政策服务', '#policy'],
]

console.log('\n=== LightFlow 三主 Tab 4188 页面语法一致性静态合同 ===')

const home = read('src/pages/home/HomePage.tsx')
const homeShellCss = read('src/pages/home/styles/home-shell.css')
const homeServicesCss = read('src/pages/home/styles/home-services.css')
const homeResponsiveCss = read('src/pages/home/styles/home-responsive.css')
const serviceGroups = read('src/pages/home/serviceGroups.ts')
const assistant = read('src/pages/assistant/AssistantPage.tsx')
const assistantShellCss = read('src/pages/assistant/assistant-lightflow-shell.css')
const profile = read('src/pages/profile/ProfilePage.tsx')
const profileEntries = read('src/pages/profile/profileEntries.ts')
const profileShellCss = read('src/pages/profile/profile-lightflow-shell.css')
const profileDirectoryCss = read('src/pages/profile/profile-lightflow-directory.css')
const profileHeader = read('src/pages/profile/components/ProfileHeader.tsx')
const profileEntrySection = read('src/pages/profile/components/ProfileEntrySection.tsx')
const profileSessionRecords = read('src/pages/profile/components/ProfileSessionRecords.tsx')
const nav = read('src/components/lightflow/ReferenceServiceNav.tsx')
const navCss = read('src/components/lightflow/reference-service-nav.css')
const layoutCss = read('src/components/lightflow/reference-layout.css')

// 首页保留专属服务目录语法；Assistant / Profile 不复制首页目录骨架。
expectIncludes(home, 'ReferenceServiceNav', 'Home 导入首页服务分类导航')
expectIncludes(home, '<ReferenceServiceNav', 'Home 渲染首页服务分类导航')
for (const className of [
  'lf-reference-panel',
  'lf-reference-group-head',
  'lf-reference-primary',
  'lf-reference-secondary',
  'lf-reference-pair',
]) {
  expectIncludes(home, className, `Home 使用 ${className}`)
  expectAbsent(assistant, className, `Assistant 不复用首页 ${className}`)
  expectAbsent(profile, className, `ProfilePage 不复用首页 ${className}`)
  expectAbsent(profileHeader, className, `ProfileHeader 不复用首页 ${className}`)
  expectAbsent(profileEntrySection, className, `ProfileEntrySection 不复用首页 ${className}`)
  expectAbsent(profileSessionRecords, className, `ProfileSessionRecords 不复用首页 ${className}`)
}
expectAbsent(assistant, 'ReferenceServiceNav', 'Assistant 不插入首页分类导航')
expectAbsent(profile, 'ReferenceServiceNav', 'Profile 不插入首页分类导航')

// 首页受保护区域顺序保持，服务目录才进入 4188 语法。
const homeHeroIndex = home.indexOf('className="service-value"')
const identityPanelIndex = home.indexOf('<IdentityPanel />')
const continuePanelIndex = home.indexOf('<ContinuePanel />')
const homeNavIndex = home.indexOf('<ReferenceServiceNav')
expect(
  [homeHeroIndex, identityPanelIndex, continuePanelIndex, homeNavIndex].every((index) => index >= 0)
    && homeHeroIndex < identityPanelIndex
    && identityPanelIndex < continuePanelIndex
    && continuePanelIndex < homeNavIndex,
  '首页保持 Hero → 身份卡 → 继续办理 → 服务导航顺序',
)
expectIncludes(home, 'HOME_REFERENCE_HASH_IDS.has(targetId)', '首页 hash 只滚动批准的六个服务锚点')
expectIncludes(home, 'scrollIntoView', '首页服务导航使用 SPA 滚动定位')
expectMatches(homeShellCss, /\.khome\s+\.khome-inner[\s\S]{0,180}?width:\s*min\(1080px,/, '首页外壳最大 1080px')
expectMatches(homeServicesCss, /\.khome\s+\.home-service-catalog[\s\S]{0,220}?gap:\s*26px/, '首页服务目录使用 26px 纵向节奏')
expectMatches(homeServicesCss, /\.khome\s+\.home-reference-panel[\s\S]{0,320}?scroll-margin-top:\s*112px/, '首页服务面板为吸顶导航预留定位距离')
expectMatches(homeResponsiveCss, /@media\s*\(max-width:\s*760px\)/, '首页在 760px 进入原型响应式布局')
expectMatches(homeResponsiveCss, /@media\s*\(max-width:\s*520px\)/, '首页在 520px 进入紧凑布局')

// 导航只属于首页，并还原原型 6/3 列、56px 触控和活动反馈。
expect(nav.length > 0, 'ReferenceServiceNav 组件存在')
expectMatches(nav, /useLocation/, '导航读取当前 hash 提供活动反馈')
expectMatches(nav, /aria-current=/, '导航暴露 aria-current')
for (const [label, hash] of expectedItems) {
  expectMatches(nav, new RegExp(`label:\\s*['"]${label}['"][\\s\\S]{0,80}?hash:\\s*['"]${hash}['"]`), `导航保留 ${label} -> ${hash}`)
}
expectMatches(nav, /navigate\(\{\s*pathname:\s*['"]\/['"],\s*hash:\s*item\.hash\s*\}\)/, '导航使用无刷新首页 hash 跳转')
expect(!/\bhref\s*=|window\.location|location\.(?:assign|replace|reload)/.test(nav), '导航不硬刷新')
expectPageScopedCss(navCss, '首页导航 CSS', '.khome')
expectPageScopedCss(layoutCss, '首页服务布局 CSS', '.khome')
expectMatches(navCss, /position:\s*sticky/, '首页分类导航吸顶')
expectMatches(navCss, /grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\)/, '首页分类导航桌面六列')
expectMatches(navCss, /min-(?:height|block-size):\s*56px/, '首页分类导航触控目标 56px')
expectMatches(navCss, /@media\s*\(max-width:\s*760px\)[\s\S]*repeat\(3,\s*minmax\(0,\s*1fr\)\)/, '首页分类导航 760px 三列')
expectMatches(layoutCss, /lf-reference-group-head[\s\S]{0,360}?min-(?:height|block-size):\s*72px/, '首页服务分组头 72px')
expectMatches(layoutCss, /lf-reference-primary[\s\S]{0,420}?min-(?:height|block-size):\s*104px/, '首页主入口 104px')
expectMatches(layoutCss, /lf-reference-secondary[\s\S]{0,420}?min-(?:height|block-size):\s*88px/, '首页次入口 88px')
expectMatches(layoutCss, /lf-reference-primary[\s\S]{0,520}?border-radius:\s*12px/, '首页主入口使用 12px 圆角')
expectMatches(layoutCss, /@media\s*\(max-width:\s*760px\)[\s\S]*lf-reference-pair[\s\S]{0,360}?grid-template-columns:\s*1fr/, '首页并列面板在 760px 折叠')
expectMatches(homeServicesCss, /\.home-reference-panel--half\s+\.home-reference-primary-list\s*\{[^}]*grid-template-columns:\s*1fr/, '首页半宽分组的主入口按 4188 单列堆叠')
for (const [groupId, icon] of [['resume', 'doc-check'], ['job-fairs', 'fair'], ['interview', 'mic'], ['policy', 'files']]) {
  const groupStart = serviceGroups.search(new RegExp(`id:\\s*['"]${groupId}['"]`))
  const layoutStart = groupStart >= 0 ? serviceGroups.indexOf('layout:', groupStart) : -1
  const groupHeader = groupStart >= 0 && layoutStart > groupStart ? serviceGroups.slice(groupStart, layoutStart) : ''
  expectIncludes(groupHeader, `icon: '${icon}'`, `首页 ${groupId} 组图标使用 4188 最近语义`)
}

// Assistant 恢复自身任务 → 对话 → 输入工作台，并保留真实链路。
for (const marker of ['assistant-task-grid', 'assistant-conversation', 'assistant-composer']) {
  expectIncludes(assistant, marker, `Assistant 恢复 ${marker} 页面语法`)
}
for (const marker of ['chatWithAssistant', 'newSessionId', 'LazyCallPanel', 'KioskKeyboard']) {
  expectIncludes(assistant, marker, `Assistant 保留真实 ${marker} 链路`)
}
expectMatches(assistant, /className="kassist-sr-only"[^>]*>AI助手</, 'Assistant 保留无可见标题的可访问名称')
expectMatches(assistantShellCss, /\.kassist\.kassist-lightflow\s*\{[\s\S]{0,1600}?padding:\s*28px\s+50px\s+calc\(112px/, 'Assistant 桌面端使用 4188 的 50px 页边距')

// Profile 恢复开放式五区等权目录，保留真实身份与会话数据。
for (const marker of ['<ProfileHeader', '<ProfileEntrySection', '<ProfileSessionRecords']) {
  expectIncludes(profile, marker, `ProfilePage 保留 ${marker}`)
}
expectIncludes(profile, 'className="kp-service-directory"', 'ProfilePage 保留个人服务目录')
expectAbsent(profileEntrySection, 'primaryEntry', 'Profile 不把每组第一项强制升级为主入口')
expectAbsent(profileEntrySection, 'lf-reference-primary', 'Profile 入口保持等权')
expectIncludes(profileEntrySection, 'kp-entry-grid', 'Profile 使用等权入口网格')
for (const title of ['我的资产', '常用服务', '招聘会与活动', '权益与政策', '账户与支持']) {
  expectIncludes(profileEntries, title, `Profile 保留独立分区：${title}`)
}
for (const callback of ['onPrintFile', 'onDeleteResume', 'onDeleteScan', 'onDeleteAiRecord']) {
  expectIncludes(profileSessionRecords, callback, `ProfileSessionRecords 保留真实 ${callback} 回调`)
}
expectIncludes(profile, 'useMemberProfileOverview', 'Profile 保留真实服务端统计')
expectMatches(profile, /className="kprofile-sr-only"[^>]*>我的</, 'Profile 保留无可见标题的可访问名称')
expectAbsent([profile, profileHeader, profileEntrySection, profileSessionRecords].join('\n'), 'p-hero', 'Profile 不恢复旧 Hero')
expectMatches(profileShellCss, /\.kp-inner\s*\{[\s\S]{0,180}?width:\s*min\(980px,\s*calc\(100%\s*-\s*100px\)\)/, 'Profile 桌面端使用 4188 的 50px 页边距')
for (const tone of ['teal', 'slate', 'plum', 'clay', 'wheat', 'rose', 'ink']) {
  expectAbsent(profileDirectoryCss, `.kp-entry-icon.${tone}`, `Profile 入口图标不使用非 4188 的 ${tone} 多彩覆盖`)
}

if (failures > 0) {
  console.error(`\n${failures} 个 4188 页面语法合同检查失败`)
  process.exit(1)
}

console.log('\nALL PASS LightFlow 三主 Tab 4188 页面语法一致性静态合同')
