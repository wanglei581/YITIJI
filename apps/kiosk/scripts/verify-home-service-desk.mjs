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
  const matched = pattern.test(source) || (
    message === '<=760px 服务组与动作均切为单列'
    && /\.khome \.lf-reference-pair\s*\{[^}]*grid-template-columns:\s*1fr/.test(source)
    && /\.khome \.home-reference-primary-list,[\s\S]*?\.khome \.home-reference-secondary-list\s*\{[^}]*grid-template-columns:\s*1fr/.test(source)
  )
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
function balancedBlock(source, openIndex) {
  if (openIndex < 0 || source[openIndex] !== '{') return ''
  let depth = 0
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}' && --depth === 0) return source.slice(openIndex, index + 1)
  }
  return ''
}
function functionBlock(source, pattern) {
  const match = pattern.exec(source)
  if (!match) return ''
  const open = source.indexOf('{', match.index + match[0].length)
  const body = balancedBlock(source, open)
  return body ? source.slice(match.index, open + body.length) : ''
}
function constFunction(source, name) {
  const match = new RegExp(`const\\s+${escapeRegExp(name)}\\s*=`).exec(source)
  if (!match) return ''
  const arrow = source.indexOf('=>', match.index + match[0].length)
  const header = source.slice(match.index + match[0].length, arrow)
  if (arrow < 0 || header.length > 220 || /\n\s*const\s/.test(header)) return ''
  const open = source.indexOf('{', arrow)
  const body = balancedBlock(source, open)
  return body ? source.slice(match.index, open + body.length) : ''
}
function namedComponent(source, name) {
  return functionBlock(source, new RegExp(`function\\s+${escapeRegExp(name)}\\s*\\([^)]*\\)`))
    || constFunction(source, name)
}
function keywordBlock(source, keyword) {
  const match = new RegExp(`\\b${keyword}\\b(?:\\s*\\([^)]*\\))?\\s*\\{`).exec(source)
  return match ? balancedBlock(source, source.indexOf('{', match.index)) : ''
}
function callBlocks(source, callName) {
  const blocks = []
  for (const match of source.matchAll(new RegExp(`\\b${callName}\\s*\\(`, 'g'))) {
    const arrow = source.indexOf('=>', match.index + match[0].length)
    const open = source.indexOf('{', arrow)
    const body = balancedBlock(source, open)
    if (arrow >= 0 && body) blocks.push(source.slice(match.index, open + body.length))
  }
  return blocks
}
function constFunctions(source) {
  const functions = []
  for (const match of source.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=/g)) {
    const block = constFunction(source, match[1])
    if (block && !functions.some((item) => item.name === match[1])) functions.push({ name: match[1], block })
  }
  return functions
}
function jsxElement(source, tagName, requiredPattern) {
  for (const match of source.matchAll(new RegExp(`<${tagName}\\b`, 'g'))) {
    const close = source.indexOf(`</${tagName}>`, match.index)
    if (close < 0) continue
    const element = source.slice(match.index, close + tagName.length + 3)
    if (!requiredPattern || requiredPattern.test(element)) return element
  }
  return ''
}
function buttonByVisibleText(source, visibleText) {
  const visiblePattern = new RegExp(`>\\s*${escapeRegExp(visibleText)}\\s*(?:<|\\{)`, 'g')
  for (const match of source.matchAll(visiblePattern)) {
    const textIndex = (match.index ?? -1) + match[0].indexOf(visibleText)
    const buttonStart = source.lastIndexOf('<button', textIndex)
    const buttonEnd = source.indexOf('</button>', textIndex)
    if (buttonStart < 0 || buttonEnd < 0) continue
    if (source.lastIndexOf('</button>', textIndex) > buttonStart) continue
    return source.slice(buttonStart, buttonEnd + '</button>'.length)
  }
  return ''
}
function patternIndex(source, pattern) {
  return pattern.exec(source)?.index ?? -1
}
function guardPattern(generation, generationRef) {
  if (!generation || !generationRef) return /$a/
  const value = escapeRegExp(generation)
  const ref = escapeRegExp(generationRef)
  return new RegExp(
    `(?:if\\s*\\(\\s*(?:${value}\\s*!==\\s*${ref}\\.current|${ref}\\.current\\s*!==\\s*${value}|!\\s*isCurrentRequest\\(\\s*${value}\\s*\\))\\s*\\)\\s*(?:\\{\\s*)?return\\b|if\\s*\\(\\s*(?:${value}\\s*===\\s*${ref}\\.current|${ref}\\.current\\s*===\\s*${value}|isCurrentRequest\\(\\s*${value}\\s*\\))\\s*\\)\\s*\\{)`,
  )
}
function guardedUpdate(source, guard, update) {
  const match = guard.exec(source)
  if (!match) return false
  if (/\breturn\b/.test(match[0])) return patternIndex(source, update) > match.index
  const body = balancedBlock(source, source.indexOf('{', match.index))
  return patternIndex(source, update) >= match.index && body.length > 0 && update.test(body)
}
function mappedBranch(source, startPattern, label, tone, setter = '') {
  const start = startPattern.exec(source)
  if (!start) return false
  const branch = source.slice(start.index, start.index + 500)
  return branch.includes(label)
    && new RegExp(`['"]${escapeRegExp(tone)}['"]`).test(branch)
    && (!setter || new RegExp(`\\b${escapeRegExp(setter)}\\s*\\(`).test(branch))
}
function mappedDefault(source, label, tone, setter = '') {
  for (const marker of source.matchAll(/\bdefault\s*:|\belse\s*\{|\breturn\s*\{/g)) {
    const branch = source.slice(marker.index, marker.index + 500)
    if (branch.includes(label)
      && new RegExp(`['"]${escapeRegExp(tone)}['"]`).test(branch)
      && (!setter || new RegExp(`\\b${escapeRegExp(setter)}\\s*\\(`).test(branch))) return true
  }
  return false
}
function cssRule(source, selector) {
  const selectorStart = source.indexOf(`${selector} {`)
  if (selectorStart < 0) return ''
  if (selector.startsWith('@media ')) {
    const nextMedia = source.indexOf('\n@media ', selectorStart + selector.length)
    return source.slice(selectorStart, nextMedia < 0 ? source.length : nextMedia)
  }
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
const serviceGroups = read('src/pages/home/serviceGroups.ts')
const homeDeviceStatus = read('src/pages/home/hooks/useHomeDeviceStatus.ts')
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
const loginDialogCss = read('src/pages/auth/styles/login-dialog.css')
const referenceServiceNav = read('src/components/lightflow/ReferenceServiceNav.tsx')
const referenceServiceNavCss = read('src/components/lightflow/reference-service-nav.css')
const referenceLayoutCss = read('src/components/lightflow/reference-layout.css')
const topBar = between(home, 'function KioskTopBar()', 'function useHomeStats(')
const homeStats = functionBlock(home, /function\s+useHomeStats\s*\(/)
const identityPanel = functionBlock(home, /function\s+IdentityPanel\s*\(/)
const loginTriggerButton = buttonByVisibleText(identityPanel, '登录 / 注册')
const continuePanel = functionBlock(home, /function\s+ContinuePanel\s*\(/)
const smartCampusSection = functionBlock(home, /function\s+SmartCampusHorizontalSection\s*\(/)
const toolboxSection = functionBlock(home, /function\s+ToolboxSection\s*\(/)
const homePage = functionBlock(home, /export\s+function\s+HomePage\s*\([^)]*\)/)
const homeReturnIndex = patternIndex(homePage, /\breturn\s*\(/)
const homeReturn = homeReturnIndex >= 0 ? homePage.slice(homeReturnIndex) : ''
const inlineServiceValue = jsxElement(homeReturn, 'section', /className="service-value"/)
const identityMountIndex = homeReturn.indexOf('<IdentityPanel')
const componentCandidates = [...homeReturn.matchAll(/<([A-Z][A-Za-z0-9_$]*)\b[^>]*\/>/g)]
  .filter((match) => identityMountIndex < 0 || match.index < identityMountIndex)
  .map((match) => {
    const source = namedComponent(home, match[1])
    const returnIndex = patternIndex(source, /\breturn\s*\(/)
    const section = jsxElement(returnIndex >= 0 ? source.slice(returnIndex) : '', 'section', /className="service-value"/)
    return { name: match[1], mountIndex: match.index, section }
  })
const serviceValueComponent = componentCandidates.find((candidate) => candidate.section.length > 0)
const serviceValueSection = inlineServiceValue || serviceValueComponent?.section || ''
const serviceValueMountIndex = inlineServiceValue
  ? homeReturn.indexOf(inlineServiceValue)
  : (serviceValueComponent?.mountIndex ?? -1)

expect(
  packageJson.includes('"verify:home-service-desk": "node scripts/verify-home-service-desk.mjs"'),
  'package.json 注册 verify:home-service-desk',
)
expect(home.includes("import './home-service-desk.css'"), 'HomePage 导入青序 LightFlow 聚合样式')
expect(!home.includes("import './home-inkpaper.css'"), 'HomePage 不再导入旧 inkpaper 首页样式')
expect(!existsSync(resolve('src/pages/home/home-inkpaper.css')), '旧 home-inkpaper.css 已删除')
expect(!home.includes('先问清楚'), '首页不再出现旧咨询 Hero 标题')
expect(!home.includes('<HeroSection />'), '首页不再挂载旧 HeroSection')
expect(!home.includes('function HeroSection('), '首页删除旧 HeroSection 实现')
expect(!/<KIcon\s+name=["']logo["']/.test(topBar), '顶部栏不再显示图形 Logo')
expect(topBar.includes('AI求职打印一体机'), '顶部栏保留纯文字品牌')
expect(!topBar.includes('打印机在线'), '顶部栏源码不硬编码打印机在线')
expect(!topBar.includes('网络正常'), '顶部栏不单列静态网络正常')
expectMatches(home, /import[\s\S]*?useHomeDeviceStatus[\s\S]*?from\s*['"][^'"]*useHomeDeviceStatus['"]/, 'HomePage 导入真实设备状态 hook')
expectMatches(topBar, /const\s+deviceStatus\s*=\s*useHomeDeviceStatus\(\)/, '顶部栏使用 useHomeDeviceStatus 获取真实状态')
expectMatches(topBar, /className="k-device-status"\s+data-status=\{deviceStatus\.tone\}/, '顶部栏状态节点消费真实 tone')
expect(home.includes('当前可使用功能'), '业务区标题使用冻结文案')
expect(home.includes('<MemberLoginDialog'), '首页复用真实登录弹窗')
expect(homeDeviceStatus.length > 0, 'src/pages/home/hooks/useHomeDeviceStatus.ts 已实现且可读取')

expectMatches(
  serviceValueSection,
  /^<section\b(?=[^>]*className="service-value")(?=[^>]*aria-labelledby="home-service-value-title")[^>]*>/,
  'HomePage 内联或其已挂载组件返回可达的服务价值 section',
)
for (const [pattern, label] of [
  [/一站式求职服务/, '冻结标签'],
  [/简历、打印、岗位信息一趟办完/, '冻结主标题'],
  [/提供 AI 简历服务、求职材料、岗位与招聘会信息入口，以及本机打印扫描服务。/, '批准正文'],
]) {
  expectMatches(serviceValueSection, pattern, `可达服务价值 section 渲染${label}`)
}
expect(serviceValueSection.length > 0 && !/<button\b|<a\b|<Link\b/.test(serviceValueSection), '可达服务价值 section 不包含按钮或跳转入口')
expect(serviceValueSection.length > 0 && !/小青|推荐方案|先问清楚|一键投递|保证录用|确保录用/.test(serviceValueSection), '可达服务价值 section 不含禁入人物、推荐或录用承诺')
expect(
  serviceValueMountIndex >= 0 && identityMountIndex > serviceValueMountIndex,
  'HomePage return 在 IdentityPanel 前直接渲染服务价值 section 或挂载其组件',
)
const deviceHook = functionBlock(homeDeviceStatus, /export\s+function\s+useHomeDeviceStatus\s*\([^)]*\)/)
const deviceFunctions = constFunctions(deviceHook)
const endpointPattern = /fetch\s*\(\s*`\/api\/v1\/terminals\/\$\{terminalId\}\/printer-status`\s*,/
const refreshFunction = deviceFunctions.find(({ block }) => endpointPattern.test(block))
const refreshName = refreshFunction?.name ?? ''
const refreshBlock = refreshFunction?.block ?? ''
const refreshTry = keywordBlock(refreshBlock, 'try')
const refreshCatch = keywordBlock(refreshBlock, 'catch')
const statePairs = [...deviceHook.matchAll(
  /const\s*\[\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\]\s*=\s*useState\b/g,
)].map((match) => ({ state: match[1], setter: match[2] }))
const refreshedStatePairs = statePairs.filter(({ setter }) => new RegExp(`\\b${escapeRegExp(setter)}\\s*\\(`).test(refreshBlock))
const deviceState = refreshedStatePairs[0]?.state ?? ''
const deviceSetter = refreshedStatePairs[0]?.setter ?? ''
const deviceEffect = callBlocks(deviceHook, 'useEffect').find((block) => /setInterval\s*\(/.test(block)) ?? ''
const intervalMatch = refreshName
  ? new RegExp(`setInterval\\s*\\(\\s*\\(\\s*\\)\\s*=>\\s*\\{\\s*(?:void\\s+)?${escapeRegExp(refreshName)}\\(\\s*false\\s*\\)\\s*;?\\s*\\}\\s*,\\s*([^\\)]+)\\)`).exec(deviceEffect)
  : null
const intervalArgument = intervalMatch?.[1].trim() ?? ''
const intervalIsThirtySeconds = /^(?:30_000|30000|30\s*\*\s*1000)$/.test(intervalArgument)
  || (intervalArgument && new RegExp(`const\\s+${escapeRegExp(intervalArgument)}\\s*=\\s*(?:30_000|30000|30\\s*\\*\\s*1000)\\b`).test(homeDeviceStatus))
const refreshLoadingParameter = refreshName
  ? new RegExp(`const\\s+${escapeRegExp(refreshName)}\\s*=\\s*async\\s*\\(\\s*([A-Za-z_$][\\w$]*)(?:\\s*:\\s*boolean)?\\s*\\)\\s*=>`).exec(refreshBlock)?.[1] ?? ''
  : ''
const loadingGateMatch = refreshLoadingParameter
  ? new RegExp(`if\\s*\\(\\s*${escapeRegExp(refreshLoadingParameter)}\\s*\\)\\s*\\{`).exec(refreshBlock)
  : null
const loadingGateBlock = loadingGateMatch
  ? balancedBlock(refreshBlock, refreshBlock.indexOf('{', loadingGateMatch.index))
  : ''
const initialRefreshShowsLoading = Boolean(refreshName) && new RegExp(
  `(?:void\\s+)?${escapeRegExp(refreshName)}\\(\\s*true\\s*\\)\\s*;?\\s*\\n\\s*const\\s+[A-Za-z_$][\\w$]*\\s*=\\s*(?:window\\.)?setInterval`,
).test(deviceEffect)
const onlineAdd = deviceEffect.match(/addEventListener\s*\(\s*['"]online['"]\s*,\s*([A-Za-z_$][\w$]*)/)?.[1] ?? ''
const offlineAdd = deviceEffect.match(/addEventListener\s*\(\s*['"]offline['"]\s*,\s*([A-Za-z_$][\w$]*)/)?.[1] ?? ''
const onlineRemove = deviceEffect.match(/removeEventListener\s*\(\s*['"]online['"]\s*,\s*([A-Za-z_$][\w$]*)/)?.[1] ?? ''
const offlineRemove = deviceEffect.match(/removeEventListener\s*\(\s*['"]offline['"]\s*,\s*([A-Za-z_$][\w$]*)/)?.[1] ?? ''
const onlineBlock = onlineAdd === refreshName ? refreshBlock : (constFunction(deviceEffect, onlineAdd) || constFunction(deviceHook, onlineAdd))
const offlineBlock = offlineAdd === refreshName ? refreshBlock : (constFunction(deviceEffect, offlineAdd) || constFunction(deviceHook, offlineAdd))
const cleanupMatch = /return\s*\(\s*\)\s*=>\s*\{/.exec(deviceEffect)
const cleanupBlock = cleanupMatch ? balancedBlock(deviceEffect, deviceEffect.indexOf('{', cleanupMatch.index)) : ''
const intervalId = deviceEffect.match(/const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:window\.)?setInterval/)?.[1] ?? ''
const abortMatch = /([A-Za-z_$][\w$]*)\.current\s*(?:\?\.)?abort\(\)/.exec(refreshBlock)
const controllerMatch = /const\s+([A-Za-z_$][\w$]*)\s*=\s*new AbortController\(\)/.exec(refreshBlock)
const generationMatch = /const\s+([A-Za-z_$][\w$]*)\s*=\s*\+\+\s*([A-Za-z_$][\w$]*)\.current/.exec(refreshBlock)
const refreshGuard = guardPattern(generationMatch?.[1], generationMatch?.[2])
const fetchIndexInTry = patternIndex(refreshTry, /await\s+fetch\s*\(/)
const successAfterFetch = fetchIndexInTry >= 0 ? refreshTry.slice(fetchIndexInTry) : ''
const stateUpdatePattern = deviceSetter ? new RegExp(`\\b${escapeRegExp(deviceSetter)}\\s*\\(`) : /$a/
const fetchResponseName = refreshTry.match(
  /const\s+([A-Za-z_$][\w$]*)(?:\s*:\s*[^=]+)?\s*=\s*await\s+fetch\s*\(/,
)?.[1] ?? ''
const parsedDataMatch = fetchResponseName
  ? new RegExp(`const\\s+([A-Za-z_$][\\w$]*)(?:\\s*:\\s*[^=]+)?\\s*=\\s*\\(?\\s*await\\s+${escapeRegExp(fetchResponseName)}\\.json\\s*\\(\\s*\\)\\s*\\)?`).exec(refreshTry)
  : null
const parsedDataName = parsedDataMatch?.[1] ?? ''
const mapperCall = deviceSetter && parsedDataName
  ? new RegExp(`\\b${escapeRegExp(deviceSetter)}\\s*\\(\\s*([A-Za-z_$][\\w$]*)\\s*\\(\\s*${escapeRegExp(parsedDataName)}\\.printerStatus\\s*\\)\\s*\\)`).exec(refreshTry)
  : null
const offlineHeartbeatMatch = parsedDataName
  ? new RegExp(`if\\s*\\(\\s*${escapeRegExp(parsedDataName)}\\.isOnline\\s*===\\s*false\\s*\\)\\s*\\{`).exec(refreshTry)
  : null
const offlineHeartbeatBlock = offlineHeartbeatMatch
  ? balancedBlock(refreshTry, refreshTry.indexOf('{', offlineHeartbeatMatch.index))
  : ''
const mapperName = mapperCall?.[1] ?? ''
const mapperBlock = mapperName ? namedComponent(homeDeviceStatus, mapperName) : ''
const mapperParameter = mapperName
  ? mapperBlock.match(new RegExp(`(?:${escapeRegExp(mapperName)}\\s*=\\s*\\(?\\s*|function\\s+${escapeRegExp(mapperName)}\\s*\\(\\s*)([A-Za-z_$][\\w$]*)`))?.[1] ?? ''
  : ''
const approvedPrinterMappings = [
  ['ready', '打印机在线', 'positive'],
  ['offline', '打印机离线', 'negative'],
  ['error', '打印机异常', 'negative'],
  ['low_paper', '纸张余量偏低', 'warning'],
]
const mapperMappingChecks = approvedPrinterMappings.map(([status, label, tone]) => mappedBranch(
  mapperBlock,
  new RegExp(`(?:case\\s*['"]${status}['"]|${escapeRegExp(mapperParameter)}\\s*===\\s*['"]${status}['"]|\\b${status}\\s*:)`),
  label,
  tone,
))
const mapperDefaultCheck = mappedDefault(mapperBlock, '打印机状态未知', 'neutral')
const directStatusExpression = parsedDataName ? `${escapeRegExp(parsedDataName)}\\.printerStatus` : '$a'
const directMappingChecks = approvedPrinterMappings.map(([status, label, tone]) => mappedBranch(
  refreshTry,
  new RegExp(`(?:case\\s*['"]${status}['"]|${directStatusExpression}\\s*===\\s*['"]${status}['"])`),
  label,
  tone,
  deviceSetter,
))
const directDefaultCheck = mappedDefault(refreshTry, '打印机状态未知', 'neutral', deviceSetter)
const mapperChainValid = Boolean(parsedDataName && mapperName && mapperBlock && mapperParameter)
  && mapperMappingChecks.every(Boolean) && mapperDefaultCheck
const directMappingValid = Boolean(parsedDataName && deviceSetter)
  && (new RegExp(`switch\\s*\\(\\s*${directStatusExpression}\\s*\\)`).test(refreshTry)
    || new RegExp(`${directStatusExpression}\\s*===`).test(refreshTry))
  && directMappingChecks.every(Boolean) && directDefaultCheck
const unavailableUpdatePattern = deviceSetter
  ? new RegExp(`\\b${escapeRegExp(deviceSetter)}\\s*\\(\\s*(?=[\\s\\S]{0,360}?设备状态暂不可用)(?=[\\s\\S]{0,360}?['"]neutral['"])`)
  : /$a/

expect(deviceHook.length > 0, '已提取完整导出的 useHomeDeviceStatus hook')
expectMatches(deviceHook, /VITE_TERMINAL_ID/, '真实设备状态 hook 读取 VITE_TERMINAL_ID')
expectMatches(homeDeviceStatus, /export\s+type\s+HomeDeviceTone\s*=\s*'positive'\s*\|\s*'warning'\s*\|\s*'negative'\s*\|\s*'neutral'/, '真实设备状态 hook 固定四种诚实 tone')
expectMatches(homeDeviceStatus, /export\s+interface\s+HomeDeviceStatusView\s*\{[\s\S]*?label:\s*string[\s\S]*?tone:\s*HomeDeviceTone[\s\S]*?networkIssue:\s*boolean/, '真实设备状态 hook 返回 label/tone/networkIssue 视图')
expectMatches(homeDeviceStatus, /interface\s+HomePrinterStatusResponse\s*\{[\s\S]*?printerStatus\??:\s*unknown[\s\S]*?isOnline\??:\s*boolean/, '打印机状态响应显式读取 isOnline 心跳在线性')
expect(refreshBlock.length > 0, '已从 hook 提取包含唯一打印机端点的 refresh/load 函数')
expectMatches(refreshBlock, endpointPattern, 'refresh 的 fetch 第一个参数是精确打印机状态端点')
expect((deviceHook.match(/\bfetch\s*\(/g) ?? []).length === 1, '导出 hook 只包含一个真实 fetch，未用无关示例充数')
expect(refreshedStatePairs.length === 1, 'refresh 的所有结果映射归入同一 hook 状态 setter')
expect(
  Boolean(deviceState) && new RegExp(`return\\s+${escapeRegExp(deviceState)}\\b`).test(deviceHook),
  'hook return 直接消费 refresh 更新的同一状态',
)
expectMatches(deviceHook, /navigator\.onLine/, '真实设备状态 hook 消费浏览器在线状态')
for (const label of [
  '网络异常',
  '设备状态未配置',
  '设备状态检测中',
  '打印机在线',
  '打印机离线',
  '打印机异常',
  '纸张余量偏低',
  '打印机状态未知',
  '设备状态暂不可用',
]) {
  expect(homeDeviceStatus.includes(label), `真实设备状态 hook 覆盖文案：${label}`)
}
expect(Boolean(fetchResponseName && parsedDataName), 'refresh 从唯一 fetch 响应解析真实 data.printerStatus 数据对象')
expect(
  Boolean(offlineHeartbeatMatch && mapperCall)
    && offlineHeartbeatMatch.index < mapperCall.index
    && new RegExp(`\\b${escapeRegExp(deviceSetter)}\\s*\\(`).test(offlineHeartbeatBlock)
    && offlineHeartbeatBlock.includes('打印机离线')
    && /['"]negative['"]/.test(offlineHeartbeatBlock)
    && /networkIssue:\s*false/.test(offlineHeartbeatBlock)
    && /\breturn\b/.test(offlineHeartbeatBlock),
  '真实 data.isOnline=false 在 printerStatus mapper 前可达地写入“打印机离线” / negative',
)
expect(mapperChainValid || directMappingValid, '真实 data.printerStatus 通过已验证 mapper 或 refresh 内直接分支写入同一状态')
approvedPrinterMappings.forEach(([printerStatus, label, tone], index) => {
  expect(
    mapperChainValid ? mapperMappingChecks[index] : directMappingChecks[index],
    `真实 printerStatus=${printerStatus} 分支映射 ${label} / ${tone}`,
  )
})
expect(mapperChainValid ? mapperDefaultCheck : directDefaultCheck, '真实 printerStatus 默认分支映射“打印机状态未知” / neutral')
expectMatches(
  homeDeviceStatus,
  /if\s*\(\s*!terminalId\s*\)[\s\S]{0,240}?设备状态未配置[\s\S]{0,160}?['"]neutral['"]/,
  '未配置 terminalId 时返回诚实未配置状态',
)
expectMatches(homeDeviceStatus, /设备状态检测中[\s\S]{0,160}?['"]neutral['"]/, '请求中状态绑定 neutral tone')
expect(
  Boolean(refreshLoadingParameter && loadingGateBlock)
    && new RegExp(`\\b${escapeRegExp(deviceSetter)}\\s*\\(`).test(loadingGateBlock)
    && loadingGateBlock.includes('设备状态检测中')
    && /['"]neutral['"]/.test(loadingGateBlock),
  'refresh 的显式 showLoading 语义真实门控“设备状态检测中”更新',
)
expect(deviceEffect.length > 0 && intervalMatch && intervalIsThirtySeconds, '同一 effect 使用 refresh(false) 建立 30 秒静默轮询')
expect(
  initialRefreshShowsLoading,
  '同一 effect 首次挂载先调用 refresh(true) 显示检测中，再建立静默轮询',
)
expect(Boolean(onlineAdd) && onlineAdd === onlineRemove, 'online add/removeEventListener 复用同一 handler 引用')
expect(Boolean(offlineAdd) && offlineAdd === offlineRemove, 'offline add/removeEventListener 复用同一 handler 引用')
expect(
  Boolean(onlineAdd && refreshName) && new RegExp(`\\b${escapeRegExp(refreshName)}\\s*\\(\\s*true\\s*\\)`).test(onlineBlock),
  'online handler 调用同一 refresh(true) 立即重试并显示检测中',
)
const offlineStateArgument = deviceSetter
  ? new RegExp(`\\b${escapeRegExp(deviceSetter)}\\s*\\(\\s*([A-Za-z_$][\\w$]*)`).exec(offlineBlock)?.[1]
  : ''
const offlineStateDefinitionStart = offlineStateArgument
  ? homeDeviceStatus.search(new RegExp(`\\bconst\\s+${escapeRegExp(offlineStateArgument)}(?:\\s*:\\s*[^=]+)?\\s*=`))
  : -1
const offlineStateDefinition = offlineStateDefinitionStart >= 0
  ? homeDeviceStatus.slice(offlineStateDefinitionStart, offlineStateDefinitionStart + 420)
  : ''
const offlineMappingSource = `${offlineBlock}\n${offlineStateDefinition}`
const offlineSetsNetworkError = Boolean(deviceSetter)
  && new RegExp(`\\b${escapeRegExp(deviceSetter)}\\s*\\(`).test(offlineBlock)
  && offlineMappingSource.includes('网络异常')
  && /['"]negative['"]/.test(offlineMappingSource)
expect(offlineSetsNetworkError, 'offline handler 使用同一状态 setter 真实写入“网络异常” / negative')
const refreshOrder = [abortMatch?.index ?? -1, controllerMatch?.index ?? -1, generationMatch?.index ?? -1, patternIndex(refreshBlock, /fetch\s*\(/)]
expect(
  refreshOrder.every((index, position) => index >= 0 && (position === 0 || index > refreshOrder[position - 1])),
  'refresh 依次 abort 上轮、创建 controller、捕获 generation 后才 fetch',
)
expect(
  Boolean(abortMatch && controllerMatch)
    && new RegExp(`${escapeRegExp(abortMatch[1])}\\.current\\s*=\\s*${escapeRegExp(controllerMatch[1])}`).test(refreshBlock)
    && new RegExp(`signal:\\s*${escapeRegExp(controllerMatch[1])}\\.signal`).test(refreshBlock),
  'refresh 将新 controller 存入同一 ref 并把其 signal 交给 fetch',
)
expect(Boolean(deviceSetter) && guardedUpdate(successAfterFetch, refreshGuard, stateUpdatePattern), 'refresh 成功结果仅由最新 generation 更新同一状态')
expect(
  Boolean(deviceSetter) && guardedUpdate(refreshCatch, refreshGuard, unavailableUpdatePattern),
  'refresh catch 在最新 generation guard 后写入“设备状态暂不可用” / neutral',
)
const helperUsed = /isCurrentRequest\s*\(/.test(refreshBlock)
const helperParameter = deviceHook.match(
  /(?:isCurrentRequest\s*=\s*\(?\s*|function\s+isCurrentRequest\s*\(\s*)([A-Za-z_$][\w$]*)/,
)?.[1] ?? ''
expect(
  !helperUsed || (Boolean(helperParameter && generationMatch)
    && new RegExp(`(?:${escapeRegExp(helperParameter)}\\s*===\\s*${escapeRegExp(generationMatch[2])}\\.current|${escapeRegExp(generationMatch[2])}\\.current\\s*===\\s*${escapeRegExp(helperParameter)})`).test(deviceHook)),
  '若使用 isCurrentRequest helper，其真实比较当前 generation ref',
)
expect(
  Boolean(intervalId) && new RegExp(`clearInterval\\s*\\(\\s*${escapeRegExp(intervalId)}\\s*\\)`).test(cleanupBlock),
  '同一 effect cleanup 清理本轮 interval',
)
expect(
  Boolean(onlineAdd && offlineAdd)
    && new RegExp(`removeEventListener\\s*\\(\\s*['"]online['"]\\s*,\\s*${escapeRegExp(onlineAdd)}`).test(cleanupBlock)
    && new RegExp(`removeEventListener\\s*\\(\\s*['"]offline['"]\\s*,\\s*${escapeRegExp(offlineAdd)}`).test(cleanupBlock),
  '同一 effect cleanup 移除 online/offline 两个同引用监听',
)
expect(Boolean(abortMatch) && new RegExp(`${escapeRegExp(abortMatch[1])}\\.current\\s*(?:\\?\\.)?abort\\(\\)`).test(cleanupBlock), '同一 effect cleanup abort 当前在途请求')

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
  [shell, ['.khome {', '.khome .k-top', '.khome .service-value', '.khome .k-device-status', '.khome .identity', '.khome .btn', '.khome .k-ripple', '@keyframes kRise'], 'shell'],
  [services, ['.khome .home-service-catalog', '.khome .home-reference-panel', '.khome .home-reference-icon', '.khome .home-extension-group', '.khome .home-extension-action:disabled', '.khome .home-extension-action:focus-visible'], 'services'],
  [continuation, ['.khome .cat-empty', '.khome .continue', '.khome .compliance'], 'continuation'],
]) {
  expect(selectors.every((selector) => source.includes(selector)), `${label} CSS 覆盖约定职责`)
}
expectMatches(responsive, /@media\s*\(max-width:\s*900px\)/, '响应式样式覆盖 <=900px')
expectMatches(responsive, /@media\s*\(max-width:\s*500px\)/, '响应式样式覆盖 375–412px 常见窄屏范围')
expectMatches(responsive, /@media[^{}]*390px[^{}]*844px/, '响应式样式显式覆盖 390x844')
expectMatches(responsive, /@media[^{}]*390px[^{}]*700px/, '响应式样式显式覆盖 390x700')
expectMatches(responsive, /@media[^{}]*1080px[^{}]*1920px/, '响应式样式显式覆盖 1080x1920')
expectMatches(responsive, /@media\s*\(prefers-reduced-motion:\s*reduce\)/, '响应式样式支持 reduced motion')
expectMatches(shell, /\.khome \.k-device-status\[data-status=['"][^'"]+['"]\]/, '设备状态 CSS 按真实 tone 区分 data-status')
expect(loginDialogCss.includes('.member-login-dialog::backdrop'), '登录弹窗 CSS 定义原生 dialog backdrop')
expectMatches(loginDialogCss, /body:has\(\.member-login-dialog\[open\]\)\s*\{[^}]*overflow:\s*hidden/, '登录弹窗打开时锁定背景滚动')
expectMatches(loginDialogCss, /@media[^{}]*390px[^{}]*844px/, '登录弹窗 CSS 覆盖 390x844')
expectMatches(loginDialogCss, /@media[^{}]*390px[^{}]*700px/, '登录弹窗 CSS 覆盖 390x700')
expectMatches(loginDialogCss, /@media[^{}]*1080px[^{}]*1920px/, '登录弹窗 CSS 覆盖 1080x1920')
expectMatches(loginDialogCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/, '登录弹窗 CSS 支持 reduced motion')

const narrowRange = cssRule(responsive, '@media (max-width: 500px)')
const compact390 = cssRule(responsive, '@media (width: 390px)')
const compact390x844 = cssRule(responsive, '@media (width: 390px) and (height: 844px)')
const compact390x700 = cssRule(responsive, '@media (width: 390px) and (max-height: 700px)')
const kiosk1080x1920 = cssRule(responsive, '@media (width: 1080px) and (height: 1920px)')
expect(narrowRange.length > 0, '<=500px 范围断点独立覆盖常见窄屏宽度')
expect(compact390.length > 0, '390px 通用紧凑规则独立于视口高度')
expect(!compact390.includes('.khome .k-brand span'), '390px 不再保留已删除的品牌副标题补丁')
expect(!compact390.includes('.khome .k-pill'), '390px 不再保留已删除的静态状态药丸补丁')
expectMatches(cssRule(compact390, '.khome .service-value h1'), /font-size:\s*33px/, '390px 服务价值标题使用紧凑字号')
expectMatches(cssRule(compact390, '.khome .home-extension-copy strong'), /font-size:\s*17px/, '390px 扩展服务标题使用紧凑字号')
expectMatches(
  cssRule(narrowRange, '.khome .id-actions'),
  /width:\s*100%[\s\S]*?margin:\s*0/,
  '<=500px 身份操作区占满可用宽度',
)
expectMatches(
  cssRule(narrowRange, '.khome .id-actions .btn'),
  /flex:\s*1[\s\S]*?min-width:\s*0[\s\S]*?padding-inline:\s*12px[\s\S]*?font-size:\s*14px/,
  '<=500px 身份按钮可等分收缩并使用窄屏字号和内边距',
)
expectMatches(
  cssRule(narrowRange, '.khome .btn.cta'),
  /min-width:\s*0[\s\S]*?font-size:\s*15px/,
  '<=500px 登录主 CTA 取消桌面最小宽度并使用窄屏字号',
)
expectMatches(cssRule(compact390, '.khome .home-service-track'), /width:\s*calc\(100% - 28px\)/, '390px 服务内容轨保留 14px 两侧内距')
expectMatches(cssRule(compact390x700, '.khome .k-top'), /position:\s*relative/, '390x700 补充短屏非 sticky 顶栏差异')
expectMatches(
  cssRule(kiosk1080x1920, '.khome'),
  /--home-sticky-top:\s*96px/,
  '1080x1920 服务导航 sticky 偏移与 96px 顶栏一致',
)
expect(!/\.khome \.identity\s*\{[^}]*margin-top:\s*-/.test(compact390x844), '390x844 身份卡不再负 margin 叠压 Hero')
expect(!/\.khome \.identity\s*\{[^}]*margin-top:\s*-/.test(compact390x700), '390x700 身份卡不再负 margin 叠压 Hero')
expect(!/\.khome \.service-value(?:\s+p)?\s*\{[^}]*display:\s*none/.test(compact390x700), '390x700 仍显示服务价值卡及说明')
for (const selector of ['.khome .id-actions', '.khome .id-actions .btn', '.khome .btn.cta']) {
  expect(
    !compact390.includes(selector) && !compact390x844.includes(selector) && !compact390x700.includes(selector),
    `${selector} 防溢出合同只定义在 <=500px 范围断点中`,
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
expectMinimumHeight(services, '.khome .home-extension-action', 88, '扩展服务行')
expectMinimumHeight(services, '.khome .home-extension-heading', 72, '扩展服务组标题')
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
expect(loginTriggerButton.length > 0, '登录主 CTA 可由真实可见文本定位到同一 button 片段')
expectMatches(loginTriggerButton, /ref=\{loginTriggerRef\}/, '登录主 CTA 绑定触发引用')
expectMatches(loginTriggerButton, /className="btn primary lg cta"/, '登录主 CTA 绑定 56px lg 按钮类')
expectMatches(loginTriggerButton, /onClick=\{\(\) => setLoginOpen\(true\)\}/, '登录主 CTA 打开真实弹窗')
expectMatches(loginTriggerButton, />\s*登录 \/ 注册\s*(?:<|\{)/, '登录主 CTA 保留真实可见文本')
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

// K2b 扩展精确白名单，但首页与帮助页仍必须保留；禁止用 /resume 前缀宽泛匹配。
const serviceDeskRouteList = kioskRoot.split('const SERVICE_DESK_EXACT_ROUTES: readonly string[] = [')[1]?.split(']')[0] ?? ''
const expectedServiceDeskRoutes = [
  '/',
  '/help',
  '/assistant',
  '/profile',
  '/resume/source',
  '/resume/parse',
  '/resume/report',
  '/resume/generate',
  '/resume/generate/preview',
  '/resume/optimize',
  '/resume/templates',
  '/resume/materials',
  '/resume/export',
]
const serviceDeskRoutes = [...serviceDeskRouteList.matchAll(/['\"]([^'\"]+)['\"]/g)].map((match) => match[1])
expect(kioskRoot.includes('const SERVICE_DESK_EXACT_ROUTES: readonly string[] = ['), 'Kiosk 声明精确 service-desk 白名单')
expect(
  serviceDeskRoutes.length === expectedServiceDeskRoutes.length
    && new Set(serviceDeskRoutes).size === expectedServiceDeskRoutes.length
    && expectedServiceDeskRoutes.every((route) => serviceDeskRoutes.includes(route)),
  'Kiosk 白名单严格等于已批准的 13 条 LightFlow 路由（含我的主入口）',
)
for (const route of expectedServiceDeskRoutes) {
  expect(serviceDeskRouteList.includes(`'${route}'`), `Kiosk 白名单保留 ${route}`)
}
expect(!kioskRoot.includes("startsWith('/resume')"), 'Kiosk 不宽泛匹配简历路径')
expect(serviceDeskRoutes.every((route) => !route.startsWith('/me')), 'Kiosk 白名单不包含 /me/* 资料明细页')
expectMatches(kioskRoot, /visualTheme=\{isServiceDeskRoute \? 'service-desk' : 'legacy'\}/, 'Kiosk 主题仍只由 isServiceDeskRoute 切换')
expectMatches(kioskRoot, /density="touch"/, 'Kiosk 首页视觉密度保持 touch')
expect((kioskRoot.match(/service-desk/g) ?? []).length === 1, 'KioskRoot 只有一个 service-desk 路由 opt-in')

const groupsBlock = serviceGroups.match(/export const SERVICE_GROUPS:[\s\S]*?\n\]\n\nexport const SUB_ACCENT/)?.[0] ?? ''
const serviceGroupsLineCount = serviceGroups ? serviceGroups.split(/\r?\n/).length : 0
expect(serviceGroups.length > 0 && serviceGroupsLineCount < 300, `serviceGroups.ts 已提取且少于 300 行（当前 ${serviceGroupsLineCount}）`)
expectMatches(serviceGroups, /import\s+type\s+\{\s*KioskIconName\s*\}\s+from\s+['"]\.\.\/\.\.\/components\/kiosk-icon['"]/, '服务分组模块复用 KioskIconName 类型')
expect(home.includes("from './serviceGroups'"), 'HomePage 从 serviceGroups 模块导入真实服务数据')
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
for (const title of ['证件复印', '证件照打印']) {
  const pattern = new RegExp(`\\{[^{}]*title:\\s*'${title}'[^{}]*disabled:\\s*Boolean\\(true\\)[^{}]*\\}`)
  expect(pattern.test(groupsBlock), `当前禁用入口保持禁用：${title}`)
}
expect(!/title:\s*'云打印'/.test(groupsBlock), '云打印入口保持按正式取舍决策删除')
expect((groupsBlock.match(/disabled:\s*Boolean\(true\)/g) ?? []).length === 2, 'SERVICE_GROUPS 仅保留当前两个禁用入口')

// 4188 目录式服务区：只替换首页服务区，不改变 Hero、身份卡或现有业务入口。
expectMatches(home, /import\s*\{\s*ReferenceServiceNav\s*\}\s*from\s*['"]\.\.\/\.\.\/components\/lightflow\/ReferenceServiceNav['"]/, 'HomePage 导入共享六项分类导航')
expectMatches(home, /import\s*\{\s*useLocation,\s*useNavigate\s*\}\s*from\s*['"]react-router-dom['"]/, 'HomePage 导入 useLocation 监听 SPA hash')
expectMatches(homePage, /const\s*\{\s*hash\s*\}\s*=\s*useLocation\(\)/, 'HomePage 从 React Router 读取当前 hash')
expectMatches(homePage, /useEffect\(\(\)\s*=>\s*\{[\s\S]*?HOME_REFERENCE_HASH_IDS\.has\(targetId\)[\s\S]*?document\.getElementById\(targetId\)\?\.scrollIntoView\(\{\s*behavior:\s*'smooth',\s*block:\s*'start'\s*\}\)[\s\S]*?\},\s*\[hash\]\)/, 'HomePage 仅在白名单 hash 变化时平滑滚动目标')
expect(!home.includes('href="/#'), '首页 hash 导航不使用硬刷新 href=/#')
expect(!home.includes('window.location'), '首页 hash 导航不访问 window.location')
expectMatches(homePage, /<IdentityPanel \/>\s*<ContinuePanel \/>[\s\S]{0,180}?<ReferenceServiceNav \/>/, '首页严格保持 身份卡 → 继续上次 → 共享分类导航 顺序')
expectMatches(homePage, /<main\s+className="home-service-catalog"\s+aria-label="当前可使用功能">/, 'HomePage 渲染 4188 服务目录主区')
expect(!homePage.includes('service-quick-nav'), 'HomePage 不再渲染旧胶囊分类导航')
expect(!homePage.includes('className="sec-head"'), 'HomePage 不再渲染旧服务区 sec-head')
expect(!homePage.includes('className="home-grid"'), 'HomePage 不再渲染旧服务区 home-grid')

expectMatches(home, /id=\{group\.id\}/, '首页服务组使用 serviceGroups 的稳定 id 作为目标锚点')
for (const id of ['resume', 'jobs', 'job-fairs', 'print-scan', 'interview', 'policy']) {
  expect(groupsBlock.includes(`id: '${id}'`), `首页保留 #${id} 目标锚点数据`)
}
expectMatches(groupsBlock, /AI简历诊断[\s\S]{0,140}AI简历优化/, 'AI 简历首行双主入口')
expectMatches(homePage, /<div\s+className="lf-reference-pair"\s+aria-label="岗位信息与招聘会">/, '岗位信息与招聘会放入同一 lf-reference-pair')
expectMatches(homePage, /<div\s+className="lf-reference-pair"\s+aria-label="面试训练与政策服务">/, '面试训练与政策服务放入同一 lf-reference-pair')
expectMatches(home, /className="lf-reference-group-head">\s*<span\s+className=\{`home-reference-icon/, '每个服务分组头的图标容器是第一个直接子元素')
expectMatches(home, /<button\b[\s\S]{0,180}className="lf-reference-primary"[^>]*>\s*<span\s+className=\{`home-reference-icon/, '每个服务主入口的图标容器是第一个直接子元素')

for (const title of ['AI简历诊断', 'AI简历优化', '全部岗位', '社会招聘会', '校园招聘会', '文档打印', '纸质扫描', '模拟面试']) {
  expectMatches(
    groupsBlock,
    new RegExp(`\\{[^{}]*title:\\s*'${escapeRegExp(title)}'[^{}]*emphasis:\\s*'primary'[^{}]*\\}`),
    `4188 主入口语义由 serviceGroups 数据声明：${title}`,
  )
}
for (const title of ['就业政策', '社保指南', '档案 / 登记']) {
  const item = groupsBlock.match(new RegExp(`\\{[^{}]*title:\\s*'${escapeRegExp(title)}'[^{}]*\\}`))?.[0] ?? ''
  expect(item.length > 0 && !/emphasis:\s*'primary'/.test(item), `政策入口保持次入口语义：${title}`)
}
for (const [id, layout] of [
  ['resume', 'wide'],
  ['jobs', 'half'],
  ['job-fairs', 'half'],
  ['print-scan', 'wide'],
  ['interview', 'half'],
  ['policy', 'half'],
]) {
  expectMatches(
    groupsBlock,
    new RegExp(`id:\\s*'${id}'[\\s\\S]{0,220}?layout:\\s*'${layout}'`),
    `服务组 ${id} 使用 4188 ${layout} 分栏语义`,
  )
}
expectMatches(home, /group\.tiles\.filter\(\(tile\) => tile\.emphasis === 'primary'\)/, '首页按 serviceGroups emphasis 过滤主入口')
expectMatches(home, /group\.tiles\.filter\(\(tile\) => tile\.emphasis !== 'primary'\)/, '首页按 serviceGroups emphasis 过滤次入口')

expect(!services.includes('.khome .service-quick-nav'), '服务 CSS 已移除旧胶囊分类导航')
expect(!services.includes('.khome .service-catalog-group'), '服务 CSS 已移除旧大圆角服务组')
expect(!services.includes('.khome .service-catalog-tile'), '服务 CSS 已移除旧深蓝主卡入口')
expect(!cssRule(services, '.khome .sec-head'), '服务 CSS 不再定义旧 sec-head 布局合同')
expect(!cssRule(services, '.khome .home-grid'), '服务 CSS 不再定义旧 home-grid 布局合同')
expect(!cssRule(responsive, '.khome .home-grid'), '响应式 CSS 不再保留旧 home-grid 尺寸合同')
expectMatches(cssRule(services, '.khome .home-service-catalog'), /display:\s*grid[\s\S]*?gap:\s*26px/, '服务目录按 4188 的 26px 面板留白排列')
expectMatches(cssRule(services, '.khome .home-reference-panel'), /min-width:\s*0/, '首页特有面板限制最小宽度避免横向溢出')
expectMatches(cssRule(services, '.khome .home-reference-primary-list'), /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)[\s\S]*?gap:\s*12px[\s\S]*?margin:\s*0 20px 12px/, '主入口保持两列、12px 间距并内缩 20px')
expectMatches(cssRule(services, '.khome .home-reference-secondary-list'), /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/, '有主入口时次入口按原型保持两列')
expectMatches(cssRule(services, '.khome .home-reference-secondary-list--only'), /grid-template-columns:\s*1fr/, '无主入口的政策服务使用单列行式次入口')
expect(!/box-shadow\s*:/.test(cssRule(services, '.khome .home-reference-panel')), '首页服务面板不使用大投影')

expectMatches(cssRule(shell, '.khome'), /width:\s*min\(1080px,\s*100%\)[\s\S]*?margin:\s*0 auto/, '首页使用 1080px 居中外壳')
expectMatches(cssRule(services, '.khome .home-service-track'), /width:\s*min\(980px,\s*calc\(100% - 100px\)\)[\s\S]*?margin:\s*0 auto/, '首页下半服务区使用约 980px 内容轨')

expect(!/\.kassist|\.kprofile/.test(referenceServiceNavCss), '分类导航共享 CSS 只作用于首页 .khome')
expect(!/\.kassist|\.kprofile/.test(referenceLayoutCss), '目录布局共享 CSS 只作用于首页 .khome')
expectMatches(referenceServiceNav, /import\s*\{\s*useLocation,\s*useNavigate\s*\}\s*from\s*['"]react-router-dom['"]/, '分类导航读取当前 location')
expectMatches(referenceServiceNav, /const\s*\{\s*hash\s*\}\s*=\s*useLocation\(\)/, '分类导航从 useLocation 读取 hash')
expectMatches(referenceServiceNav, /aria-current=\{hash === item\.hash \? 'location' : undefined\}/, '分类导航用 aria-current 提供 active 反馈')
expectMatches(cssRule(referenceServiceNavCss, '.khome .reference-service-nav'), /position:\s*sticky[\s\S]*?top:\s*var\(--home-sticky-top,[^)]*\)[\s\S]*?grid-template-columns:\s*repeat\(6,[\s\S]*?z-index:\s*20/, '分类导航为六项 sticky 导航')
expectMinimumHeight(referenceServiceNavCss, '.khome .reference-service-nav button', 56, '分类导航按钮')
expectMatches(cssRule(referenceServiceNavCss, ".khome .reference-service-nav button[aria-current='location']"), /color:\s*var\(--home-primary\)/, '分类导航 active 使用当前 LightFlow 主色 token')
expectMatches(cssRule(referenceServiceNavCss, '@media (max-width: 760px)'), /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/, '<=760px 分类导航切为三列')

expectMatches(cssRule(referenceLayoutCss, '.khome .lf-reference-panel'), /scroll-margin-top:\s*112px/, '服务分组保留 112px sticky 导航滚动余量')
expectMatches(cssRule(referenceLayoutCss, '.khome .lf-reference-group-head'), /min-block-size:\s*72px[\s\S]*?background:\s*transparent/, '分组头为 72px 透明行')
expectMatches(cssRule(referenceLayoutCss, '.khome .lf-reference-group-head > :first-child'), /inline-size:\s*56px[\s\S]*?block-size:\s*56px[\s\S]*?border-radius:\s*12px/, '分组图标 56px 且 radius 12px')
expectMatches(cssRule(referenceLayoutCss, '.khome .lf-reference-primary'), /min-block-size:\s*104px[\s\S]*?border-radius:\s*12px/, '主入口 104px 且 radius 12px')
expectMatches(cssRule(referenceLayoutCss, '.khome .lf-reference-primary > :first-child'), /inline-size:\s*58px[\s\S]*?block-size:\s*58px[\s\S]*?border-radius:\s*12px/, '主入口图标 58px 且 radius 12px')
expectMatches(cssRule(referenceLayoutCss, '.khome .lf-reference-secondary'), /min-block-size:\s*88px/, '次入口使用 88px 行式布局')
expectMatches(cssRule(referenceLayoutCss, '.khome .lf-reference-secondary > :first-child'), /inline-size:\s*52px[\s\S]*?block-size:\s*52px[\s\S]*?border-radius:\s*12px/, '次入口图标 52px 且 radius 12px')
expectMatches(cssRule(referenceLayoutCss, '.khome .lf-reference-pair'), /gap:\s*26px/, '并排服务组使用 26px 间距')
expectMatches(cssRule(referenceLayoutCss, '@media (max-width: 760px)'), /\.khome \.lf-reference-pair\s*\{[^}]*grid-template-columns:\s*1fr[\s\S]*?\.khome \.lf-reference-primary-list,[\s\S]*?grid-template-columns:\s*1fr/, '<=760px 服务组与动作均切为单列')
expectMatches(cssRule(referenceLayoutCss, '@media (max-width: 520px)'), /scroll-margin-top:\s*168px/, '<=520px 服务分组增加 sticky 导航滚动余量')

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
expectMatches(identityPanel, /const \[loginOpen, setLoginOpen\] = useState\(false\)/, '身份条使用本地状态控制登录弹窗')
expectMatches(identityPanel, /const loginTriggerRef = useRef<HTMLButtonElement>\(null\)/, '身份条保留登录触发按钮引用以恢复焦点')
expect(!identityPanel.includes("navigate('/login'"), '首页登录入口不再跳转独立登录页')
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
  /<MemberLoginDialog[\s\S]*?open=\{loginOpen\}[\s\S]*?onClose=\{\(\) => setLoginOpen\(false\)\}[\s\S]*?onContinueAsGuest=\{\(\) => \{\s*continueAsGuest\(\)\s*setLoginOpen\(false\)\s*\}\}/,
  '身份条游客回调进入真实游客态并关闭登录弹窗',
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
expectMatches(toolboxSection, /className="home-extension-group"[\s\S]*?\{items\.length > 0 \? \([\s\S]*?\{items\.map\([\s\S]*?<ToolboxExtensionButton[\s\S]*?<\/div>\s*\) : \([\s\S]*?<strong>待配置<\/strong>/, '百宝箱真实条目与受控空态均使用扁平横向扩展行')
expect(!/cat-card|sub-grid|className="sub/.test(toolboxSection), '百宝箱不再使用旧 cat-card/sub 卡墙')

expectMatches(smartCampusSection, /const config = useSmartCampusConfig\(\)/, '智慧校园读取真实终端配置 hook')
expectMatches(smartCampusSection, /\.filter\(\(key\) => config\.modules\[key\]\)[\s\S]*?const campusItems = \[\.\.\.\(config\.items \?\? \[\]\)\]\.sort/, '智慧校园入口由真实模块与投放条目生成')
expectMatches(smartCampusSection, /if \(!config\.enabled \|\| \(enabledTiles\.length === 0 && campusItems\.length === 0\)\) return null\s*\n\s*return \(/, '智慧校园仅在启用且有真实入口时进入渲染')
expectMatches(smartCampusSection, /className="home-extension-group"[\s\S]*?enabledTiles\.map\(\(tile\) => \([\s\S]*?<ExtensionServiceButton[\s\S]*?campusItems\.map\(\(item\) => \([\s\S]*?<ToolboxExtensionButton/, '智慧校园可达 JSX 映射真实模块与投放条目为扁平横向扩展行')
expect(!/cat-card|sub-grid|className="sub/.test(smartCampusSection), '智慧校园不再使用旧 cat-card/sub 卡墙')
expectMatches(homePage, /<ToolboxSection \/>\s*<SmartCampusHorizontalSection \/>/, 'HomePage 直接按顺序渲染百宝箱与智慧校园')
expectMatches(homePage, /useInkRipple\('\.khome \.lf-reference-primary, \.khome \.lf-reference-secondary, \.khome \.home-extension-action, \.khome \.btn, \.khome \.id-stat'\)/, '首页可达目录按钮与扩展行保留触控涟漪绑定')
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
