#!/usr/bin/env node
/**
 * apps/miniapp 静态门禁（原生 1.0.2 唯一工程底座）：
 * - JSON 全部可解析
 * - app.json pages 均有四件套（js/wxml/wxss/json）
 * - 唯一工程目录、页面归类与运行时依赖方向不回退
 * - tabBar 四 Tab 与 custom-tab-bar 一致
 * - 页面路由不指向未注册页面
 * - 登录/合规/诚实能力与密钥残留扫描
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0
const fails = []

function ok(name) { pass += 1; console.log(`  ✓ ${name}`) }
function bad(name, detail) { fails.push(`${name} — ${detail}`); console.log(`  ✗ ${name} — ${detail}`) }

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) walk(rel, out)
    else out.push(rel)
  }
  return out
}

const files = walk('.')
const jsonFiles = files.filter((f) => f.endsWith('.json'))
const parsedJson = {}
for (const f of jsonFiles) {
  try { parsedJson[f] = JSON.parse(read(f)) } catch (e) { bad('JSON 可解析', `${f}: ${e.message}`) }
}
if (!fails.length) ok('JSON 全部可解析')

const appJson = parsedJson['./app.json']
if (!appJson) bad('app.json 存在', '未读取到')

if (appJson) {
  const pages = appJson.pages || []
  const missingPages = pages.filter((p) =>
    ['.js', '.wxml', '.wxss', '.json'].some((ext) => !fs.existsSync(path.join(ROOT, `${p}${ext}`)))
  )
  if (missingPages.length) bad('页面四件套完整', missingPages.join(','))
  else ok('页面四件套完整')

  const tab = appJson.tabBar || {}
  const expected = [
    { pagePath: 'pages/home/home', text: '首页' },
    { pagePath: 'pages/ai/ai', text: 'AI百宝箱' },
    { pagePath: 'pages/jobs/jobs', text: '求职' },
    { pagePath: 'pages/me/me', text: '我的' },
  ]
  const tabOk = tab.custom === true &&
    Array.isArray(tab.list) &&
    tab.list.length === 4 &&
    tab.list.every((item, i) => item.pagePath === expected[i].pagePath && item.text === expected[i].text) &&
    tab.list.every((item) => pages.includes(item.pagePath))
  if (tabOk) ok('tabBar 四 Tab 配置正确')
  else bad('tabBar 四 Tab 配置', JSON.stringify(tab))

  const barJs = read('custom-tab-bar/index.js')
  const normalizePath = (p) => p.replace(/^\/+/, '')
  const barListOk = expected.every(({ pagePath, text }) => {
    const target = normalizePath(pagePath)
    return barJs.includes(`pagePath: '/${target}'`) && barJs.includes(`text: '${text}'`)
  })
  if (barListOk) ok('custom-tab-bar 与 app.json 一致')
  else bad('custom-tab-bar 与 app.json 一致', 'pagePath/text 不匹配')
}

const wxmlFiles = files.filter((f) => f.endsWith('.wxml'))
const TAB_PATHS = ['/pages/home/home', '/pages/ai/ai', '/pages/jobs/jobs', '/pages/me/me']
const PAGE_PATHS = appJson ? (appJson.pages || []) : []

const allowedTopLevel = new Set([
  'README.md',
  'app.js',
  'app.json',
  'app.wxss',
  'custom-tab-bar',
  'package.json',
  'pages',
  'project.config.json',
  'scripts',
  'sitemap.json',
  'utils',
])
const generatedTopLevel = new Set([
  '.DS_Store',
  'miniprogram_npm',
  'node_modules',
  'project.private.config.json',
])
const unexpectedTopLevel = fs.readdirSync(ROOT)
  .filter((name) => !allowedTopLevel.has(name) && !generatedTopLevel.has(name))
if (unexpectedTopLevel.length) bad('小程序唯一目录分类', unexpectedTopLevel.join(','))
else ok('小程序唯一目录分类受门禁')

const registeredPageDirs = new Set(PAGE_PATHS.map((page) => path.dirname(page)))
const physicalPageDirs = fs.readdirSync(path.join(ROOT, 'pages'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `pages/${entry.name}`)
const loosePageFiles = fs.readdirSync(path.join(ROOT, 'pages'), { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
const nonCanonicalPages = PAGE_PATHS.filter((page) => path.basename(page) !== path.basename(path.dirname(page)))
const unregisteredPageDirs = physicalPageDirs.filter((dir) => !registeredPageDirs.has(dir))
const missingPageDirs = [...registeredPageDirs].filter((dir) => !physicalPageDirs.includes(dir))
const pageShapeErrors = [...nonCanonicalPages, ...unregisteredPageDirs, ...missingPageDirs, ...loosePageFiles]
if (pageShapeErrors.length) bad('页面目录与注册路由一一对应', pageShapeErrors.join(','))
else ok('页面目录与注册路由一一对应')

const projectConfig = parsedJson['./project.config.json'] || {}
const packageJson = parsedJson['./package.json'] || {}
const packIgnoresScripts = (projectConfig.packOptions?.ignore || [])
  .some((entry) => entry?.type === 'folder' && entry?.value === 'scripts')
const runtimeDependencies = Object.keys(packageJson.dependencies || {})
if (packIgnoresScripts && runtimeDependencies.length === 0) {
  ok('发布包排除验证脚本且无运行时 npm 依赖')
} else {
  bad('发布包与运行时依赖', `scriptsExcluded=${packIgnoresScripts}; dependencies=${runtimeDependencies.join(',')}`)
}

for (const f of wxmlFiles) {
  const src = read(f)
  const urls = [...src.matchAll(/data-url="([^"]+)"/g)].map((m) => m[1]).filter((u) => !u.includes('{{'))
  const dead = urls.filter((u) => {
    const target = u.replace(/^\//, '').split('?')[0]
    return !PAGE_PATHS.includes(target)
  })
  if (dead.length) bad('路由不指向死页面', `${f}: ${dead.join(',')}`)
  else ok(`路由检查 ${f}`)
}

// M0.3：JS 跳转目标审计（navigateTo / switchTab / redirectTo）+ 死绑定检查
const jsFiles = files.filter((f) => f.endsWith('.js') && !f.includes('/scripts/'))
const pagePathSet = new Set(PAGE_PATHS)

const dependencyErrors = []
const dependencyGraph = new Map(jsFiles.map((file) => [file, []]))
for (const file of jsFiles) {
  const source = read(file)
  const literalRequires = [...source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)]
  const requireCallCount = [...source.matchAll(/\brequire\s*\(/g)].length
  if (requireCallCount !== literalRequires.length) dependencyErrors.push(`${file}: 禁止动态 require`)

  for (const match of literalRequires) {
    const specifier = match[1]
    if (!specifier.startsWith('.')) {
      dependencyErrors.push(`${file}: 运行时第三方依赖 ${specifier} 未登记`)
      continue
    }

    const sourceAbsolute = path.join(ROOT, file)
    const unresolved = path.resolve(path.dirname(sourceAbsolute), specifier)
    const candidates = path.extname(unresolved)
      ? [unresolved]
      : [`${unresolved}.js`, `${unresolved}.json`, path.join(unresolved, 'index.js')]
    const targetAbsolute = candidates.find((candidate) => fs.existsSync(candidate))
    if (!targetAbsolute) {
      dependencyErrors.push(`${file}: 找不到 ${specifier}`)
      continue
    }

    const target = `./${path.relative(ROOT, targetAbsolute).split(path.sep).join('/')}`
    const sourceDir = path.dirname(file)
    const targetInsideRoot = !target.startsWith('./../')
    const sourceIsPage = file.startsWith('./pages/')
    const sourceIsUtils = file.startsWith('./utils/')
    const sourceIsApp = file === './app.js'
    const sourceIsTabBar = file.startsWith('./custom-tab-bar/')
    const targetIsUtils = target.startsWith('./utils/')
    const targetIsSamePage = sourceIsPage && path.dirname(target) === sourceDir
    const targetIsSameTabBar = sourceIsTabBar && target.startsWith('./custom-tab-bar/')
    const directionAllowed = targetInsideRoot && (
      (sourceIsPage && (targetIsUtils || targetIsSamePage)) ||
      (sourceIsUtils && targetIsUtils) ||
      (sourceIsApp && targetIsUtils) ||
      (sourceIsTabBar && (targetIsUtils || targetIsSameTabBar))
    )
    if (!directionAllowed) dependencyErrors.push(`${file}: 禁止依赖 ${target}`)
    if (dependencyGraph.has(target)) dependencyGraph.get(file).push(target)
  }
}

const dependencyVisitState = new Map()
const dependencyStack = []
function visitDependency(file) {
  const state = dependencyVisitState.get(file) || 0
  if (state === 2) return
  if (state === 1) {
    const start = dependencyStack.indexOf(file)
    dependencyErrors.push(`循环依赖: ${dependencyStack.slice(start).concat(file).join(' -> ')}`)
    return
  }
  dependencyVisitState.set(file, 1)
  dependencyStack.push(file)
  for (const target of dependencyGraph.get(file) || []) visitDependency(target)
  dependencyStack.pop()
  dependencyVisitState.set(file, 2)
}
for (const file of dependencyGraph.keys()) visitDependency(file)
if (dependencyErrors.length) bad('运行时依赖方向', [...new Set(dependencyErrors)].join('; '))
else ok('运行时依赖方向清晰且无循环')

const syntaxErrors = []
for (const f of jsFiles) {
  try { new Function(read(f)) } catch (error) { syntaxErrors.push(`${f}: ${error.message}`) }
}
if (syntaxErrors.length) bad('JavaScript 语法', syntaxErrors.join('; '))
else ok('JavaScript 语法全部有效')

const badCommonJsImports = jsFiles.filter((f) => /const\s+\{\s*(api|storage|auth)\s*\}\s*=\s*require\(/.test(read(f)))
if (badCommonJsImports.length) bad('CommonJS 模块导入形态', badCommonJsImports.join(','))
else ok('CommonJS 模块导入形态正确')

for (const f of jsFiles) {
  const src = read(f)
  const targets = [...src.matchAll(/(?:navigateTo|switchTab|redirectTo|reLaunch)\(\{\s*url:\s*[`'"]([^`'"?]+)/g)].map((m) => m[1])
  const deadJs = targets
    .filter((t) => !t.includes('${'))
    .map((t) => t.replace(/^\//, '').replace(/\/$/, ''))
    .filter((t) => !pagePathSet.has(t))
  if (deadJs.length) bad('JS 跳转目标已注册', `${f}: ${[...new Set(deadJs)].join(',')}`)
}
if (!fails.some((x) => x.startsWith('JS 跳转目标已注册'))) ok('JS 跳转目标全部已注册')

for (const f of wxmlFiles.filter((x) => x.startsWith('./pages/'))) {
  const pageJs = f.replace(/\.wxml$/, '.js')
  if (!jsFiles.includes(pageJs)) continue
  const wxml = read(f)
  const js = read(pageJs)
  const handlers = [...wxml.matchAll(/(?:bind|catch)tap="([A-Za-z0-9_]+)"/g)].map((m) => m[1])
  const deadHandlers = [...new Set(handlers)].filter((h) => !new RegExp(`${h}\\s*\\(`).test(js))
  if (deadHandlers.length) bad('事件绑定有实现', `${f}: ${deadHandlers.join(',')}`)
}
if (!fails.some((x) => x.startsWith('事件绑定有实现'))) ok('事件绑定全部有实现')

// dataset 读取必须在同页 WXML 有对应 data-*，否则点击时得到 undefined。
const datasetErrors = []
for (const f of jsFiles.filter((x) => x.startsWith('./pages/'))) {
  const wxmlFile = f.replace(/\.js$/, '.wxml')
  if (!wxmlFiles.includes(wxmlFile)) continue
  const reads = [...read(f).matchAll(/dataset\.([A-Za-z0-9_]+)/g)].map((m) => m[1].toLowerCase())
  const bound = [...read(wxmlFile).matchAll(/data-([A-Za-z0-9_-]+)=/g)]
    .map((m) => m[1].replace(/-/g, '').toLowerCase())
  const missing = [...new Set(reads)].filter((key) => !bound.includes(key.replace(/_/g, '')))
  if (missing.length) datasetErrors.push(`${f}: ${missing.join(',')}`)
}
if (datasetErrors.length) bad('dataset 绑定完整', datasetErrors.join('; '))
else ok('dataset 绑定完整')

const validIcons = new Set([
  'i-aim','i-bank','i-bell','i-calendar','i-comment','i-compass','i-crown',
  'i-edit','i-file-search','i-file-text','i-folder','i-form','i-history','i-home',
  'i-inbox','i-info','i-link','i-location','i-printer','i-right','i-robot',
  'i-scan','i-search','i-setting','i-solution','i-thunder','i-upload','i-user',
])
const invalidIcons = []
for (const f of wxmlFiles) {
  for (const match of read(f).matchAll(/class="([^"]*\bficon\b[^"]*)"/g)) {
    for (const name of match[1].split(/\s+/)) {
      if (name.startsWith('i-') && !name.includes('{') && !validIcons.has(name)) invalidIcons.push(`${f}:${name}`)
    }
  }
}
if (invalidIcons.length) bad('图标类有效', [...new Set(invalidIcons)].join(','))
else ok('图标类有效')

const forbidden = ['一键投递', '立即投递', '录用概率', '成功率', '匹配率', 'matchRate']
for (const f of wxmlFiles) {
  const src = read(f)
  const hit = forbidden.filter((w) => src.includes(w))
  if (hit.length) bad('合规文案', `${f}: ${hit.join(',')}`)
}
if (!fails.some((x) => x.startsWith('合规文案'))) ok('合规文案无违规词')

// M0.2 登录门禁
const loginWxml = read('pages/launch/launch.wxml')
const loginJs = read('pages/launch/launch.js')
const apiJs = read('utils/api.js')
const authJs = read('utils/auth.js')
const meWxml = read('pages/me/me.wxml')
const settingsWxml = read('pages/settings/settings.wxml')
const settingsJs = read('pages/settings/settings.js')
const loginPageOk = PAGE_PATHS.includes('pages/launch/launch') &&
  PAGE_PATHS.includes('pages/legal/legal') &&
  PAGE_PATHS.includes('pages/privacy/privacy')
if (loginPageOk) ok('登录/协议/隐私页已注册')
else bad('登录/协议/隐私页已注册', 'app.json 缺少页面')
if (loginWxml.includes('open-type="getPhoneNumber"') && loginWxml.includes('短信验证码')) ok('登录页含微信一键登录与短信降级')
else bad('登录页含微信一键登录与短信降级', '缺少 open-type 或短信入口')
if (loginWxml.includes('已阅读并同意') && loginWxml.includes('《用户服务协议》') && loginWxml.includes('《隐私政策》')) ok('登录页含协议勾选')
else bad('登录页含协议勾选', '缺少同意文案')
if (
  (apiJs.includes('wx.login') || authJs.includes('wx.login')) &&
  loginJs.includes('api.loginByPhone') &&
  !/appSecret\s*[:=]/.test(loginJs) &&
  !/session_key\s*[:=]/.test(loginJs) &&
  !/appSecret\s*[:=]/.test(apiJs)
) ok('登录实现无密钥残留')
else bad('登录实现无密钥残留', '检查 api.js 的 wx.login 与敏感字段')
if (meWxml.includes('bindtap="tapLogin"') && meWxml.includes('未登录') && settingsWxml.includes('退出登录') && settingsJs.includes('api.logout()') && settingsJs.includes('auth.clearSession()')) ok('登录与真实退出入口完整')
else bad('登录与真实退出入口完整', '缺少登录按钮、服务端 logout 或本地会话清理')

// 1.0.2 诚实能力门禁：移除无后端支撑的可见页面，禁止已知 PII/商业承诺占位回流。
const removedFakePages = [
  'pages/id-photo/id-photo',
  'pages/link-analysis/link-analysis',
  'pages/resume-generate/resume-generate',
  'pages/print-bundle/print-bundle',
  'pages/push-print/push-print',
  'pages/scan-sync/scan-sync',
]
const fakeRegistered = removedFakePages.filter((page) => PAGE_PATHS.includes(page))
if (fakeRegistered.length) bad('未注册无后端支撑页面', fakeRegistered.join(','))
else ok('未注册无后端支撑页面')

const textFiles = files.filter((f) => !f.endsWith('.json') || f.endsWith('app.json'))
const honestyPatterns = [
  /陈明/,
  /138\*\*\*\*6621/,
  /示例企业（等待接入真实数据）/,
  /AI\s*服务无限次/,
  /微信支付开通/,
  /手机付费/,
]
const honestyHits = []
for (const f of textFiles) {
  if (f.startsWith('./scripts/verify-miniapp-static.mjs')) continue
  const src = read(f)
  if (honestyPatterns.some((pattern) => pattern.test(src))) honestyHits.push(f)
}
if (honestyHits.length) bad('无伪造个人数据或商业能力', honestyHits.join(','))
else ok('无伪造个人数据或商业能力')

const pickupWxml = read('pages/print-pickup/print-pickup.wxml')
const pickupJs = read('pages/print-pickup/print-pickup.js')
const pickupQr = read('utils/pickup-qrcode.js')
if (
  pickupWxml.includes('type="2d"') &&
  pickupWxml.includes('请将此二维码对准一体机扫码器') &&
  pickupWxml.includes('二维码只包含本订单的 10 位取件码') &&
  pickupJs.includes("require('../../utils/pickup-qrcode')") &&
  pickupJs.includes('createPickupQrMatrix(this.data.codeRaw)') &&
  pickupQr.includes("PICKUP_CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/") &&
  pickupQr.includes('const HIGH_ECC_FORMAT_BITS = 2') &&
  !pickupWxml.includes('bindtap="scanTerminal"') &&
  !apiJs.includes('/pickup`')
) ok('取件页本地生成核销二维码并保留真实码兜底')
else bad('取件页扫码核销能力', '必须离线编码真实 10 位码，不得恢复手机反扫终端或不存在的详情接口')

const documentsJs = read('pages/documents/documents.js')
const printUploadJs = read('pages/print-upload/print-upload.js')
const printPayJs = read('pages/print-pay/print-pay.js')
if (
  documentsJs.includes('api.uploadPrintFile') &&
  printUploadJs.includes('api.createPrintPiiScan') &&
  printUploadJs.includes("privacyStatus !== 'ready'") &&
  printPayJs.includes('api.createCloudPrintOrder') &&
  apiJs.includes("request('/me/print-orders', { method: 'POST'") &&
  !/createCloudPrintOrder\(\{[\s\S]{0,500}\b(?:amountCents|billablePages|pages)\s*:/.test(printPayJs) &&
  !printPayJs.includes('预提交接口尚未开通')
) ok('文档真实上传、隐私确认且由服务端建单计价')
else bad('文档上传与服务端计价闭环', '缺少真实上传、PII 确认、Order-only 建单，或仍由小程序提交金额/页数')

const configJs = read('utils/config.js')
if (/USE_MOCK:\s*false/.test(configJs)) ok('正式源码默认关闭 mock')
else bad('正式源码默认关闭 mock', 'utils/config.js 必须 USE_MOCK=false')

const secretPatterns = [/sk-[A-Za-z0-9]{12,}/, /AKID[A-Za-z0-9]{10,}/, /AI_LLM_API_KEY\s*[:=]/, /DATABASE_URL\s*[:=]/]
let secretHit = false
for (const f of textFiles) {
  if (f.startsWith('./scripts/verify-miniapp-static.mjs')) continue
  const src = read(f)
  if (secretPatterns.some((re) => re.test(src))) { bad('密钥残留', f); secretHit = true }
}
if (!secretHit) ok('无密钥残留')

const pageCount = (appJson?.pages || []).length
console.log(`\n${pass} PASS / ${fails.length} FAIL（注册页面 ${pageCount}）`)
if (fails.length) {
  console.error('\n失败项：')
  for (const f of fails) console.error(`  - ${f}`)
  process.exit(1)
}
