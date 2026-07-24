import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(join(appRoot, relativePath), 'utf8')

const home = read('src/pages/home/HomePage.tsx')
const serviceGroups = read('src/pages/home/serviceGroups.ts')
const css = read('src/styles/prototype-v1.css')
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

function extractJsxOpeningTag(source, tagName) {
  const start = source.search(new RegExp(`<${escapeRegExp(tagName)}\\b`))
  return extractJsxOpeningTagAt(source, start)
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
  const open = findCodeCharacter(source, '{', declaration.index + declaration[0].length)
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

console.log('\n=== Kiosk 首页 Fusion 透明迁移静态合同 ===')

const pageStart = home.indexOf('export function HomePage()')
const page = pageStart >= 0 ? home.slice(pageStart) : ''
const homePageBody = extractFunctionBody(home, 'HomePage')
const frameTag = extractReturnedRootTag(homePageBody)
const groupsTag = extractJsxOpeningTag(page, 'div')

expect(
  /import\s*\{[^}]*\bKioskPageFrame\b[^}]*\}\s*from\s*['"]@ai-job-print\/ui['"]/.test(home),
  '从 @ai-job-print/ui 导入 KioskPageFrame',
)
expect(
  /^<KioskPageFrame\b/.test(frameTag) &&
    /\bclassName\s*=\s*['"]kpv1['"]/.test(frameTag) &&
    /\bheader\s*=\s*\{\s*<KioskTopBar\s*\/>\s*\}/.test(frameTag) &&
    /\bfooter\s*=\s*\{\s*<HomeNavbar\s*\/>\s*\}/.test(frameTag),
  'HomePage return 的首个 JSX 根节点是 KioskPageFrame + kpv1 + KioskTopBar/HomeNavbar',
)
expect(!/<div\s+[^>]*className\s*=\s*['"]kpv1['"][^>]*>/.test(page), '旧 div.kpv1 根节点已移除')
expect(
  /^<div\b/.test(groupsTag) &&
    /\bclassName\s*=\s*['"]groups['"]/.test(groupsTag) &&
    /\baria-label\s*=\s*['"]当前可使用功能['"]/.test(groupsTag),
  '主服务区使用中性 div 并保留 groups 与可访问名称',
)
expect(!/<main\b/.test(page), 'HomePage 不在 KioskLayout 主地标内嵌套 main')
const bodyIndexes = [
  page.indexOf(frameTag),
  page.search(/<HomeWelcome\s*\/>/),
  page.search(/<ContinuePanel\s*\/>/),
  page.indexOf(groupsTag),
  page.search(/<ZoneRow\s*\/>/),
  page.search(/<div\s+[^>]*className\s*=\s*['"]notice['"][^>]*>/),
  page.indexOf('</KioskPageFrame>'),
]
expect(bodyIndexes.every((index, position) => index >= 0 && (position === 0 || index > bodyIndexes[position - 1])), '主体保留 HomeWelcome、ContinuePanel、groups、ZoneRow、notice 原有顺序')
expect((page.match(/<KioskTopBar\s*\/>/g) ?? []).length === 1, 'KioskTopBar 仅通过 frame header 渲染一次')
expect((page.match(/<HomeNavbar\s*\/>/g) ?? []).length === 1, 'HomeNavbar 仅通过 frame footer 渲染一次')

const groupsArray = extractAssignedArray(serviceGroups, 'export const SERVICE_GROUPS')
const groupObjects = directObjectBlocks(groupsArray)
const expectedGroups = [
  ['resume', 'AI简历服务'],
  ['jobs', '岗位信息'],
  ['job-fairs', '招聘会'],
  ['print-scan', '打印扫描'],
  ['interview', 'AI面试训练'],
  ['policy', '政策服务'],
]
const actualGroups = groupObjects.map((group) => [stringField(group, 'id'), stringField(group, 'title')])
expect(JSON.stringify(actualGroups) === JSON.stringify(expectedGroups), 'SERVICE_GROUPS 保留六组 exact id/title/order')

const tileObjects = groupObjects.flatMap((group) => directObjectBlocks(extractPropertyArray(group, 'tiles')))
const expectedRoutes = new Map([
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
for (const [title, route] of expectedRoutes) {
  const matches = tileObjects.filter((tile) => stringField(tile, 'title') === title)
  expect(matches.length === 1 && stringField(matches[0], 'to') === route, `真实入口保留：${title} → ${route}`)
}

const disabledTiles = tileObjects.filter((tile) => /\bdisabled\s*:\s*(?:true|Boolean\s*\(\s*true\s*\))\s*(?=[,}])/.test(tile))
const allDisabledFields = tileObjects.filter((tile) => /\bdisabled\s*:/.test(tile))
const disabledTitles = disabledTiles.map((tile) => stringField(tile, 'title'))
expect(
  allDisabledFields.length === 2 &&
    disabledTiles.length === 2 &&
    JSON.stringify(disabledTitles) === JSON.stringify(['证件复印', '证件照打印']),
  'disabled 语义精确为两项（兼容 true/Boolean(true)）：证件复印、证件照打印',
)

const welcomeStart = home.indexOf('function HomeWelcome')
const welcomeEnd = home.indexOf('function ServiceCard', welcomeStart)
const welcome = welcomeStart >= 0 && welcomeEnd > welcomeStart ? home.slice(welcomeStart, welcomeEnd) : ''
expect(/const\s*\{[^}]*\bisLoggedIn\b[^}]*\}\s*=\s*useAuth\(\)/s.test(welcome), '登录态来自 useAuth.isLoggedIn')
expect(/const\s*\{[^}]*\bdisplayName\b[^}]*\}\s*=\s*useAuth\(\)/s.test(welcome) && welcome.includes('{displayName}'), '登录态展示真实 displayName')
expect(/isLoggedIn\s*\?[\s\S]*?onClick=\{\(\)\s*=>\s*navigate\(\s*['"]\/profile['"]\s*\)\}[^>]*>[\s\S]*?进入我的/.test(welcome), '登录态「进入我的」导航到 /profile')
expect(welcome.includes('<MemberLoginDialog'), '保留 MemberLoginDialog')
expect(/onClick=\{\(\)\s*=>\s*setLoginOpen\(true\)\}/.test(welcome), '游客保留打开登录弹窗回调')
expect(/onContinueAsGuest=\{\(\)\s*=>\s*\{\s*continueAsGuest\(\)/.test(welcome), '保留真实继续游客回调')
expect(/const deviceStatus = useHomeDeviceStatus\(\)/.test(home) && home.includes('{deviceStatus.label}'), '保留真实设备状态')
expect(/<ContinuePanel\s*\/>/.test(page), '保留 ContinuePanel')
expect(/const toolbox = useToolboxConfig\(\)/.test(home) && /const campus = useSmartCampusConfig\(\)/.test(home), '保留百宝箱/智慧校园真实配置 hooks')
expect(/const showToolbox = toolbox\.enabled/.test(home) && /const showCampus = campus\.enabled/.test(home) && /if \(!showToolbox && !showCampus\) return null/.test(home), '保留百宝箱/智慧校园诚实门控')

const complianceNotice = '岗位与招聘会信息均来自第三方 / 官方来源，本终端仅提供信息展示与跳转，投递、预约请前往来源平台办理。'
expect(home.includes(complianceNotice), '保留完整合规提示文案')
const complianceSurface = `${home}\n${serviceGroups}\n${css}`
expect(!/一键投递|立即投递/.test(complianceSurface), '拒绝「一键投递」/「立即投递」')
expect(!/(?<!来源)平台投递/.test(complianceSurface), '「平台投递」仅允许「来源平台投递」语境')

const navbar = home.slice(home.indexOf('function HomeNavbar'), home.indexOf('export function HomePage'))
expect((navbar.match(/className="nav-item/g) ?? []).length === 3, '底部导航保留三个 Tab')
expect(/nav-item active/.test(navbar) && /aria-current="page"/.test(navbar), '首页 Tab 保留 / 的当前页语义')
expect(navbar.includes("navigate('/assistant')") && navbar.includes("navigate('/profile')"), '导航目标保留 /assistant 与 /profile')

const declaredRoutes = new Set([
  ...[...serviceGroups.matchAll(/(?:to|titleTo)\s*:\s*['"]([^'"]+)['"]/g)].map((match) => match[1]),
  ...[...home.matchAll(/navigate\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1]),
])
const allowedRoutes = new Set([...expectedRoutes.values(), '/print-scan', '/profile', '/toolbox', '/smart-campus', '/assistant'])
expect(declaredRoutes.size === allowedRoutes.size && [...declaredRoutes].every((route) => allowedRoutes.has(route)), '未新增或替换任何真实 route literal')
expect(!/\bfetch\s*\(/.test(home + serviceGroups), '首页未新增 fetch')
const productionIdentifiers = stripCommentsAndStrings(`${home}\n${serviceGroups}`).match(/\b[A-Za-z_$][\w$]*\b/g) ?? []
const demoMockIdentifiers = productionIdentifiers.filter((identifier) => /^(?:demo|mock|useDemo|useMock)/i.test(identifier))
expect(demoMockIdentifiers.length === 0, '首页生产代码未新增 demo*/mock*/useDemo*/useMock* 标识符')

const kpv1RootRule = cssRule(css, '.kpv1')
expect(/^\.kpv1\s*\{/m.test(css) && !/(?:div|section|main)\.kpv1\s*\{/.test(css), '.kpv1 根规则非 tag-specific，兼容 section 根')
expect(/width:\s*min\(1080px,\s*100%\)/.test(kpv1RootRule) && /min-height:\s*1920px/.test(kpv1RootRule) && /display:\s*flex/.test(kpv1RootRule) && /flex-direction:\s*column/.test(kpv1RootRule), '.kpv1 保留关键根布局规则')
console.log('  INFO Task 4 的 prototype-v1.css no-diff 由 review diff allowlist 负责；本脚本只验证 section 根兼容合同')

expect(packageJson.includes('"verify:fusion-home": "node scripts/verify-fusion-home.mjs"'), 'package.json 精确注册 verify:fusion-home')

if (failures > 0) {
  console.error(`\nFAIL ${failures} 项 —— Kiosk 首页 Fusion 透明迁移合同未满足\n`)
  process.exit(1)
}
console.log('\nALL PASS —— Kiosk 首页 Fusion 透明迁移合同满足\n')
