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

// 必须跳过 .claude 与 node_modules：本仓把 git worktree 建在
// apps/miniapp/.claude/worktrees/ 下，形成嵌套的小程序检出。
// 不跳过的话，从主仓运行本门禁会走进嵌套检出并 EISDIR 崩溃——
// 也就是说开发者工具实际读的那份代码上，门禁从来没跑起来过。
// 这两个目录本来就在 app.json 的 packOptions.ignore 里，不属于产物。
const SKIP_DIRS = new Set(['.claude', 'node_modules', '.git'])

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
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
    // 职业生活圈改版：该 Tab 由「AI百宝箱」（按「这是不是 AI」分类）改为
    // 「职业生活圈」（按用户处境分组）。tabBar 是 custom:true，真正渲染出来的
    // 文案在 custom-tab-bar/index.js，本门禁的价值就是逼这两处必须同时改。
    { pagePath: 'pages/ai/ai', text: '职业生活圈' },
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
  // assets：本地静态图片。放开该目录的同时必须由下方「本地图片体积预算」守住，
  // 否则主包会被大图侵蚀（曾有 WIP 分支塞入 284KB 单图 = 2MB 主包预算的 14%）。
  'assets',
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
  // 本仓把 git worktree 建在 apps/miniapp/.claude/worktrees/ 下，
  // 该目录已在 app.json 的 packOptions.ignore 中，不进小程序包。
  '.claude',
  'project.private.config.json',
])
const unexpectedTopLevel = fs.readdirSync(ROOT)
  .filter((name) => !allowedTopLevel.has(name) && !generatedTopLevel.has(name))
if (unexpectedTopLevel.length) bad('小程序唯一目录分类', unexpectedTopLevel.join(','))
else ok('小程序唯一目录分类受门禁')

// ── 本地图片体积预算 ──────────────────────────────────────────
// 主包上限 2MB。小程序此前零本地图片，是重要资产；一旦放开 assets/ 必须钉死预算，
// 否则头像、空态插画、徽章会迅速侵蚀主包。UGC/运营类图片一律走远程 URL，不进包。
const IMG_MAX_SINGLE = 60 * 1024
const IMG_MAX_TOTAL = 300 * 1024
const imgExt = /\.(png|jpe?g|gif|webp|bmp)$/i
const walkImages = (dir, acc = []) => {
  if (!fs.existsSync(dir)) return acc
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walkImages(p, acc)
    else if (imgExt.test(e.name)) acc.push({ p, size: fs.statSync(p).size })
  }
  return acc
}
const localImages = walkImages(ROOT).filter((f) => !f.p.includes(`${path.sep}node_modules${path.sep}`))
const oversize = localImages.filter((f) => f.size > IMG_MAX_SINGLE)
const imgTotal = localImages.reduce((s, f) => s + f.size, 0)
if (oversize.length) {
  bad('本地图片单张体积预算', oversize.map((f) => `${path.relative(ROOT, f.p)}=${Math.round(f.size / 1024)}KB`).join(','))
} else if (imgTotal > IMG_MAX_TOTAL) {
  bad('本地图片总量预算', `${Math.round(imgTotal / 1024)}KB > ${IMG_MAX_TOTAL / 1024}KB`)
} else {
  ok(`本地图片体积预算（${localImages.length} 张 / ${Math.round(imgTotal / 1024)}KB）`)
}

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

// 从 app.wxss 实际定义推导，不再维护硬编码清单。
// 硬编码列表必然相对样式表漂移：i-close 已在 app.wxss 定义却不在旧清单里，
// 导致真实可用的图标被判为违规；反过来漂移则会放过真正缺定义的图标。
// 这里要守的不变量是「页面用到的每个图标都有 CSS 定义」，
// 唯一可靠的事实来源就是 app.wxss 本身。
const validIcons = new Set(
  [...read('app.wxss').matchAll(/\.(i-[a-z0-9-]+)\s*(?:,|\{|::)/g)].map((m) => m[1]),
)
if (validIcons.size >= 20) ok(`图标定义已从 app.wxss 推导（${validIcons.size} 个）`)
else bad('图标定义已从 app.wxss 推导', `只解析到 ${validIcons.size} 个，app.wxss 可能未被正确读取`)
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
const requestJs = read('utils/request.js')
const meWxml = read('pages/me/me.wxml')
const settingsWxml = read('pages/settings/settings.wxml')
const settingsJs = read('pages/settings/settings.js')
const documentsJs = read('pages/documents/documents.js')
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
if (meWxml.includes('bindtap="tapLogin"') && meWxml.includes('未登录') && settingsWxml.includes('退出登录') && settingsJs.includes('api.logout()') && (settingsJs.includes('auth.logout()') || settingsJs.includes('auth.clearSession()'))) ok('登录与真实退出入口完整')
else bad('登录与真实退出入口完整', '缺少登录按钮、服务端 logout 或本地会话清理')

// 401 静默补签的准入依据必须与「当前有没有 token」解耦。
// getToken() 在 JWT 过期时会先 clearSession 再返回 null，使「自然过期」
// 与「主动登出」完全同形；用 token 判断必然二选一地出错——要么过期后
// 补不了签（取件页 401 原样存在），要么登出后被自动登回（共用设备隐私）。
const storageJs = read('utils/storage.js')
if (
  storageJs.includes('RESIGNIN_ELIGIBLE') &&
  authJs.includes('canSilentResignin') &&
  requestJs.includes('auth.canSilentResignin()') &&
  !/&&\s*!!auth\.getToken\(\)/.test(requestJs) &&
  settingsJs.includes('auth.logout()')
) ok('401 补签准入与 token 存在性解耦')
else bad('401 补签准入与 token 存在性解耦', '补签不得以 auth.getToken() 是否有值作为准入，登出须撤销补签资格')

const membershipJs = read('pages/membership/membership.js')
const notificationsJs = read('pages/notifications/notifications.js')
const loginReturnPages = [documentsJs, membershipJs, notificationsJs]
if (
  loginJs.includes('LOGIN_RETURN_ROUTES') &&
  loginJs.includes('safeReturnTo') &&
  loginJs.includes('this.data.returnTo') &&
  loginReturnPages.every((source) => source.includes('returnTo=${encodeURIComponent('))
) ok('登录后受控回到原会员页面')
else bad('登录后受控回到原会员页面', '缺少 returnTo 白名单或受保护页面未传回跳地址')

function fakeMemberToken(exp) {
  const encode = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: 'verify-user', exp })}.signature`
}

function loadAuthForVerify(token) {
  const state = { zyd_token: token, zyd_user: { maskedPhone: '183****1921' } }
  const mockStorage = {
    KEYS: { TOKEN: 'zyd_token', USER: 'zyd_user' },
    get(key, fallback = null) { return Object.prototype.hasOwnProperty.call(state, key) ? state[key] : fallback },
    set(key, value) { state[key] = value; return true },
    remove(key) { delete state[key]; return true },
  }
  const authModule = { exports: {} }
  const load = new Function('module', 'exports', 'require', authJs)
  load(authModule, authModule.exports, (id) => {
    if (id === './storage') return mockStorage
    throw new Error(`unexpected require: ${id}`)
  })
  return { auth: authModule.exports, state }
}

try {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const expired = loadAuthForVerify(fakeMemberToken(nowSeconds - 60))
  const active = loadAuthForVerify(fakeMemberToken(nowSeconds + 3600))
  const expiredCleared = !expired.auth.isLoggedIn() && !expired.state.zyd_token && !expired.state.zyd_user
  const activeKept = active.auth.isLoggedIn() && Boolean(active.state.zyd_token)
  if (expiredCleared && activeKept && requestJs.includes('auth.getToken()') && (requestJs.includes('auth.logout()') || requestJs.includes('auth.clearSession()'))) {
    ok('过期会员令牌会在展示与请求前主动清理')
  } else {
    bad('过期会员令牌会在展示与请求前主动清理', '登录态或请求层仍可能复用过期 token')
  }
} catch (e) {
  bad('过期会员令牌会在展示与请求前主动清理', e.message)
}

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
  // 术语随终端对齐为「到机码」（kiosk 入口名为「到机码核销 · 不是取件码」）。
  // 这里只是定位锚点；真正守能力的是下面的 createPickupQrMatrix / PICKUP_CODE_RE /
  // 不得出现 scanTerminal / 不得调 `/pickup` 四条，未做任何放宽。
  pickupWxml.includes('二维码只包含本订单的 10 位到机码') &&
  pickupJs.includes("require('../../utils/pickup-qrcode')") &&
  pickupJs.includes('createPickupQrMatrix(this.data.codeRaw)') &&
  pickupQr.includes("PICKUP_CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/") &&
  pickupQr.includes('const HIGH_ECC_FORMAT_BITS = 2') &&
  !pickupWxml.includes('bindtap="scanTerminal"') &&
  !apiJs.includes('/pickup`')
) ok('取件页本地生成核销二维码并保留真实码兜底')
else bad('取件页扫码核销能力', '必须离线编码真实 10 位码，不得恢复手机反扫终端或不存在的详情接口')

if (
  pickupJs.includes('api.getCloudPrintOrder(this.data.orderId)') &&
  pickupJs.includes("pickupStatus === 'claimed'") &&
  pickupJs.includes("taskStatus === 'awaiting_payment'") &&
  pickupJs.includes("taskStatus === 'completed'") &&
  pickupJs.includes('showQr: false') &&
  pickupJs.includes('onShow()') &&
  pickupJs.includes('this._schedulePoll()') &&
  pickupWxml.includes('二维码已自动撤下')
) ok('取件页轮询真实订单状态并在扫码/终态撤码')
else bad('取件页实时状态', '缺少订单详情轮询、待支付/完成状态或二维码撤下')

if (
  pickupJs.includes('const fallbackAvailable = this.data.state === \'ready\'') &&
  pickupJs.includes('if (this.data.showQr) this._drawPickupQr()') &&
  pickupJs.includes('if (fallbackAvailable) this._resumeVisibleWork()')
) ok('取件页首次状态请求失败仍能绘制真实到机码二维码')
else bad('取件页首次请求失败二维码兜底', '回退为 ready 后必须重新绘码并恢复倒计时与轮询')

// ── 两个码不许再混名 ────────────────────────────────────────────
// 系统里有两个 10 位、同字符集但完全不同的码：
//   Code A「到机码」 Order.pickupCodeHash/Enc + pickupStatus —— 小程序下单时生成，
//                    到机核销后才付款出纸。后端错误文案（pickup-order.service.ts
//                    「到机码无效或已过期」）与小程序下单页都叫它到机码。
//   Code B「取件凭证码」Order.pickupCode —— 付款成功后才生成，向现场工作人员出示取纸，
//                    只在 Kiosk 侧（PrintDonePage / 我的·打印订单）展示。
// 小程序侧**只**持有 Code A，所以打印域这几个页面里不允许再出现「取件码」——
// 它既是 Code B 的名字，也是终端改名前的旧名字，混用会让用户在终端上找错按钮。
// 职业生活圈改版新增的页面同样只持有 Code A，一并纳入门禁：
//   order-detail  读 /me/print-orders/:id，取的是 pickupStatus==='pending' 时的 pickupCode；
//   package-code / store-select / home 说的都是同一条小程序下单动线上的那个码。
// 不纳入的话，改版把「取件码」从老页面赶出去、又从新页面放回来，门禁却是绿的。
const ARRIVAL_CODE_FILES = [
  'pages/print-pickup/print-pickup.wxml', 'pages/print-pickup/print-pickup.js',
  'pages/orders/orders.wxml', 'pages/orders/orders.js',
  'pages/print/print.js', 'pages/me/me.js', 'pages/ai/ai.js', 'pages/help/help.js',
  'pages/order-detail/order-detail.wxml', 'pages/order-detail/order-detail.js',
  'pages/package-code/package-code.wxml', 'pages/package-code/package-code.js',
  'pages/store-select/store-select.wxml', 'pages/home/home.wxml',
]
const staleCodeName = ARRIVAL_CODE_FILES.filter((f) => read(f).includes('取件码'))
// 跨端指引必须指到终端上真实存在的标签：Kiosk /print-scan 的卡片标题是「到机码核销」
// （apps/kiosk/src/pages/print-scan/PrintScanHomePage.tsx）。指引写别的名字，
// 用户到了机器前就找不到那个按钮。
// 只钉「必须出现终端真实卡片标题」，不钉整句话——否则指引连字都不能加。
const arrivalGuideOk =
  pickupWxml.includes('在终端') && pickupWxml.includes('「到机码核销」') &&
  read('pages/orders/orders.wxml').includes('到机码核销')
if (!staleCodeName.length && arrivalGuideOk) ok('到机码与取件凭证码不混名，且跨端指引对得上终端标签')
else bad('到机码命名一致性', staleCodeName.length
  ? `仍把到机码叫「取件码」：${staleCodeName.join(',')}`
  : '指向终端的指引未使用终端现有卡片标题「到机码核销」')

const printUploadJs = read('pages/print-upload/print-upload.js')
const printUploadWxml = read('pages/print-upload/print-upload.wxml')
const printStoreJs = read('pages/print-store/print-store.js')
const printStoreWxml = read('pages/print-store/print-store.wxml')
const printPayJs = read('pages/print-pay/print-pay.js')
const printPayWxml = read('pages/print-pay/print-pay.wxml')
const ordersJs = read('pages/orders/orders.js')
const ordersWxml = read('pages/orders/orders.wxml')
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

if (
  apiJs.includes('quoteMyPrintOrder(fileId, params)') &&
  apiJs.includes("/preview-url`") &&
  apiJs.includes("request('/orders/quote'") &&
  printUploadJs.includes('api.quoteMyPrintOrder') &&
  printUploadJs.includes('quote.billablePages') &&
  printUploadJs.includes('quote.amountCents') &&
  !printUploadJs.includes('pricing.estimateText') &&
  !/quoteMyPrintOrder\([\s\S]{0,500}\b(?:pages|billablePages|amountCents)\s*:/.test(printUploadJs)
) ok('打印参数页使用服务端真实页数与精确报价')
else bad('打印参数页服务端精确报价', '必须先取本人 printFileUrl 再调 /orders/quote，且不得提交或本地计算页数/金额')

const quoteRefreshMatch = printUploadJs.match(/_refreshQuote\(delay = 0\) \{([\s\S]*?)\n  \},\n\n  pickColor/)
const quoteRefreshBody = quoteRefreshMatch ? quoteRefreshMatch[1] : ''
const quoteSeqIndex = quoteRefreshBody.indexOf('const seq = ++this._quoteSeq')
const quoteLoadingIndex = quoteRefreshBody.indexOf("priceStatus: 'loading'")
const quoteDelayIndex = quoteRefreshBody.indexOf('setTimeout(run, delay)')
if (
  quoteSeqIndex >= 0 &&
  quoteLoadingIndex > quoteSeqIndex &&
  quoteDelayIndex > quoteLoadingIndex &&
  quoteRefreshBody.includes('if (seq !== this._quoteSeq) return')
) ok('打印份数变化立即作废旧报价并锁定继续操作')
else bad('打印报价竞态保护', '递增请求序号和 loading 状态必须发生在防抖等待之前，旧请求不得回写 ready')

if (
  printUploadJs.includes('amountCents=${encodeURIComponent(amountCents)}') &&
  printUploadWxml.includes("amountCents === 0 ? '免费试运营' : '精确报价'") &&
  printStoreJs.includes('isFreeOrder: hasAmount && amountCents === 0') &&
  printStoreJs.includes("q.amountCents === undefined ? '' : q.amountCents") &&
  printStoreWxml.includes("isFreeOrder ? '现场打印' : '机端支付'") &&
  printPayJs.includes("'files[0].price': isFreeOrder ? '免费' : total") &&
  printPayWxml.includes('免费试运营：到机核验后直接进入打印队列') &&
  pickupJs.includes("key: 'awaiting_release'") &&
  pickupJs.includes('parseAmountCents(order.amountCents) === 0') &&
  pickupWxml.includes('核销后无需付款，直接等待进入打印队列') &&
  ordersJs.includes("label: '正在进入队列'") &&
  ordersJs.includes('const amountCents = parseAmountCents(item.amountCents)') &&
  ordersJs.includes("amountCents=${encodeURIComponent(item.amountCents == null ? '' : item.amountCents)}")
) ok('免费试运营订单全流程不再误导用户现场支付')
else bad('免费试运营文案分流', '零元订单必须显示免费、现场打印和直接排队；付费订单仍保留机端支付')

if (
  ordersJs.includes("!item.status && item.pickupStatus === 'pending'") &&
  ordersJs.includes("'source=orders'") &&
  ordersWxml.includes('wx:if="{{item.pickup}}"') &&
  pickupJs.includes('err && err.statusCode === 401') &&
  pickupJs.includes('this._stopPoll()') &&
  pickupJs.includes('if (this.data.fromOrders)') &&
  pickupJs.includes("taskStatus === 'abandoned'")
) ok('扫码后撤下订单列表到机码且登录失效停止状态轮询')
else bad('到机码撤下与轮询停机', 'claimed/PrintTask 阶段不得继续展示旧码，401 后不得持续轮询')

const aiRecordsJs = read('pages/ai-records/ai-records.js')
const jobFitJs = read('pages/job-fit/job-fit.js')
const careerPlanJs = read('pages/career-plan/career-plan.js')
if (
  apiJs.includes('deleteMyAiRecord(recordId)') &&
  aiRecordsJs.includes("route: '/pages/resume-diagnose/resume-diagnose'") &&
  aiRecordsJs.includes("route: '/pages/resume-optimize/resume-optimize'") &&
  aiRecordsJs.includes("route: '/pages/job-fit/job-fit'") &&
  aiRecordsJs.includes("route: '/pages/career-plan/career-plan'") &&
  aiRecordsJs.includes('api.deleteMyAiRecord(record.id)') &&
  !aiRecordsJs.includes("key: 'interview'") &&
  jobFitJs.includes('historyTaskId') && jobFitJs.includes('api.getJobFit(this.data.taskId') &&
  careerPlanJs.includes('historyTaskId') && careerPlanJs.includes('api.getCareerPlan(this.data.taskId')
) ok('AI 服务记录支持真实结果回看与删除')
else bad('AI 服务记录闭环', '缺少真实类型筛选、已有结果页跳转、会员历史读取或删除入口')

if (
  jobFitJs.includes('taskId: historyTaskId') &&
  jobFitJs.includes('_openHistoryLogin()') &&
  jobFitJs.includes('this._waitingForHistoryLogin') &&
  jobFitJs.includes('onShow()') &&
  jobFitJs.includes('err && err.statusCode === 401') &&
  careerPlanJs.includes('this.setData({ taskId: historyTaskId, historyMode: true })') &&
  careerPlanJs.includes('_openHistoryLogin()') &&
  careerPlanJs.includes('this._waitingForHistoryLogin') &&
  careerPlanJs.includes('onShow()') &&
  careerPlanJs.includes('err && err.statusCode === 401')
) ok('AI 历史模式登录失效时保留任务并在登录后自动恢复')
else bad('AI 历史模式登录失效保护', '岗位匹配和职业规划不得用空 taskId 重试，登录返回后必须自动读取原任务')

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
