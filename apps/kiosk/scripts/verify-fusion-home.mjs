// verify-fusion-home · Kiosk 首页静态合同（V3 意图台试点版，2026-08-09）
//
// 首页已按 docs/design/kiosk-ai-os-v3-2026-08/phase2-home-pilot-plan.md 重建为
// V3 意图台（hv3 层）。用户 2026-08-09 拍板口径：首页六张服务卡为干净磁贴
// （图标 + 名称 + 一行真实描述，不放子功能小按钮），子功能触达由六个服务
// 中心页承担——本合同同时钉死这两端。
// 路由守卫（2026-08-09 Codex 审查整改）：不再用手写白名单自证，而是解析
// src/routes/index.tsx 生成路由 manifest，把首页/数据源/底栏出现的每个
// route literal 去掉 query 后逐一对照 manifest（支持 :param 段）。
// 1080×1920 首屏/滚动边界几何合同自旧版（73fd04a1）等价迁移恢复。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(join(appRoot, relativePath), 'utf8')

const home = read('src/pages/home/HomePage.tsx')
const serviceGroups = read('src/pages/home/serviceGroups.ts')
const routesSource = read('src/routes/index.tsx')
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

// ── 路由 manifest：解析 src/routes/index.tsx（唯一路由真值源） ──
// 该文件的 path literal 只有两类：绝对路径（顶层/KioskRuntimeRoot 子层）与
// KioskRoot('/') 的相对子路径；index:true 即 '/'。解析结果作为 manifest，
// 所有入口 literal 去 query 后必须能在 manifest 中解析（支持 :param 段）。
const routesCode = stripCommentsAndStrings(routesSource)
const routeManifest = new Set(['/'])
for (const match of routesSource.matchAll(/\bpath:\s*'([^']+)'/g)) {
  // literal 在原文匹配；用 routesCode（注释/字符串已抹成空白）同位置仍保留
  // "path" 关键字来排除注释区里的 path: 字样。
  if (routesCode.slice(match.index, match.index + 4) !== 'path') continue
  const value = match[1]
  if (value === '*') continue
  routeManifest.add(value.startsWith('/') ? value : `/${value}`)
}
expect(routeManifest.size >= 90, `路由 manifest 解析自 src/routes/index.tsx（${routeManifest.size} 条 ≥90，解析未退化）`)
expect(/\{\s*index:\s*true\s*,\s*element:\s*<HomePage\s*\/>\s*\}/.test(routesSource), '路由表 index:true 挂载 HomePage（manifest 含 /）')

const manifestList = [...routeManifest]
const resolvesInManifest = (rawRoute) => {
  const pathname = rawRoute.split('?')[0]
  if (routeManifest.has(pathname)) return true
  const pathSegments = pathname.split('/').filter(Boolean)
  return manifestList.some((route) => {
    const routeSegments = route.split('/').filter(Boolean)
    if (routeSegments.length !== pathSegments.length) return false
    return routeSegments.every((segment, i) => segment.startsWith(':') || segment === pathSegments[i])
  })
}

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

// ── V3 入口数据源：HOME_SERVICE_CARDS 六张干净磁贴逐项锁定 ──
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
expect(
  expectedCards.every(([, , route]) => resolvesInManifest(route)),
  '六个服务中心页路由全部能在路由 manifest 中解析',
)

// ── 干净磁贴口径（用户 2026-08-09 拍板）：卡内不放子功能小按钮 ──
expect(!/\bsubs\s*:/.test(cardsArray), 'HOME_SERVICE_CARDS 不含 subs 子入口字段（干净磁贴）')
expect(!/hv3-subs|hv3-sub\b/.test(home) && !/\.hv3-subs|\.hv3-sub\b/.test(homeCss), '首页与 hv3 层无子入口 pill（.hv3-sub 不得回潮）')
const serviceNavBody = extractFunctionBody(home, 'HomeServiceNav')
expect(
  /<nav\s+className="hv3-services"\s+aria-label="服务入口">/.test(serviceNavBody),
  '服务区使用 nav[aria-label=服务入口]（浏览器合同锚点）',
)
expect(
  /className="hv3-card-main svc-tile"\s+onClick=\{\(\) => navigate\(card\.to\)\}/.test(serviceNavBody),
  '磁贴整卡按钮保留 .svc-tile 触控合同类并导航 card.to（服务中心页）',
)
expect(
  /HOME_SERVICE_CARDS\.filter\(\(card\) => card\.size === 'lg'\)/.test(serviceNavBody) &&
    /HOME_SERVICE_CARDS\.filter\(\(card\) => card\.size === 'sm'\)/.test(serviceNavBody),
  '双列大卡 + 四列紧凑卡由同一数据源驱动',
)

// ── 子功能触达职责在服务中心页（干净磁贴口径的另一端合同） ──
// 首页撤掉的 20 个子功能路由必须仍可从对应服务中心页触达，否则等于砍能力。
const hubReach = new Map([
  ['pages/print-scan/PrintScanHomePage.tsx', ['/print/upload', '/scan/start', '/print-scan/convert', '/print-scan/sign']],
  ['pages/resume/ResumeServiceHubPage.tsx', ['/resume/source?intent=diagnose', '/resume/generate', '/resume/job-fit', '/resume/templates', '/resume/career-plan']],
  ['pages/jobs/JobsServiceHubPage.tsx', ['/jobs', '/companies', '/offline-agencies']],
  ['pages/job-fairs/FairsServiceHubPage.tsx', ['/job-fairs', '/campus', '/job-fairs/checkin']],
  ['pages/interview/InterviewServiceHubPage.tsx', ['/interview/setup', '/interview/reports']],
  ['pages/policy/PolicyServiceHubPage.tsx', ['/renshi?tab=policy', '/renshi?tab=social', '/renshi?tab=register']],
])
for (const [hubPath, routes] of hubReach) {
  const hubSource = read(join('src', hubPath))
  const missing = routes.filter((route) => !hubSource.includes(`'${route}'`))
  expect(missing.length === 0, `服务中心页承担子功能触达：${hubPath}（${missing.length === 0 ? routes.length + ' 项全在' : '缺 ' + missing.join(' ')}）`)
}

// ── AI 接待台行为（明确导航按钮，不伪装输入框） ──
const commandBody = extractFunctionBody(home, 'HomeCommand')
expect(
  /className="hv3-cmd-ask"\s+onClick=\{\(\) => navigate\('\/assistant'\)\}/.test(commandBody),
  '指令胶囊导航按钮进入 /assistant',
)
expect(
  /hv3-cmd-ask-label[\s\S]{0,80}?打开 AI 顾问，描述你的处境/.test(commandBody),
  '导航按钮可见主文案直说进入 AI 顾问（不伪装可输入）',
)
expect(!/<input\b/.test(home) && !/placeholder=/.test(commandBody), '首页无 input/placeholder（不出现假输入框语义）')
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

// ── 百宝箱 / 智慧校园门控（修复无条件渲染缺陷后不得回潮）+ 状态标签诚实 ──
expect(/<ZoneRow\s*\/>/.test(page), '首页挂载门控 ZoneRow')
expect(/const toolbox = useToolboxConfig\(\)/.test(home) && /const campus = useSmartCampusConfig\(\)/.test(home), '保留百宝箱/智慧校园真实配置 hooks')
expect(/const showToolbox = toolbox\.enabled/.test(home) && /const showCampus = campus\.enabled/.test(home) && /if \(!showToolbox && !showCampus\) return null/.test(home), '保留百宝箱/智慧校园诚实门控')
expect(!/function SvcGrid/.test(home), '旧 SvcGrid 无门控磁贴已移除且未回潮')
expect(!home.includes('已审核'), '百宝箱不宣称「已审核」（无审核字段支撑，2026-08-09 红线整改）')
const zoneRowBody = extractFunctionBody(home, 'ZoneRow')
expect(
  /toolboxChips\.length > 0 \? `已上架 \$\{toolboxChips\.length\} 项` : '待配置'/.test(zoneRowBody),
  '百宝箱状态标签只说有数据支撑的事实（已上架 N 项 / 待配置）',
)
expect(zoneRowBody.includes('由后台上架控制'), '百宝箱副标题用「由后台上架控制」类诚实口径')

// ── 合规红线 ──
const complianceNotice = /岗位与招聘会信息均来自第三方\s*\/\s*官方来源，本终端仅提供信息展示与跳转，投递、预约请前往来源平台办理。/
expect(complianceNotice.test(home), '保留完整合规提示文案')
const complianceSurface = `${home}\n${serviceGroups}\n${css}\n${homeCss}`
expect(!/一键投递|立即投递/.test(complianceSurface), '拒绝「一键投递」/「立即投递」')
expect(!/(?<!来源)平台投递/.test(complianceSurface), '「平台投递」仅允许「来源平台投递」语境')

// ── 路由守卫：首页/数据源/底栏的每个 route literal 逐一对照 manifest ──
const rootSrc = read('src/layouts/KioskRoot.tsx')
const tabPathBody = (() => {
  const start = rootSrc.indexOf('function tabToPath')
  const nextFn = rootSrc.slice(start + 1).search(/\nfunction |\nexport function /)
  const end = nextFn >= 0 ? start + 1 + nextFn : rootSrc.indexOf('export function KioskRoot', start)
  return start >= 0 && end > start ? rootSrc.slice(start, end) : ''
})()
const declaredRoutes = [
  ...new Set([
    ...[...serviceGroups.matchAll(/(?:to|titleTo)\s*:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]),
    ...[...home.matchAll(/navigate\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]),
    ...[...tabPathBody.matchAll(/return\s*['"](\/[^'"]*)['"]/g)].map((match) => match[1]),
  ]),
]
const unresolved = declaredRoutes.filter((route) => !resolvesInManifest(route))
expect(
  declaredRoutes.length >= 30 && unresolved.length === 0,
  `首页/数据源/底栏全部 ${declaredRoutes.length} 个 route literal 去 query 后均能在路由 manifest 解析${unresolved.length ? '（未解析：' + unresolved.join(' ') + '）' : ''}`,
)
// 意图白名单：HomePage 直接 navigate 的 literal 不得超出既定入口集合
// （manifest 只证明路由存在，这里钉死首页不悄悄新增入口）。
const homeNavigateLiterals = [...new Set([...home.matchAll(/navigate\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]))]
const homeIntentAllowlist = new Set([
  ...expectedCards.map(([, , route]) => route),
  '/print/upload', '/profile', '/assistant', '/login', '/', '/toolbox', '/smart-campus',
])
expect(
  homeNavigateLiterals.every((route) => homeIntentAllowlist.has(route)),
  'HomePage 直接导航目标不超出既定入口集合（不悄悄新增首页入口）',
)
expect(!/\bfetch\s*\(/.test(home + serviceGroups), '首页未新增 fetch')
const productionIdentifiers = stripCommentsAndStrings(`${home}\n${serviceGroups}`).match(/\b[A-Za-z_$][\w$]*\b/g) ?? []
const demoMockIdentifiers = productionIdentifiers.filter((identifier) => /^(?:demo|mock|useDemo|useMock)/i.test(identifier))
expect(demoMockIdentifiers.length === 0, '首页生产代码未新增 demo*/mock*/useDemo*/useMock* 标识符')

// ── legacy SERVICE_GROUPS 合同锚点（不渲染但不得漂移，清理须随门禁改造另行立项） ──
const legacyGroupsArray = extractAssignedArray(serviceGroups, 'export const SERVICE_GROUPS')
const legacyGroupObjects = directObjectBlocks(legacyGroupsArray)
const legacyTileObjects = legacyGroupObjects.flatMap((group) => directObjectBlocks(extractPropertyArray(group, 'tiles')))
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
// 24 条 legacy 磁贴路由精确合同（自旧版 73fd04a1 恢复；不再用现值自证白名单）
const expectedLegacyRoutes = new Map([
  ['AI简历诊断', '/resume/source?intent=diagnose'], ['AI简历优化', '/resume/source?intent=optimize'],
  ['简历素材库', '/resume/templates'], ['职业规划', '/resume/career-plan'],
  ['简历打印', '/print/upload?source=resume'], ['求职材料', '/resume/materials'],
  ['全职岗位', '/jobs?category=fulltime'], ['实习岗位', '/jobs?category=intern'],
  ['兼职信息', '/jobs?category=parttime'], ['全部岗位', '/jobs'], ['找企业', '/companies'],
  ['岗位大师', '/resume/job-fit'], ['社会招聘会', '/job-fairs'], ['校园招聘会', '/campus'],
  ['扫码签到', '/job-fairs/checkin'], ['文档打印', '/print/upload?source=document'],
  ['纸质扫描', '/scan/start'], ['格式转换', '/print-scan/convert'], ['模拟面试', '/interview/setup'],
  ['面试技巧', '/interview/tips'], ['面试报告', '/interview/reports'], ['就业政策', '/renshi?tab=policy'],
  ['社保指南', '/renshi?tab=social'], ['档案 / 登记', '/renshi?tab=register'],
])
for (const [title, route] of expectedLegacyRoutes) {
  const matches = legacyTileObjects.filter((tile) => stringField(tile, 'title') === title)
  expect(matches.length === 1 && stringField(matches[0], 'to') === route, `legacy 精确合同：${title} → ${route}`)
}
const disabledTiles = legacyTileObjects.filter((tile) => /\bdisabled\s*:\s*(?:true|Boolean\s*\(\s*true\s*\))\s*(?=[,}])/.test(tile))
expect(
  disabledTiles.length === 2 &&
    JSON.stringify(disabledTiles.map((tile) => stringField(tile, 'title'))) === JSON.stringify(['证件复印', '证件照打印']),
  'legacy disabled 语义精确为两项：证件复印、证件照打印',
)

// ── 触控硬约束（home-v3.css）：主入口/主按钮 ≥56px，次级可点 ≥48px ──
expect(/--hv3-touch-min:\s*48px/.test(homeCss) && /--hv3-touch-primary:\s*56px/.test(homeCss), 'hv3 触控 token：min=48px / primary=56px')
const cardMainRule = cssRule(homeCss, '.kpv1.hv3 .hv3-card-main.svc-tile')
const cardMainMin = Number((/min-height:\s*(\d+)px/.exec(cardMainRule) ?? [])[1] ?? 0)
expect(cardMainMin >= 56, `磁贴按钮 .hv3-card-main.svc-tile min-height=${cardMainMin}px ≥56px`)
const gridBMainMin = Number((/\.kpv1\.hv3 \.hv3-grid-b \.hv3-card-main\.svc-tile\s*\{[^}]*min-height:\s*(\d+)px/.exec(homeCss) ?? [])[1] ?? 0)
expect(gridBMainMin >= 56, `紧凑磁贴按钮 min-height=${gridBMainMin}px ≥56px`)
expect(/\.kpv1\.hv3 \.hv3-cmd-ask\s*\{[^}]*min-height:\s*var\(--hv3-touch-primary\)/.test(homeCss), '指令胶囊导航按钮 ≥56px')
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

// ── 1080×1920 首屏/滚动边界几何合同（自旧版 73fd04a1 等价迁移恢复） ──
expect(
  /@media\s*\(width:\s*1080px\)\s*and\s*\(height:\s*1920px\)\s*\{[\s\S]*?\.kpv1\s*\{[^}]*width:\s*1080px;[^}]*min-height:\s*0;/.test(css),
  '1080×1920 共享壳内首页使用可收缩内容高度，不把 1920px 整机高度重复塞进内容区',
)
expect(!/\.kpv1\s*\{[^}]*min-height:\s*1920px;/.test(css), '首页禁止用 1920px 内容高度把专区和提示压到底栏下方')
const zoneRowBaseRule = cssRule(css, '.kpv1 .zone-row')
expect(/margin:\s*18px\s+48px\s+0/.test(zoneRowBaseRule), 'prototype-v1 基线 zone-row 补偿间距保留（18px 48px 0）')
const hv3ZoneRule = cssRule(homeCss, '.kpv1.hv3 .zone-row')
expect(/margin:\s*16px\s+48px\s+0/.test(hv3ZoneRule), 'hv3 层 zone-row 与 hv3-services 同轨 48px 边距（16px 48px 0，等价迁移的滚动边界锚点）')

expect(packageJson.includes('"verify:fusion-home": "node scripts/verify-fusion-home.mjs"'), 'package.json 精确注册 verify:fusion-home')

if (failures > 0) {
  console.error(`\nFAIL ${failures} 项 —— Kiosk 首页 V3 意图台合同未满足\n`)
  process.exit(1)
}
console.log('\nALL PASS —— Kiosk 首页 V3 意图台合同满足\n')
