// verify-fusion-home · Kiosk 首页静态合同（V3 意图台试点版，2026-08-09）
//
// 首页已按 docs/design/kiosk-ai-os-v3-2026-08/phase2-home-pilot-plan.md 重建为
// V3 意图台（hv3 层），本合同随之从「SvcGrid 8 磁贴」升级为「六服务卡 + 小功能
// 直点子入口」结构守卫。守卫强度不降：真实路由表逐项锁定、门控/登录/合规/
// 触控合同全部保留并针对新结构收紧。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(join(appRoot, relativePath), 'utf8')

const home = read('src/pages/home/HomePage.tsx')
const serviceGroups = read('src/pages/home/serviceGroups.ts')
const css = read('src/styles/prototype-v1.css')
const homeCss = read('src/pages/home/home-v3.css')
const packageJson = read('package.json')

let failures = 0
const expect = (condition, message) => {
  if (condition) console.log(`  PASS ${message}`)
  else {
    failures += 1
    console.error(`  FAIL ${message}`)
  }
}
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function findCodeCharacter(source, character, from = 0) {
  let quote = ''
  let lineComment = false
  let blockComment = false
  let escaped = false

  for (let index = from; index < source.length; index += 1) {
    const current = source[index]
    const next = source[index + 1]
    if (lineComment) {
      if (current === '\n') lineComment = false
      continue
    }
    if (blockComment) {
      if (current === '*' && next === '/') {
        blockComment = false
        index += 1
      }
      continue
    }
    if (quote) {
      if (escaped) escaped = false
      else if (current === '\\') escaped = true
      else if (current === quote) quote = ''
      continue
    }
    if (current === '/' && next === '/') {
      lineComment = true
      index += 1
      continue
    }
    if (current === '/' && next === '*') {
      blockComment = true
      index += 1
      continue
    }
    if (current === "'" || current === '"' || current === '`') {
      quote = current
      continue
    }
    if (current === character) return index
  }
  return -1
}

function extractBalanced(source, openIndex, openCharacter, closeCharacter) {
  if (openIndex < 0 || source[openIndex] !== openCharacter) return ''
  let depth = 0
  let cursor = openIndex
  while (cursor < source.length) {
    const nextOpen = findCodeCharacter(source, openCharacter, cursor)
    const nextClose = findCodeCharacter(source, closeCharacter, cursor)
    if (nextClose < 0) return ''
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth += 1
      cursor = nextOpen + 1
      continue
    }
    depth -= 1
    if (depth === 0) return source.slice(openIndex, nextClose + 1)
    cursor = nextClose + 1
  }
  return ''
}

function extractAssignedArray(source, marker) {
  const markerIndex = source.indexOf(marker)
  const assignment = markerIndex >= 0 ? source.indexOf('=', markerIndex + marker.length) : -1
  const open = assignment >= 0 ? findCodeCharacter(source, '[', assignment + 1) : -1
  return extractBalanced(source, open, '[', ']')
}

function extractPropertyArray(source, property) {
  const propertyMatch = new RegExp(`\\b${escapeRegExp(property)}\\s*:`).exec(source)
  const open = propertyMatch ? findCodeCharacter(source, '[', propertyMatch.index + propertyMatch[0].length) : -1
  return extractBalanced(source, open, '[', ']')
}

function directObjectBlocks(arraySource) {
  const objects = []
  let cursor = 1
  while (cursor < arraySource.length - 1) {
    const open = findCodeCharacter(arraySource, '{', cursor)
    if (open < 0) break
    const object = extractBalanced(arraySource, open, '{', '}')
    if (!object) break
    objects.push(object)
    cursor = open + object.length
  }
  return objects
}

function stringField(source, field) {
  const match = new RegExp(`\\b${escapeRegExp(field)}\\s*:\\s*(['"])([^'"]*)\\1`).exec(source)
  return match?.[2] ?? null
}

function extractJsxOpeningTagAt(source, start) {
  if (start < 0) return ''
  let braces = 0
  let quote = ''
  let escaped = false
  for (let index = start; index < source.length; index += 1) {
    const current = source[index]
    if (quote) {
      if (escaped) escaped = false
      else if (current === '\\') escaped = true
      else if (current === quote) quote = ''
      continue
    }
    if (current === "'" || current === '"' || current === '`') quote = current
    else if (current === '{') braces += 1
    else if (current === '}') braces -= 1
    else if (current === '>' && braces === 0) return source.slice(start, index + 1)
  }
  return ''
}

function stripCommentsAndStrings(source) {
  let result = ''
  let quote = ''
  let lineComment = false
  let blockComment = false
  let escaped = false

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index]
    const next = source[index + 1]
    if (lineComment) {
      if (current === '\n') {
        lineComment = false
        result += '\n'
      } else result += ' '
      continue
    }
    if (blockComment) {
      if (current === '*' && next === '/') {
        result += '  '
        blockComment = false
        index += 1
      } else result += current === '\n' ? '\n' : ' '
      continue
    }
    if (quote) {
      if (escaped) escaped = false
      else if (current === '\\') escaped = true
      else if (current === quote) quote = ''
      result += current === '\n' ? '\n' : ' '
      continue
    }
    if (current === '/' && next === '/') {
      result += '  '
      lineComment = true
      index += 1
    } else if (current === '/' && next === '*') {
      result += '  '
      blockComment = true
      index += 1
    } else if (current === "'" || current === '"' || current === '`') {
      result += ' '
      quote = current
    } else result += current
  }
  return result
}

function extractFunctionBody(source, functionName) {
  const declaration = new RegExp(`\\bfunction\\s+${escapeRegExp(functionName)}\\s*\\(`).exec(source)
  if (!declaration) return ''
  // 参数表可能包含解构 {}，先跳过完整括号对，再取函数体大括号。
  const params = extractBalanced(source, declaration.index + declaration[0].length - 1, '(', ')')
  const afterParams = declaration.index + declaration[0].length - 1 + params.length
  const open = findCodeCharacter(source, '{', afterParams)
  return extractBalanced(source, open, '{', '}')
}

function extractReturnedRootTag(functionBody) {
  const code = stripCommentsAndStrings(functionBody)
  const returnMatch = /\breturn\s*\(/.exec(code)
  if (!returnMatch) return ''
  let rootStart = returnMatch.index + returnMatch[0].length
  while (/\s/.test(code[rootStart] ?? '')) rootStart += 1
  if (code[rootStart] !== '<' || code[rootStart + 1] === '>') return ''
  return extractJsxOpeningTagAt(functionBody, rootStart)
}

function cssRule(source, selector) {
  const match = new RegExp(`^${escapeRegExp(selector)}\\s*\\{`, 'm').exec(source)
  if (!match) return ''
  const open = source.indexOf('{', match.index)
  return extractBalanced(source, open, '{', '}')
}

console.log('\n=== Kiosk 首页 V3 意图台静态合同 ===')

// ── 共享壳集成：KioskPageFrame + kpv1 content-only + hv3 视觉层 ──
const pageStart = home.indexOf('export function HomePage()')
const page = pageStart >= 0 ? home.slice(pageStart) : ''
const homePageBody = extractFunctionBody(home, 'HomePage')
const frameTag = extractReturnedRootTag(homePageBody)

expect(
  /import\s*\{[^}]*\bKioskPageFrame\b[^}]*\}\s*from\s*['"]@ai-job-print\/ui['"]/.test(home),
  '从 @ai-job-print/ui 导入 KioskPageFrame',
)
expect(
  /^<KioskPageFrame\b/.test(frameTag) &&
    /kpv1/.test(frameTag) &&
    /kpv1--content-only/.test(frameTag) &&
    /\bhv3\b/.test(frameTag) &&
    !/\bheader\s*=/.test(frameTag) &&
    !/\bfooter\s*=/.test(frameTag),
  'HomePage 根节点是 KioskPageFrame + kpv1--content-only + hv3（共享壳提供顶栏/底栏）',
)
expect(!/<div\s+[^>]*className\s*=\s*['"]kpv1['"][^>]*>/.test(page), '旧 div.kpv1 根节点未回潮')
expect(!/<main\b/.test(page), 'HomePage 不在 KioskLayout 主地标内嵌套 main')
expect(!/<KioskTopBar\b/.test(page), '首页不自绘 KioskTopBar')
expect(!/<HomeNavbar\b/.test(page) && !/function HomeNavbar/.test(home), '首页不自绘 HomeNavbar')

// ── V3 主体顺序：版头 → 指令胶囊 → 续办 → 服务卡 → 门控专区 → 底部（合规+仪表） ──
const bodyIndexes = [
  page.indexOf(frameTag),
  page.search(/<HomeHero\b[^>]*\/>/),
  page.search(/<HomeCommand\s*\/>/),
  page.search(/<ContinuePanel\s*\/>/),
  page.search(/<HomeServiceNav\s*\/>/),
  page.search(/<ZoneRow\s*\/>/),
  page.search(/<section\s+[^>]*className\s*=\s*['"]hv3-foot['"][^>]*>/),
  page.search(/<div\s+[^>]*className\s*=\s*['"]notice['"][^>]*>/),
  page.search(/<HomeDevicePanel\s*\/>/),
  page.indexOf('</KioskPageFrame>'),
]
expect(
  bodyIndexes.every((index, position) => index >= 0 && (position === 0 || index > bodyIndexes[position - 1])),
  '主体保持 版头 → 指令胶囊 → 续办 → 服务卡 → 门控专区 → 合规提示 + 本机仪表 顺序',
)

// ── V3 入口数据源：HOME_SERVICE_CARDS 主入口 + 子入口逐项锁定 ──
const cardsArray = extractAssignedArray(serviceGroups, 'export const HOME_SERVICE_CARDS')
const cardObjects = directObjectBlocks(cardsArray)
const expectedCards = [
  ['print-scan', '打印扫描', '/print-scan', 'lg'],
  ['resume', 'AI简历服务', '/resume-service', 'lg'],
  ['jobs', '岗位信息', '/jobs-service', 'sm'],
  ['fairs', '招聘会', '/fairs-service', 'sm'],
  ['interview', 'AI面试训练', '/interview-service', 'sm'],
  ['policy', '政策服务', '/policy-service', 'sm'],
]
const actualCards = cardObjects.map((card) => [
  stringField(card, 'id'),
  stringField(card, 'title'),
  stringField(card, 'to'),
  stringField(card, 'size'),
])
expect(
  JSON.stringify(actualCards) === JSON.stringify(expectedCards),
  'HOME_SERVICE_CARDS 精确保留六个主入口的 id/标题/路由/尺寸与顺序',
)

const expectedSubs = new Map([
  ['print-scan', [['上传打印', '/print/upload'], ['扫描原件', '/scan/start'], ['图片转PDF', '/print-scan/convert'], ['签章', '/print-scan/sign']]],
  ['resume', [['简历诊断', '/resume/source?intent=diagnose'], ['简历生成', '/resume/generate'], ['岗位匹配', '/resume/job-fit'], ['素材模板', '/resume/templates'], ['职业规划', '/resume/career-plan']]],
  ['jobs', [['岗位列表', '/jobs'], ['找企业', '/companies'], ['线下机构', '/offline-agencies']]],
  ['fairs', [['场次列表', '/job-fairs'], ['校园招聘', '/campus'], ['现场签到', '/job-fairs/checkin']]],
  ['interview', [['开始练习', '/interview/setup'], ['历史报告', '/interview/reports']]],
  ['policy', [['就业政策', '/renshi?tab=policy'], ['社保指南', '/renshi?tab=social'], ['档案登记', '/renshi?tab=register']]],
])
for (const card of cardObjects) {
  const id = stringField(card, 'id')
  const subs = directObjectBlocks(extractPropertyArray(card, 'subs')).map((sub) => [
    stringField(sub, 'label'),
    stringField(sub, 'to'),
  ])
  expect(
    JSON.stringify(subs) === JSON.stringify(expectedSubs.get(id) ?? null),
    `小功能直点子入口逐项锁定：${id}`,
  )
}

// ── 服务卡渲染合同：nav 可访问名称 + svc-tile 主入口 + hv3-sub 子入口按钮 ──
const serviceNavBody = extractFunctionBody(home, 'HomeServiceNav')
expect(
  /<nav\s+className="hv3-services"\s+aria-label="服务入口">/.test(serviceNavBody),
  '服务区使用 nav[aria-label=服务入口]（浏览器合同锚点）',
)
expect(
  /className="hv3-card-main svc-tile"\s+onClick=\{\(\) => navigate\(card\.to\)\}/.test(serviceNavBody),
  '主入口按钮保留 .svc-tile 触控合同类并导航 card.to',
)
expect(
  /className="hv3-sub"\s+onClick=\{\(\) => navigate\(sub\.to\)\}/.test(serviceNavBody),
  '子入口按钮 .hv3-sub 导航 sub.to（真实路由直点）',
)
expect(
  /HOME_SERVICE_CARDS\.filter\(\(card\) => card\.size === 'lg'\)/.test(serviceNavBody) &&
    /HOME_SERVICE_CARDS\.filter\(\(card\) => card\.size === 'sm'\)/.test(serviceNavBody),
  '双列大卡 + 四列紧凑卡由同一数据源驱动',
)

// ── AI 接待台行为（重排视觉不改语义） ──
const commandBody = extractFunctionBody(home, 'HomeCommand')
expect(
  /className="hv3-cmd-ask"\s+onClick=\{\(\) => navigate\('\/assistant'\)\}/.test(commandBody),
  '指令胶囊输入区进入 /assistant',
)
expect(/aria-label="语音输入"[\s\S]{0,120}?navigate\('\/assistant'\)/.test(commandBody), '麦克风进入 /assistant')
expect(/让小青安排/.test(commandBody), 'CTA 保留「让小青安排」')
expect(/将进入 AI 顾问，由你确认办理方案/.test(commandBody), '保留「由你确认办理方案」诚实提示')
expect(
  /navigate\('\/assistant', \{ state: \{ topic: 'resume' \} \}\)/.test(commandBody) &&
    /navigate\('\/assistant', \{ state: \{ topic: 'jobfair' \} \}\)/.test(commandBody),
  '场景 chips 保留 state.topic（resume / jobfair）',
)
expect(
  /navigate\('\/print\/upload'\)[\s\S]{0,300}?打印手机里的文件/.test(commandBody),
  '「打印手机里的文件」直达 /print/upload',
)

// ── 登录入口合同 ──
const heroBody = extractFunctionBody(home, 'HomeHero')
expect(/const\s*\{[^}]*\bisLoggedIn\b[^}]*\}\s*=\s*useAuth\(\)/s.test(heroBody), '登录态来自 useAuth.isLoggedIn')
expect(/const\s*\{[^}]*\bdisplayName\b[^}]*\}\s*=\s*useAuth\(\)/s.test(heroBody) && heroBody.includes('{displayName}'), '登录态展示真实 displayName')
expect(/isLoggedIn\s*\?[\s\S]*?navigate\('\/profile'\)[\s\S]*?进入我的/.test(heroBody), '登录态「进入我的」导航到 /profile')
expect(!home.includes('<MemberLoginDialog'), '首页不挂载独立登录弹窗')
expect(/const openLogin = \(\) => navigate\('\/login', \{ state: \{ from: '\/' \} \}\)/.test(home), '游客登录入口统一跳转 /login 并保留首页返回路径')
expect(!/setLoginOpen|continueAsGuest/.test(home), '首页不维护第二套登录弹窗状态')

// ── 真实设备状态：共享壳拉取 + 首页仪表诚实展示 ──
expect(/useTerminalDeviceStatus\(\s*true\s*\)/.test(read('src/layouts/KioskRoot.tsx')), '真实设备状态由共享壳拉取')
expect(read('src/layouts/KioskRoot.tsx').includes('<KioskTopbarStatus'), '共享顶栏注入设备状态')
const panelBody = extractFunctionBody(home, 'HomeDevicePanel')
expect(/useOutletContext<TerminalDeviceStatusView>\(\)/.test(panelBody), '本机仪表消费共享壳 Outlet 设备状态')
expect(/仅展示本机实时检测到的状态/.test(panelBody), '仪表保留「仅展示本机实时检测到的状态」口径')
expect(/材料扫描进入后检测/.test(panelBody) && /双面能力提交前确认/.test(panelBody), '未实时检测项如实标注，不写「正常」')
expect(!/useTerminalDeviceStatus\s*\(/.test(home), '首页不再次启动独立设备状态轮询')

// ── 百宝箱 / 智慧校园门控（修复无条件渲染缺陷后不得回潮） ──
expect(/<ZoneRow\s*\/>/.test(page), '首页挂载门控 ZoneRow')
expect(/const toolbox = useToolboxConfig\(\)/.test(home) && /const campus = useSmartCampusConfig\(\)/.test(home), '保留百宝箱/智慧校园真实配置 hooks')
expect(/const showToolbox = toolbox\.enabled/.test(home) && /const showCampus = campus\.enabled/.test(home) && /if \(!showToolbox && !showCampus\) return null/.test(home), '保留百宝箱/智慧校园诚实门控')
expect(!/function SvcGrid/.test(home), '旧 SvcGrid 无门控磁贴已移除且未回潮')

// ── 合规红线 ──
const complianceNotice = /岗位与招聘会信息均来自第三方\s*\/\s*官方来源，本终端仅提供信息展示与跳转，投递、预约请前往来源平台办理。/
expect(complianceNotice.test(home), '保留完整合规提示文案')
const complianceSurface = `${home}\n${serviceGroups}\n${css}\n${homeCss}`
expect(!/一键投递|立即投递/.test(complianceSurface), '拒绝「一键投递」/「立即投递」')
expect(!/(?<!来源)平台投递/.test(complianceSurface), '「平台投递」仅允许「来源平台投递」语境')

// ── 路由白名单：首页与数据源不得引入未声明 route literal ──
const rootSrc = read('src/layouts/KioskRoot.tsx')
const tabPathBody = (() => {
  const start = rootSrc.indexOf('function tabToPath')
  const nextFn = rootSrc.slice(start + 1).search(/\nfunction |\nexport function /)
  const end = nextFn >= 0 ? start + 1 + nextFn : rootSrc.indexOf('export function KioskRoot', start)
  return start >= 0 && end > start ? rootSrc.slice(start, end) : ''
})()
const legacyGroupsArray = extractAssignedArray(serviceGroups, 'export const SERVICE_GROUPS')
const legacyGroupObjects = directObjectBlocks(legacyGroupsArray)
const legacyTileObjects = legacyGroupObjects.flatMap((group) => directObjectBlocks(extractPropertyArray(group, 'tiles')))
const declaredRoutes = new Set([
  ...[...serviceGroups.matchAll(/(?:to|titleTo)\s*:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]),
  ...[...home.matchAll(/navigate\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]),
  ...[...tabPathBody.matchAll(/return\s*['"](\/[^'"]*)['"]/g)].map((match) => match[1]),
])
const allowedRoutes = new Set([
  ...expectedCards.map(([, , route]) => route),
  ...[...expectedSubs.values()].flat().map(([, route]) => route),
  // legacy SERVICE_GROUPS（合同锚点数据，不渲染）与通用入口
  ...legacyTileObjects.map((tile) => stringField(tile, 'to')).filter(Boolean),
  '/print-scan', '/print/upload', '/profile', '/assistant', '/login', '/', '/toolbox', '/smart-campus',
])
expect([...declaredRoutes].every((route) => allowedRoutes.has(route)), '未新增或替换任何真实 route literal')
expect(!/\bfetch\s*\(/.test(home + serviceGroups), '首页未新增 fetch')
const productionIdentifiers = stripCommentsAndStrings(`${home}\n${serviceGroups}`).match(/\b[A-Za-z_$][\w$]*\b/g) ?? []
const demoMockIdentifiers = productionIdentifiers.filter((identifier) => /^(?:demo|mock|useDemo|useMock)/i.test(identifier))
expect(demoMockIdentifiers.length === 0, '首页生产代码未新增 demo*/mock*/useDemo*/useMock* 标识符')

// ── legacy SERVICE_GROUPS 合同锚点（不渲染但不得漂移，清理须随门禁改造另行立项） ──
const expectedLegacyGroups = [
  ['resume', 'AI简历服务'],
  ['jobs', '岗位信息'],
  ['job-fairs', '招聘会'],
  ['print-scan', '打印扫描'],
  ['interview', 'AI面试训练'],
  ['policy', '政策服务'],
]
const actualLegacyGroups = legacyGroupObjects.map((group) => [stringField(group, 'id'), stringField(group, 'title')])
expect(JSON.stringify(actualLegacyGroups) === JSON.stringify(expectedLegacyGroups), 'legacy SERVICE_GROUPS 保留六组 exact id/title/order（合同锚点）')
const disabledTiles = legacyTileObjects.filter((tile) => /\bdisabled\s*:\s*(?:true|Boolean\s*\(\s*true\s*\))\s*(?=[,}])/.test(tile))
expect(
  disabledTiles.length === 2 &&
    JSON.stringify(disabledTiles.map((tile) => stringField(tile, 'title'))) === JSON.stringify(['证件复印', '证件照打印']),
  'legacy disabled 语义精确为两项：证件复印、证件照打印',
)

// ── 触控硬约束（home-v3.css）：子入口 ≥48px，主入口/主按钮 ≥56px ──
expect(/--hv3-touch-min:\s*48px/.test(homeCss) && /--hv3-touch-primary:\s*56px/.test(homeCss), 'hv3 触控 token：min=48px / primary=56px')
expect(/\.kpv1\.hv3 \.hv3-sub\s*\{[^}]*min-height:\s*var\(--hv3-touch-min\)/.test(homeCss), '子入口 .hv3-sub min-height ≥48px（token 驱动）')
const cardMainRule = cssRule(homeCss, '.kpv1.hv3 .hv3-card-main.svc-tile')
const cardMainMin = Number((/min-height:\s*(\d+)px/.exec(cardMainRule) ?? [])[1] ?? 0)
expect(cardMainMin >= 56, `主入口 .hv3-card-main.svc-tile min-height=${cardMainMin}px ≥56px`)
const gridBMainMin = Number((/\.kpv1\.hv3 \.hv3-grid-b \.hv3-card-main\.svc-tile\s*\{[^}]*min-height:\s*(\d+)px/.exec(homeCss) ?? [])[1] ?? 0)
expect(gridBMainMin >= 56, `紧凑卡主入口 min-height=${gridBMainMin}px ≥56px`)
expect(/\.kpv1\.hv3 \.hv3-cmd-ask\s*\{[^}]*min-height:\s*var\(--hv3-touch-primary\)/.test(homeCss), '指令胶囊输入区 ≥56px')
expect(/\.kpv1\.hv3 \.hv3-cmd-go\s*\{[^}]*min-height:\s*var\(--hv3-touch-primary\)/.test(homeCss), '主按钮「让小青安排」≥56px')
expect(/\.kpv1\.hv3 \.hv3-scene\s*\{[^}]*min-height:\s*var\(--hv3-touch-min\)/.test(homeCss), '场景 chips ≥48px')
const loginRule = cssRule(homeCss, '.kpv1.hv3 .login-btn')
const loginMin = Number((/min-height:\s*(\d+)px/.exec(loginRule) ?? [])[1] ?? 0)
expect(loginMin >= 56, `登录按钮 .login-btn min-height=${loginMin}px ≥56px（浏览器合同锚点）`)

// ── hv3 层作用域纪律：全部选择器挂 .kpv1.hv3 根，不污染全站 ──
const isKeyframeSelector = (prelude) =>
  prelude.split(',').every((part) => /^(?:\d+%|from|to)$/.test(part.trim()))
const homeCssNoComments = homeCss.replace(/\/\*[\s\S]*?\*\//g, '')
const hv3Preludes = [...homeCssNoComments.matchAll(/(^|\n)\s*([^@{}\n][^{}]*)\{/g)]
  .map((match) => match[2].trim())
  .filter((prelude) => prelude.length > 0 && !isKeyframeSelector(prelude))
expect(
  hv3Preludes.length > 0 &&
    hv3Preludes.every((prelude) => prelude.split(',').every((selector) => selector.trim().startsWith('.kpv1.hv3'))),
  'home-v3.css 全部选择器以 .kpv1.hv3 开头（无全站泄漏）',
)

// ── 共享壳集成 CSS（prototype-v1.css 保持不变的合同） ──
const kpv1RootRule = cssRule(css, '.kpv1')
const kpv1ContentRule = cssRule(css, '.kpv1.kpv1--content-only')
const kpv1ContentWrapperRule = cssRule(css, "[data-kiosk-presentation='fusion-youth'] .kpv1--content-only > .ui-kiosk-page-content")
expect(/width:\s*min\(1080px,\s*100%\)/.test(kpv1RootRule) && /display:\s*flex/.test(kpv1RootRule) && /flex-direction:\s*column/.test(kpv1RootRule), '.kpv1 保留关键根布局规则')
expect(/background:\s*transparent/.test(kpv1ContentRule) && /min-height:\s*0/.test(kpv1ContentRule), '.kpv1--content-only 交给共享壳承载舞台背景')
expect(
  /padding:\s*0\s*(?:;|})/.test(kpv1ContentWrapperRule) && /gap:\s*0\s*(?:;|})/.test(kpv1ContentWrapperRule),
  '.kpv1--content-only 精确消除共享 content padding/gap',
)

expect(packageJson.includes('"verify:fusion-home": "node scripts/verify-fusion-home.mjs"'), 'package.json 精确注册 verify:fusion-home')

if (failures > 0) {
  console.error(`\nFAIL ${failures} 项 —— Kiosk 首页 V3 意图台合同未满足\n`)
  process.exit(1)
}
console.log('\nALL PASS —— Kiosk 首页 V3 意图台合同满足\n')
