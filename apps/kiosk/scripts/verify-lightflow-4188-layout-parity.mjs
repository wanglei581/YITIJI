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

function expectCssScopes(source, label) {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const allowedRoots = /^(?:\.khome\b|\.kassist\.kassist-lightflow\b|\.kprofile\.kprofile-lightflow\b)/
  const selectorBlocks = [...withoutComments.matchAll(/([^{}]+)\{/g)]
    .map((match) => match[1].trim())
    .filter((selector) => selector && !selector.startsWith('@'))

  expect(selectorBlocks.length > 0, `${label} 定义页面局部选择器`)
  for (const selectorBlock of selectorBlocks) {
    for (const selector of selectorBlock.split(',')) {
      const normalized = selector.trim()
      expect(allowedRoots.test(normalized), `${label} 选择器限定在允许的页面根：${normalized}`)
    }
  }
  expect(!/(?:^|[^\w-])(?:html|body|:root)\b|\.me-inkdetail\b/.test(withoutComments), `${label} 不覆盖全局根或 /me/* 明细页`)
}

const requiredClasses = [
  'lf-reference-panel',
  'lf-reference-group-head',
  'lf-reference-primary',
  'lf-reference-secondary',
  'lf-reference-pair',
]
const expectedItems = [
  ['简历服务', '#resume'],
  ['岗位信息', '#jobs'],
  ['招聘会', '#job-fairs'],
  ['打印扫描', '#print-scan'],
  ['面试训练', '#interview'],
  ['政策服务', '#policy'],
]

console.log('\n=== LightFlow 三主 Tab 4188 布局一致性静态合同 ===')

const home = read('src/pages/home/HomePage.tsx')
const assistant = read('src/pages/assistant/AssistantPage.tsx')
const profile = read('src/pages/profile/ProfilePage.tsx')
const profileHeader = read('src/pages/profile/components/ProfileHeader.tsx')
const profileEntrySection = read('src/pages/profile/components/ProfileEntrySection.tsx')
const profileSessionRecords = read('src/pages/profile/components/ProfileSessionRecords.tsx')
const profileStylesheets = [
  'src/pages/profile/profile-inkpaper.css',
  'src/pages/profile/profile-lightflow-shell.css',
  'src/pages/profile/profile-lightflow-directory.css',
  'src/pages/profile/profile-lightflow-state.css',
].map((path) => [path, read(path)])
const nav = read('src/components/lightflow/ReferenceServiceNav.tsx')
const navCss = read('src/components/lightflow/reference-service-nav.css')
const layoutCss = read('src/components/lightflow/reference-layout.css')

for (const [name, source] of Object.entries({ Home: home, Assistant: assistant, Profile: profile })) {
  expectMatches(
    source,
    /import\s*\{\s*ReferenceServiceNav\s*\}\s*from\s*['"][^'"]+ReferenceServiceNav['"]/,
    `${name} 导入 ReferenceServiceNav`,
  )
  expectIncludes(source, '<ReferenceServiceNav', `${name} 渲染共享顶部分类导航`)
}

for (const [name, source] of Object.entries({ Home: home, Assistant: assistant })) {
  for (const className of requiredClasses) {
    expectIncludes(source, className, `${name} 使用 ${className}`)
  }
}

const profileComposition = [profile, profileHeader, profileEntrySection, profileSessionRecords].join('\n')
for (const className of requiredClasses) {
  expectIncludes(profileComposition, className, `Profile 组合源使用 ${className}`)
}
expectIncludes(profile, '<ProfileHeader', 'ProfilePage 挂载真实身份概览组件')
expectIncludes(profile, '<ProfileEntrySection', 'ProfilePage 挂载真实目录入口组件')
expectIncludes(profile, '<ProfileSessionRecords', 'ProfilePage 保留真实会话记录组件')
expectIncludes(profile, 'className="lf-reference-pair"', 'ProfilePage 负责目录工作面板配对布局')
expectMatches(profileHeader, /className="lf-reference-panel\s+kp-profile-header"/, 'ProfileHeader 使用共享面板原语')
expectMatches(profileHeader, /className="lf-reference-group-head\s+kp-profile-main"/, 'ProfileHeader 使用共享分组头原语')
expectMatches(profileEntrySection, /primary\s*\?\s*'lf-reference-primary'\s*:\s*'lf-reference-secondary'/, 'ProfileEntrySection 区分主入口与次入口原语')
expectMatches(profileEntrySection, /className="lf-reference-panel\s+kp-section"/, 'ProfileEntrySection 使用共享面板原语')
expectMatches(profileSessionRecords, /className="lf-reference-panel\s+kp-session-records"/, 'ProfileSessionRecords 使用共享面板原语')
expectIncludes(profileSessionRecords, 'className="lf-reference-group-head"', 'ProfileSessionRecords 使用共享分组头原语')
expectIncludes(profileSessionRecords, 'className="lf-reference-secondary kp-session-row"', 'ProfileSessionRecords 使用共享次入口原语')
for (const callback of ['onPrintFile', 'onDeleteResume', 'onDeleteScan', 'onDeleteAiRecord']) {
  expectIncludes(profileSessionRecords, callback, `ProfileSessionRecords 保留真实 ${callback} 回调`)
}
expectAbsent(profileComposition, 'p-hero', 'Profile 入口组合源不恢复旧 p-hero 骨架')
for (const [path, source] of profileStylesheets) {
  expect(source.length > 0, `${path} 存在`)
  expect(!/^\s*(?:html|body|:root)\b/m.test(source), `${path} 不覆盖全局根`)
  expectAbsent(source, '.me-inkdetail', `${path} 不泄漏到 /me/* 明细页`)
}

expect(nav.length > 0, 'ReferenceServiceNav 共享组件存在')
expectMatches(nav, /import\s*\{\s*useNavigate\s*\}\s*from\s*['"]react-router-dom['"]/, '导航组件使用 React Router useNavigate')
expectMatches(nav, /export\s+function\s+ReferenceServiceNav\s*\(\s*\)/, '导航组件不接受业务数据')
for (const [label, hash] of expectedItems) {
  expectMatches(nav, new RegExp(`label:\\s*['"]${label}['"][\\s\\S]{0,80}?hash:\\s*['"]${hash}['"]`), `导航保留 ${label} -> ${hash}`)
}
const itemPositions = expectedItems.map(([label]) => nav.indexOf(`label: '${label}'`))
expect(
  itemPositions.every((position, index) => position >= 0 && (index === 0 || position > itemPositions[index - 1])),
  '导航六个固定标签保持参考顺序',
)
expectMatches(nav, /navigate\(\{\s*pathname:\s*['"]\/['"],\s*hash:\s*item\.hash\s*\}\)/, '导航使用无刷新的首页 hash 跳转')
expect(!/\bhref\s*=|window\.location|location\.(?:assign|replace|reload)/.test(nav), '导航不使用硬链接、硬刷新或 window.location')

const homeHeroIndex = home.indexOf('className="service-value"')
const identityPanelIndex = home.indexOf('<IdentityPanel />')
const continuePanelIndex = home.indexOf('<ContinuePanel />')
const homeNavIndex = home.indexOf('<ReferenceServiceNav />')
expect(
  [homeHeroIndex, identityPanelIndex, continuePanelIndex, homeNavIndex].every((index) => index >= 0)
    && homeHeroIndex < identityPanelIndex
    && identityPanelIndex < continuePanelIndex
    && continuePanelIndex < homeNavIndex,
  '首页保留 Hero、身份卡、继续办理并按固定顺序接入共享导航',
)
expectIncludes(home, 'const { hash } = useLocation()', '首页读取 SPA hash')
expectIncludes(home, 'HOME_REFERENCE_HASH_IDS.has(targetId)', '首页只滚动已批准的服务锚点')
expectMatches(
  home,
  /document\.getElementById\(targetId\)\?\.scrollIntoView\(\{\s*behavior:\s*'smooth',\s*block:\s*'start'\s*\}\)/,
  '首页用 scrollIntoView 执行无刷新的 hash 滚动',
)

for (const legacyToken of [
  'className="a-hero assistant-service-intro"',
  'className="assistant-service-desk"',
  'className="assistant-workbench"',
  'className="assistant-service-catalog"',
]) {
  expectAbsent(assistant, legacyToken, `Assistant 不恢复旧 Hero 或侧栏骨架：${legacyToken}`)
}

expect(navCss.length > 0, '导航共享 CSS 存在')
expect(layoutCss.length > 0, '布局共享 CSS 存在')
expectCssScopes(navCss, '导航共享 CSS')
expectCssScopes(layoutCss, '布局共享 CSS')

expectMatches(navCss, /grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\)/, '导航桌面端六等分')
expectMatches(navCss, /min-(?:height|block-size):\s*48px/, '导航触控目标至少 48px')
expectMatches(navCss, /@media\s*\(max-width:\s*500px\)[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/, '导航在 390px 使用三列两行')
for (const className of requiredClasses) {
  expectIncludes(layoutCss, `.${className}`, `布局 CSS 定义 .${className}`)
}
expectMatches(layoutCss, /lf-reference-group-head[\s\S]{0,420}?min-(?:height|block-size):\s*56px/, '分组头最小 56px')
expectMatches(layoutCss, /lf-reference-primary[\s\S]{0,420}?min-(?:height|block-size):\s*104px/, '主入口最小 104px')
expectMatches(layoutCss, /lf-reference-secondary[\s\S]{0,420}?min-(?:height|block-size):\s*80px/, '次入口最小 80px')
expectMatches(layoutCss, /lf-reference-pair[\s\S]{0,420}?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/, '并列工作面板桌面两列')
expectMatches(layoutCss, /@media\s*\(max-width:\s*500px\)[\s\S]*lf-reference-pair[\s\S]{0,420}?grid-template-columns:\s*1fr/, '并列工作面板窄屏单列')

if (failures > 0) {
  console.error(`\n${failures} 个 4188 布局合同检查失败`)
  process.exit(1)
}

console.log('\nALL PASS LightFlow 三主 Tab 4188 布局一致性静态合同')
