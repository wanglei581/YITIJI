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
import { execSync } from 'node:child_process'
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
  // tools/ 放需要本机开发者工具才能跑的东西（devtools-probe.mjs）。
  // 为什么不放 scripts/：verify-ci-gate-coverage.mjs 按**路径**枚举门禁脚本
  // （apps/*/scripts/*.mjs），不看文件名——放进去会被算成「未接线门禁」把 CI 打红。
  // 已同步加进 project.config.json 的 packOptions.ignore，不进小程序包。
  'tools',
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

// 上面那条查不到「路由存在表里、跳转时拼出来」的写法——它把含 ${} 的动态目标
// 整个过滤掉了。ai-records 正是这种：`${record.route}?taskId=...`，
// 于是 KIND_META 里的 route 字面量从来没被校验过，2026-09-02 就因此漏过一次
// 「页面已存在但表里是空字符串」。这里把这类路由表单独捞出来查。
{
  const aiRecordsJs = read('pages/ai-records/ai-records.js')
  const routes = [...aiRecordsJs.matchAll(/route:\s*'([^']*)'/g)].map((m) => m[1]).filter(Boolean)
  const dead = routes
    .map((t) => t.replace(/^\//, '').replace(/\/$/, ''))
    .filter((t) => !pagePathSet.has(t))
  if (routes.length === 0) {
    bad('AI 记录路由表已注册', 'ai-records.js 里取不到任何 route 字面量——抽取失效，不要当作通过')
  } else if (dead.length) {
    bad('AI 记录路由表已注册', `指向未注册页面: ${[...new Set(dead)].join(',')}`)
  } else {
    ok(`AI 记录路由表全部已注册（${routes.length} 条）`)
  }
}

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
const resumeDiagnoseWxml = read('pages/resume-diagnose/resume-diagnose.wxml')
const resumeDiagnoseJs = read('pages/resume-diagnose/resume-diagnose.js')
const resumeOptimizeWxml = read('pages/resume-optimize/resume-optimize.wxml')
const resumeOptimizeJs = read('pages/resume-optimize/resume-optimize.js')
const resumeParseJs = read('pages/resume-parse/resume-parse.js')
const resumesJs = read('pages/resumes/resumes.js')
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

const uploadFileIdx = requestJs.indexOf('function uploadFile(')
const uploadFileSource = uploadFileIdx >= 0 ? requestJs.slice(uploadFileIdx) : ''
if (
  requestJs.includes('function silentResignin()') &&
  /function uploadFile\s*\(/.test(requestJs) &&
  uploadFileSource.includes('silentResignin()') &&
  /statusCode === 401[\s\S]*extractError\(body,\s*401\)/.test(uploadFileSource) &&
  !requestJs.includes("reject(makeError('登录已失效,请重新登录', 401))")
) ok('uploadFile 401 走 silentResignin 且保留 error.code')
else bad('uploadFile 401 静默补签', '必须复用 silentResignin、401 走 extractError(body, 401)，不得用丢掉 code 的 makeError')

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

if (
  resumeDiagnoseWxml.includes('report.issues') &&
  resumeDiagnoseWxml.includes('report.contentBlocks') &&
  resumeDiagnoseWxml.includes('这不是录取分') &&
  resumeDiagnoseWxml.includes('report.truncatedInput') &&
  resumeDiagnoseWxml.includes('打印原件') &&
  resumeDiagnoseJs.includes('viewJobs()')
) ok('简历诊断页展示问题证据、内容块、截断提示与非 AI 失败出口')
else bad('简历诊断结果层', '必须引用 issues/contentBlocks，说明非录取分，展示截断提示，并保留打印原件/去打印/查看岗位出口')

if (
  resumeParseJs.includes('selectedDimensions') &&
  resumeParseJs.includes('targetContext') &&
  resumeParseJs.includes("{ skipped: true }") &&
  resumeParseJs.includes('api.parseResume(payload)')
) ok('简历解析透传诊断维度与目标方向，并允许通用诊断')
else bad('简历解析方向透传', '必须从 URL 读取 selectedDimensions/targetContext 并传给 parseResume，未指定时显式 skipped')

if (
  resumeOptimizeJs.includes('api.exportGeneratedResume') &&
  resumeOptimizeJs.includes('wx.openDocument') &&
  resumeOptimizeJs.includes('printFileUrl') &&
  resumeOptimizeJs.includes("key: 'pdf'") &&
  resumeOptimizeJs.includes("key: 'docx'") &&
  resumeOptimizeJs.includes("key: 'txt'") &&
  resumeOptimizeJs.includes("key: 'md'") &&
  resumeOptimizeWxml.includes('exportResult.pageLabel') &&
  resumeOptimizeWxml.includes('exportResult.sizeLabel') &&
  resumeOptimizeWxml.includes('exportResult.expiresLabel') &&
  resumeOptimizeWxml.includes('aria-disabled') &&
  resumeOptimizeWxml.includes('exportDisabledReason') &&
  resumeOptimizeJs.includes('服务端没有返回结构化优化稿')
) ok('简历优化页接真实四格式导出、PDF 打开、打印副本与文件元数据')
else bad('简历优化导出结果层', '必须接 exportGeneratedResume，打开真实 PDF，展示四格式/页数/大小/有效期，并在不可导出时 aria-disabled')

const diagnoseSaveState = resumeDiagnoseWxml.match(
  /wx:if="\{\{exportResult\.savedToDocuments\}\}"[^>]*>([^<]*)<\/view>\s*<view wx:else[^>]*>([^<]*)<\/view>/,
)
const anonymousSaveCopy = diagnoseSaveState ? diagnoseSaveState[2] : ''
if (
  apiJs.includes('exportResumeReport(taskId, kind, accessToken, benefitGrantId)') &&
  apiJs.includes('getResumeExportPricing()') &&
  resumeDiagnoseWxml.includes('data-kind="diagnosis_report"') &&
  resumeDiagnoseWxml.includes('data-kind="change_list"') &&
  resumeDiagnoseWxml.includes("status !== 'done'") &&
  resumeDiagnoseWxml.includes('诊断失败或尚未完成，暂时不能导出') &&
  (resumeDiagnoseWxml.match(/aria-disabled="\{\{true\}\}"/g) || []).length >= 2 &&
  resumeDiagnoseJs.includes('api.exportResumeReport(this.data.taskId, kind, accessToken, this.data.benefitGrantId)') &&
  resumeDiagnoseJs.includes('wx.downloadFile') &&
  resumeDiagnoseJs.includes('wx.openDocument') &&
  resumeDiagnoseJs.includes('result.signedUrl') &&
  resumeDiagnoseJs.includes('result.printFileUrl') &&
  resumeDiagnoseWxml.includes('exportResult.pageLabel') &&
  resumeDiagnoseWxml.includes('exportResult.sizeLabel') &&
  resumeDiagnoseWxml.includes('exportResult.expiresLabel') &&
  resumeDiagnoseJs.includes('setInterval(tick, 1000)') &&
  resumeDiagnoseWxml.includes('wx:if="{{exportExpired}}"') &&
  diagnoseSaveState &&
  diagnoseSaveState[1].includes('已存入我的文档') &&
  anonymousSaveCopy.includes('本次仅可打开，登录后可存我的文档') &&
  !anonymousSaveCopy.includes('已存')
) ok('诊断报告与修改清单可真实导出、打开、打印，并按登录态和有效期诚实展示')
else bad('诊断报告导出结果层', '必须有两种导出动作、真实 PDF 打开/打印、页数/大小/有效期倒计时，且 savedToDocuments=false 分支不得出现「已存」')

const normalizeJs = read('utils/normalize.js')
const pricingCopyOk =
  normalizeJs.includes('当前免费，不扣权益') &&
  normalizeJs.includes('可用权益 ${count} 次') &&
  normalizeJs.includes('简历导出当前不可用（价目已停用，不是免费）')
const unavailableFailClosed = [resumeDiagnoseJs, resumeOptimizeJs].every((source) =>
  source.includes("pricing: { mode: 'unavailable'") &&
  source.includes('else if (this.data.pricing.disabledReason) reason = this.data.pricing.disabledReason') &&
  source.includes("else if (this.data.pricing.mode === 'charged' && !this.data.benefitGrantId)"),
)
const pricingButtonsDisabled =
  resumeDiagnoseWxml.includes('disabled="{{exportDisabled || !!exportingKind}}"') &&
  resumeOptimizeWxml.includes('disabled="{{exporting || exportDisabled}}"')
if (pricingCopyOk && unavailableFailClosed && pricingButtonsDisabled) {
  ok('简历导出价格三态展示，charged 无权益及 unavailable 均 fail-closed')
} else {
  bad('简历导出价格三态', '必须展示免费/收费/停用三态；charged 无权益和 unavailable 时按钮必须 aria-disabled')
}

if (!/format\s*:\s*['"]PDF['"]/.test(resumesJs) && resumesJs.includes('仅记录，未导出文件')) {
  ok('我的简历不再把 AI 记录硬编码成 PDF 文件')
} else {
  bad('我的简历文件真实性', '禁止 format: PDF 硬编码；没有真实 MIME 时必须写「仅记录，未导出文件」')
}

const pickupWxml = read('pages/print-pickup/print-pickup.wxml')
const pickupJs = read('pages/print-pickup/print-pickup.js')
const pickupQr = read('utils/pickup-qrcode.js')
if (
  pickupWxml.includes('type="2d"') &&
  pickupWxml.includes('请将此二维码对准一体机扫码器') &&
  // 术语随终端对齐为「到机码」（kiosk 入口名为「到机码核销 · 不是取件码」）。
  // 这里只是定位锚点；真正守能力的是下面的 createPickupQrMatrix / PICKUP_CODE_RE /
  // 不得出现 scanTerminal / 不得调 `/pickup` 四条，未做任何放宽。
  pickupWxml.includes('二维码只包含本订单的到机码') &&
  pickupJs.includes("require('../../utils/pickup-qrcode')") &&
  // R9 收紧：码必须在**进入异步之前**被钉进局部变量，再拿它去编码。
  // 原锚点钉的是 `createPickupQrMatrix(this.data.codeRaw)` —— 那等于要求在 exec 之前
  // 现读一次 data，而 exec 的回调跨帧才回来，回来时那张码可能已经被换掉或撤下。
  pickupJs.includes('const code = this.data.codeRaw') &&
  pickupJs.includes('createPickupQrMatrix(code)') &&
  pickupQr.includes('LEGACY_PICKUP_CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/') &&
  pickupQr.includes('CURRENT_PICKUP_CODE_RE = /^[0-9]{8}$/') &&
  pickupQr.includes('PICKUP_CODE_RE = /^(?:[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}|[0-9]{8})$/') &&
  pickupQr.includes('const HIGH_ECC_FORMAT_BITS = 2') &&
  !pickupWxml.includes('bindtap="scanTerminal"') &&
  !apiJs.includes('/pickup`')
) ok('取件页本地生成核销二维码并保留真实码兜底')
else bad('取件页扫码核销能力', '必须离线编码真实到机码（同时认 10 位旧码与 8 位新码），不得恢复手机反扫终端或不存在的详情接口')

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

// 2026-09-15：兜底的**来源**变了。以前首次请求失败可以退回 URL 里的到机码离线绘码；
// 现在 URL 不再携带任何凭证（到机码进 URL = 一条构造出来的链接就能在别人手机上渲染出
// 带码的取件页），于是唯一合法的兜底只剩「上一次真的从服务端取到的状态」。
// 能力没丢：后续失败仍保留已显示内容、重新绘码、恢复倒计时与轮询；
// 首次就失败时诚实进错误态 —— 本来也没有任何可保留的东西。
if (
  pickupJs.includes('const fallbackAvailable = this.data.state === \'ready\'') &&
  pickupJs.includes('if (this.data.showQr) this._drawPickupQr()') &&
  pickupJs.includes('this._resumeVisibleWork()') &&
  // 正面禁令：不许任何一条路径再从 URL 取码兜底。
  !/q\.pickupCode\b/.test(pickupJs) &&
  !/codeRaw: PICKUP_CODE_RE\.test\(pickupCode\)/.test(pickupJs)
) ok('取件页失败兜底只保留服务端取到的状态，不再退回 URL 里的码')
else bad('取件页失败兜底', '后续失败须保留已显示状态并重新绘码；且任何路径都不得从 URL 取到机码兜底')

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
const orderDetailJs = read('pages/order-detail/order-detail.js')
const orderDetailWxml = read('pages/order-detail/order-detail.wxml')
if (
  documentsJs.includes('api.uploadPrintFile') &&
  printUploadJs.includes('api.createPrintPiiScan') &&
  printUploadJs.includes("privacyStatus !== 'ready'") &&
  printPayJs.includes('api.createCloudPrintOrder') &&
  /request\(\s*'\/me\/print-orders',\s*\{[\s\S]{0,400}method: 'POST'/.test(apiJs) &&
  // 服务端（member-print-orders.controller.ts）从 **Header** 取幂等键，缺了直接 400。
  // 放 body 里服务端读不到，而 CreateMemberPrintOrderDto 又会判成非法参数。
  /header: \{ 'idempotency-key': idempotencyKey \}/.test(apiJs) &&
  !/data: \{[\s\S]{0,200}idempotencyKey/.test(apiJs) &&
  !/createCloudPrintOrder\(\{[\s\S]{0,500}\b(?:amountCents|billablePages|pages)\s*:/.test(printPayJs) &&
  !printPayJs.includes('预提交接口尚未开通')
) ok('文档真实上传、隐私确认且由服务端建单计价')
else bad('文档上传与服务端计价闭环', '缺少真实上传、PII 确认、Order-only 建单，或仍由小程序提交金额/页数')

if (
  apiJs.includes('quoteMyPrintOrder(fileId, params, presetFileUrl)') &&
  apiJs.includes("/preview-url`") &&
  apiJs.includes("request('/orders/quote'") &&
  printUploadJs.includes('api.quoteMyPrintOrder') &&
  printUploadJs.includes('quote.billablePages') &&
  printUploadJs.includes('quote.amountCents') &&
  !printUploadJs.includes('pricing.estimateText') &&
  !/quoteMyPrintOrder\([\s\S]{0,500}\b(?:pages|billablePages|amountCents)\s*:/.test(printUploadJs)
) ok('打印参数页使用服务端真实页数与精确报价')
else bad('打印参数页服务端精确报价', '必须先取本人 printFileUrl 再调 /orders/quote，且不得提交或本地计算页数/金额')

// 注册的页面必须**在 git 里**有四件套，不只是在磁盘上有。
//
// 上面所有目录/四件套检查都按磁盘判定。这在本地永远是对的，但挡不住一类事故：
// 用限定范围的 `git add` 提交了 app.json 的页面注册，而实现文件还是未跟踪状态。
// 本地跑门禁全绿（文件就在磁盘上），干净检出却直接红——2026-09-02 的
// ec552bb8 就是这样：app.json 注册了 pages/resume-build、ai-records 也指向它，
// 而 git ls-files 该目录 0 个文件。
//
// 用 git ls-files 复核一遍。拿不到 git（打包产物、非仓库环境）就跳过并说明，
// 不把「查不了」当成「查过了」。
{
  let tracked = null
  try {
    tracked = new Set(
      execSync('git ls-files apps/miniapp/pages', { cwd: path.join(ROOT, '..', '..'), encoding: 'utf8' })
        .split('\n').filter(Boolean)
        .map((f) => f.replace(/^apps\/miniapp\//, '')),
    )
  } catch (_) {
    tracked = null
  }
  if (tracked === null) {
    ok('注册页面四件套已入库（跳过：当前环境取不到 git）')
  } else {
    const missing = []
    for (const page of PAGE_PATHS) {
      for (const ext of ['js', 'wxml', 'wxss', 'json']) {
        if (!tracked.has(`${page}.${ext}`)) missing.push(`${page}.${ext}`)
      }
    }
    if (missing.length) {
      bad('注册页面四件套已入库', `已在 app.json 注册但 git 里没有：${[...new Set(missing)].slice(0, 8).join(', ')}` +
        `${missing.length > 8 ? ` 等 ${missing.length} 项` : ''}——干净检出会红`)
    } else {
      ok(`注册页面四件套已入库（${PAGE_PATHS.length} 页 × 4 文件）`)
    }
  }
}

// 报价参数与下单参数必须锁在一起。
//
// print-upload 的 verifiedPrintParams()（报价用）和 print-pay 的
// createCloudPrintOrder()（下单用）各自硬编码了 colorMode / duplex。
// 今天两边都是 black_white / simplex，与 print-upload 页上「彩色与双面本期不可选」
// 的锁定一致，所以没有问题。
//
// 但这是个潜伏陷阱：哪天驱动侧彩色通过真机验收、有人在 print-upload 解锁了选项，
// 却忘了改 print-pay 的硬编码，用户就会看到「彩色·双面」而实际下单黑白单面——
// 展示与实付不一致。那是钱和纸的事，不是文案问题。
//
// 所以这里把两处钉在一起：值必须逐字相等，改一边不改另一边即转红。
{
  const grab = (src, label) => {
    const color = /colorMode:\s*'([a-z_]+)'/.exec(src)
    const duplex = /duplex:\s*'([a-z]+)'/.exec(src)
    return { label, color: color && color[1], duplex: duplex && duplex[1] }
  }
  const quote = grab(printUploadJs, 'print-upload/verifiedPrintParams')
  // print-pay 把两个值收成了模块常量，报价与建单都引用它 —— 页内分叉在结构上已经不可能。
  // 所以这里读常量声明，并额外钉住"两条链都只许引用常量、不许再写死第二份字面量"，
  // 否则本断言会退化成"只要文件里有过这个字符串就算数"。
  const order = {
    label: 'print-pay/ORDER_COLOR_MODE+ORDER_DUPLEX',
    color: (/const ORDER_COLOR_MODE = '([a-z_]+)'/.exec(printPayJs) || [])[1],
    duplex: (/const ORDER_DUPLEX = '([a-z]+)'/.exec(printPayJs) || [])[1],
  }
  {
    const bare = stripComments(printPayJs)
    const payloadBody = methodBody(bare, '_orderPayload')
    const quoteBody = bare.slice(bare.indexOf('function quoteParams('), bare.indexOf('function colorLabelOf('))
    const usesConst = (body) => body.includes('colorMode: ORDER_COLOR_MODE') && body.includes('duplex: ORDER_DUPLEX')
    if (!usesConst(payloadBody)) bad('建单参数同源', '_orderPayload 没有引用 ORDER_COLOR_MODE / ORDER_DUPLEX')
    else if (!usesConst(quoteBody)) bad('报价参数同源', 'quoteParams 没有引用 ORDER_COLOR_MODE / ORDER_DUPLEX')
    else if (/colorMode: '[a-z_]+'/.test(bare)) bad('建单参数同源', 'print-pay 又出现写死的 colorMode 字面量，页内会再分叉')
    else ok('print-pay 报价与建单共用同两个常量，页内不可能分叉')
  }
  if (!quote.color || !quote.duplex || !order.color || !order.duplex) {
    bad('报价与下单打印参数一致', '取不到 colorMode / duplex 字面量——抽取失效，不要当作通过')
  } else if (quote.color !== order.color || quote.duplex !== order.duplex) {
    bad('报价与下单打印参数一致',
      `报价用 ${quote.color}/${quote.duplex}，下单用 ${order.color}/${order.duplex}——` +
      '用户看到的和实际下单的不是一回事，必须两处同改')
  } else {
    ok(`报价与下单打印参数一致（${quote.color} / ${quote.duplex}）`)
  }
}

// MP-07：支付页不得按 query 渲染彩色/双面。标签必须跟建单字面量走。
{
  const guessesQuery = /q\.color\s*===\s*'color'/.test(printPayJs)
    || /q\.duplex\s*===\s*'double'/.test(printPayJs)
  const labelsFromCreate = /const ORDER_COLOR_MODE = 'black_white'/.test(printPayJs)
    && /const ORDER_DUPLEX = 'simplex'/.test(printPayJs)
    && /colorLabel: colorLabelOf\(ORDER_COLOR_MODE\)/.test(printPayJs)
    && /duplexLabel: duplexLabelOf\(ORDER_DUPLEX\)/.test(printPayJs)
    && printPayJs.includes('colorLabel')
    && printPayJs.includes('duplexLabel')
    && printPayWxml.includes('{{colorLabel}}')
    && printPayWxml.includes('{{duplexLabel}}')
  if (guessesQuery) {
    bad('支付页打印标签不从 query 猜测', 'print-pay 仍按 query 渲染彩色/双面，会与建单 black_white/simplex 分叉')
  } else if (!labelsFromCreate) {
    bad('支付页打印标签与建单参数同源', '标签必须来自建单真实参数（colorLabel/duplexLabel），且建单仍是 black_white/simplex')
  } else {
    ok('支付页彩色/双面标签与建单参数同源')
  }
}

// MP-05：云打印 unpaid+pending 可取消；材料包取消端点仍 knownMissing，页面不得调用。
{
  const listWired = ordersJs.includes('api.cancelCloudPrintOrder')
    && ordersJs.includes("payStatus === 'unpaid'")
    && ordersJs.includes("pickupStatus === 'pending'")
    && ordersJs.includes('toUiItem(raw)')
    && ordersWxml.includes('取消订单')
    && ordersWxml.includes('item.canCancel')
  const detailWired = orderDetailJs.includes('api.cancelCloudPrintOrder')
    && orderDetailJs.includes("payStatus === 'unpaid'")
    && orderDetailJs.includes("pickupStatus === 'pending'")
    && orderDetailJs.includes('toDetail(raw)')
    && orderDetailWxml.includes('取消订单')
    && orderDetailWxml.includes('detail.canCancel')
  const packageLeftClosed = !ordersJs.includes('cancelPackageOrder')
    && !orderDetailJs.includes('cancelPackageOrder')
  if (listWired && detailWired && packageLeftClosed) {
    ok('云打印未付款待到机订单可取消，材料包取消未接线')
  } else {
    bad('云打印未付款订单取消入口',
      `list=${listWired} detail=${detailWired} packageClosed=${packageLeftClosed}`)
  }
}

// presetFileUrl 旁路：共享派生文件(endUserId 为 null)拿 fileId 去 preview-url 必吃 403；
// 简历非 PDF 导出则需要把服务端同步生成的同内容 PDF 副本交给打印链路。
// 这条旁路把「本人」的证明点从 preview-url 的归属校验挪到了上游端点自己的资格校验 +
// HMAC 签名上，所以必须钉死两件事：URL 只能来自服务端响应，且只有明确审计过的页面可以用。
{
  const PRESET_ALLOWED = ['fair-materials', 'fair-company-detail', 'resume-optimize', 'resume-diagnose']
  const offenders = []
  for (const full of physicalPageDirs) {
    const dir = full.replace(/^pages\//, '')   // physicalPageDirs 已带 pages/ 前缀
    const js = read(`${full}/${dir}.js`)
    if (!js.includes('printFileUrl=')) continue
    if (!PRESET_ALLOWED.includes(dir)) { offenders.push(`${dir}：不在旁路白名单内`); continue }
    // 必须是从服务端响应里取的，不许自己拼。resume-optimize 还必须来自
    // exportGeneratedResume 响应，并解析出签名 URL 自带的 PDF fileId。
    if (!/res\s*&&\s*res\.printFileUrl|res\.printFileUrl|result\.printFileUrl/.test(js)) {
      offenders.push(`${dir}：printFileUrl 不是取自服务端响应`)
    }
    if (dir === 'resume-optimize' && (
      !js.includes('api.exportGeneratedResume') ||
      !js.includes('fileIdFromPrintUrl(res.printFileUrl)') ||
      !js.includes('fileUrls.absoluteUrl(res.printFileUrl)')
    )) offenders.push(`${dir}：未锁定为导出响应里的同内容 PDF 副本`)
    if (dir === 'resume-diagnose' && (
      !js.includes('api.exportResumeReport') ||
      !js.includes('result.printFileUrl') ||
      !js.includes('result.signedUrl')
    )) offenders.push(`${dir}：未锁定为报告导出响应，或混淆打开与打印签名`)
  }
  if (offenders.length === 0) ok('打印 printFileUrl 旁路仅限共享派生文件且只取自服务端响应')
  else bad('打印 printFileUrl 旁路受控', offenders.join('；'))
}

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
  printStoreWxml.includes("isFreeOrder ? '现场打印' : '机端支付'") &&
  // 2026-09-15（第二轮）：支付页的免费判定同样改为**只**来自服务端。
  // 此前这里要求 print-store 把 amountCents 透传进 print-pay 的 URL，而它与文件名
  // 走的是同一条 URL —— 求职材料的文件名里常写着本人姓名，金额是本人订单状态，
  // 两者都不该由调用方"告诉"下一页。能力没丢：print-pay 现在自己调 /orders/quote
  // 拿真值，下面那条 `const isFreeOrder = amountCents === 0` 就是同一个判据的新落点。
  printPayJs.includes('api.quoteMyPrintOrder(') &&
  printPayJs.includes('const isFreeOrder = amountCents === 0') &&
  printPayJs.includes("const total = isFreeOrder ? '免费' : formatYuan(amountCents)") &&
  printPayJs.includes("'files[0].price': total") &&
  // 负面锚：这四项一个都不许再进 print-store → print-pay 的 URL。
  !/print-pay\?[^`'"]*\b(?:amountCents|total|name|pickupCode|expiresAt)=/.test(printStoreJs) &&
  printPayWxml.includes('免费试运营：到机核验后直接进入打印队列') &&
  pickupJs.includes("key: 'awaiting_release'") &&
  pickupJs.includes('parseAmountCents(order.amountCents) === 0') &&
  pickupWxml.includes('核销后无需付款，直接等待进入打印队列') &&
  ordersJs.includes("label: '正在进入队列'") &&
  ordersJs.includes('const amountCents = parseAmountCents(item.amountCents)') &&
  // 2026-09-15：取件页的免费判定改为**只**来自服务端金额。此前这里要求 orders.js
  // 把 item.amountCents 拼进取件页 URL —— 金额是本人订单状态，不该由调用方"告诉"下一页，
  // 而且那条 URL 同时还带着到机码明文。能力没丢：pickupJs 那条
  // `parseAmountCents(order.amountCents) === 0` 仍在，判据从服务端响应里取。
  !/amountCents=\$\{encodeURIComponent\(item\.amountCents/.test(ordersJs)
) ok('免费试运营订单全流程不再误导用户现场支付（免费判定取自服务端金额）')
else bad('免费试运营文案分流', '零元订单必须显示免费、现场打印和直接排队；付费订单仍保留机端支付')

// 2026-09-15：`source=orders` 现在拼在模板串里（URL 只剩 orderId + source），
// 所以锚点从带引号的字面量改成 `source=orders` 本身；401 分支从只停轮询
// 收紧成停全部定时器 **并清掉屏幕上的码**（登录已失效还留着码，就是共用设备上的泄漏）。
if (
  ordersJs.includes("!item.status && item.pickupStatus === 'pending'") &&
  ordersJs.includes('source=orders') &&
  ordersWxml.includes('wx:if="{{item.pickup}}"') &&
  pickupJs.includes('err && err.statusCode === 401') &&
  pickupJs.includes('this._stopTimers()') &&
  // 401 分支必须**调用清场**，而清场函数必须真的把码清零。两头都钉：
  // 只钉调用点，helper 被掏空也绿；只钉 helper，401 不调它也绿。
  /statusCode === 401[\s\S]{0,400}this\._clearCredentials\(\)/.test(pickupJs) &&
  /_clearCredentials\(\)\s*\{[\s\S]{0,400}codeRaw: ''/.test(pickupJs) &&
  pickupJs.includes('if (this.data.fromOrders)') &&
  pickupJs.includes("taskStatus === 'abandoned'")
) ok('扫码后撤下订单列表到机码；登录失效停止轮询并清掉已显示的码')
else bad('到机码撤下与轮询停机', 'claimed/PrintTask 阶段不得继续展示旧码，401 后不得持续轮询，且须清掉屏幕上的码')

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
  aiRecordsJs.includes("key: 'interview'") &&
  aiRecordsJs.includes('getMyMockInterviews') &&
  aiRecordsJs.includes('deleteMyMockInterview') &&
  apiJs.includes('getMyMockInterviews') &&
  apiJs.includes('/me/mock-interviews') &&
  jobFitJs.includes('historyTaskId') && jobFitJs.includes('api.getJobFit(this.data.taskId') &&
  careerPlanJs.includes('historyTaskId') && careerPlanJs.includes('api.getCareerPlan(this.data.taskId')
) ok('AI 服务记录支持真实结果回看与删除，模拟面试分区来自 /me/mock-interviews')
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

if (
  /const PRODUCTION_BASE_URL = 'https:\/\/zyidai\.cn'/.test(configJs) &&
  /const TEST_BASE_URL =/.test(configJs) &&
  configJs.includes('wx.getAccountInfoSync') &&
  /envVersion === 'develop'/.test(configJs) &&
  /envVersion === 'trial'/.test(configJs) &&
  /baseUrl:\s*resolveBaseUrl\(\)/.test(configJs) &&
  /return PRODUCTION_BASE_URL/.test(configJs) &&
  !/envVersion === 'release'[\s\S]{0,120}TEST_BASE_URL/.test(configJs)
) ok('baseUrl 按 miniProgram.envVersion 选择，正式版固定生产域名')
else bad('baseUrl 环境分流', 'develop/trial 可配测试域名，release 必须固定 https://zyidai.cn')

const secretPatterns = [/sk-[A-Za-z0-9]{12,}/, /AKID[A-Za-z0-9]{10,}/, /AI_LLM_API_KEY\s*[:=]/, /DATABASE_URL\s*[:=]/]
let secretHit = false
for (const f of textFiles) {
  if (f.startsWith('./scripts/verify-miniapp-static.mjs')) continue
  const src = read(f)
  if (secretPatterns.some((re) => re.test(src))) { bad('密钥残留', f); secretHit = true }
}
if (!secretHit) ok('无密钥残留')

/**
 * 去掉块注释与整行注释再做「不得出现 X」的静态断言。
 * 不剥注释的话，说明为什么删掉某个假值的注释本身会被判成违规 ——
 * 抓的是解释文字，不是真实代码。写法与 services/api/scripts/verify-job-requirement-stats.ts 一致。
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n')
}

/**
 * 从 `openIdx`（必须落在一个 `{` 或 `(` 上）起取一段**配对闭合**的源码。
 *
 * 存在的理由：本文件此前大量使用「从这里往后数 N 个字符」的定长窗口。它有两种失败
 * 方向，而且都真实发生过 —— 窗口开太小会漏掉本该抓到的代码（于是变异删掉守卫仍然
 * 全绿），窗口开太大会把紧随其后的另一个函数一起抓进来（于是断言在错的函数体上成立）。
 * 配对闭合没有这个自由度。
 */
function balancedFrom(src, openIdx) {
  const open = src[openIdx]
  const close = open === '{' ? '}' : ')'
  let depth = 0
  for (let i = openIdx; i < src.length; i += 1) {
    const ch = src[i]
    if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) return src.slice(openIdx, i + 1)
    }
  }
  return ''
}

/**
 * 取一个具名方法的完整函数体（`name(...) {` 之后那对大括号）。
 *
 * 必须锚在**行首**：`\b_refreshOrder\s*\(` 会先命中 onLoad 里那句
 * `this._refreshOrder(true)` 调用，然后从它后面找第一个 `{` —— 抓到的是下一个方法。
 */
function methodBody(src, name) {
  const head = new RegExp(`^\\s*${name}\\s*\\(`, 'm').exec(src)
  if (!head) return ''
  const brace = src.indexOf('{', head.index + head[0].length)
  return brace < 0 ? '' : balancedFrom(src, brace)
}

/** 取某个调用的完整实参段（含外层圆括号），例如 `wx.redirectTo(...)`。 */
function callArgs(src, callee) {
  const idx = src.indexOf(callee)
  if (idx < 0) return ''
  return balancedFrom(src, idx + callee.length - 1)
}

/** 取一段源码里第 n 个 `.then(` / `.catch(` 回调的函数体。 */
function promiseCallbackBodies(src, kind) {
  const bodies = []
  const needle = `.${kind}(`
  let from = 0
  for (;;) {
    const idx = src.indexOf(needle, from)
    if (idx < 0) break
    from = idx + needle.length
    const brace = src.indexOf('{', idx)
    if (brace < 0) break
    const body = balancedFrom(src, brace)
    if (body) bodies.push(body)
  }
  return bodies
}

// ---- 材料包侧链：运行期 fail-closed（取代 2026-09-08 的硬编码守卫）----
//
// 这四页曾在 onLoad 首行无条件 `guardPackageChain()` 弹窗 + reLaunch。当时是对的：
// 材料包下完单**没有任何界面能再给出 orderId**，用户手上只剩一个到机码，而到机码不能
// 反查订单 —— 那条链的最后一步在代码层根本不存在。
//
// 缺的那一块已经补上：服务端 `GET /orders/package` 提供本人材料包订单列表，小程序
// 「打印订单」页接入它并可只带 orderId 重新进入到机码页。于是硬关闭的理由消失，
// 关闭方式换成运行期 fail-closed（服务端错误码）。
//
// 本段断言的是「为什么该这样」，不是照现状抄：
//   ① 硬编码守卫必须**真的没了** —— 连模块文件都不许留着等人 require 回来；
//   ② 关闭能力的判据必须落在服务端错误码上，页面要有可执行的恢复动作；
//   ③ 找回路径必须存在且只走 orderId（凭证不进 URL）；
//   ④ 全链不得出现在线支付：材料包是到机器现场付款，wx.requestPayment 一出现
//      就意味着有人在小程序里扣款，而这条链没有任何支付闭环。
const PACKAGE_CHAIN_PAGES = [
  'pages/package-create/package-create',
  'pages/store-select/store-select',
  'pages/package-confirm/package-confirm',
  'pages/package-code/package-code',
]

{
  const guardMisses = []
  if (fs.existsSync(path.join(ROOT, 'utils/package-feature.js'))) {
    guardMisses.push('utils/package-feature.js 仍然存在（硬编码 fail-closed 模块必须删除，留着就会被 require 回来）')
  }
  for (const page of PACKAGE_CHAIN_PAGES) {
    // 先剥注释：抓的是真实代码，不是「说明当初为什么有这个守卫」的那几行注释
    // （本门禁同族的 PACKAGE_FAKE_DATA 早就是这么做的，这里沿用同一判据）。
    const src = stripComments(read(`${page}.js`))
    if (src.includes('package-feature')) guardMisses.push(`${page}.js 仍引用 package-feature`)
    if (src.includes('guardPackageChain')) guardMisses.push(`${page}.js 仍调用 guardPackageChain`)
  }
  if (!guardMisses.length) ok(`材料包四页已移除硬编码 fail-closed 守卫（${PACKAGE_CHAIN_PAGES.length} 页）`)
  else bad('材料包硬编码守卫已移除', guardMisses.join('；'))
}

// 找回路径：列表端点接入 + 从本人订单只带 orderId 重新进入。
// 这是整条链能开放的前提条件，缺任何一环都必须红。
{
  const misses = []
  if (!/getPackageOrders\(\{\s*cursor,\s*pageSize\s*\}\s*=\s*\{\}\)/.test(apiJs)) misses.push('api.js 缺 getPackageOrders({cursor,pageSize})')
  if (!/request\('\/orders\/package',\s*\{\s*method:\s*'GET',\s*data,\s*needAuth:\s*true\s*\}\)/.test(apiJs)) misses.push("getPackageOrders 未以 GET + needAuth:true 调 /orders/package")
  if (!ordersJs.includes('api.getPackageOrders(')) misses.push('orders.js 未接入材料包列表')
  if (!ordersWxml.includes('bindtap="openPackage"')) misses.push('orders.wxml 没有进入材料包到机码页的入口')
  if (!ordersJs.includes('/pages/package-code/package-code?orderId=')) misses.push('orders.js 进入到机码页时未使用 orderId')
  if (!misses.length) ok('材料包订单可从本人打印订单列表找回并重新查看到机码')
  else bad('材料包订单找回路径', misses.join('；'))
}

// R4 收口 ①：取件页身份判定必须是四态，不能压成布尔。
//
// 压成布尔就是本轮修掉的那个缺陷的成因：未登录 / 无会员 id / JWT 过期 / 换了人
// 全都落到「与快照一致 → 不算换人 → 返回 false → 直接 return」，而 state 原地停在
// 'loading' —— 一页永远转不完的「正在读取订单实时状态…」，既没有请求在跑也没有出口。
// 其中「JWT 过期但仍有补签资格」那一种本来能自己修好：enduser JWT 只签 30 分钟，
// request.js 拿到 401 会静默续签一次再重发，页面必须**放行真实请求**才轮得到它。
{
  const misses = []
  if (!/_resolveIdentity\(bindOwner\)\s*\{/.test(pickupJs)) misses.push('缺 _resolveIdentity(bindOwner)（四态判定 + 归属绑定时机）')
  // R5：判据必须是**稳定账号快照 + page-guard 的那一份状态机**，不是"上一次读到的身份键"。
  // 后者会把「同一个人的 JWT 自然过期」（'u:A' → ''，因为 getToken() 过期时先 clearSession）
  // 与「主动登出」判成同一件事：当场清码 + 一个请求都不发 = 静默补签永远跑不到。
  if (!/resolveAccountState\(auth, this\._account\)/.test(pickupJs)) {
    misses.push('身份判定没有走 page-guard.resolveAccountState（自然过期会被误判成登出）')
  }
  {
    const body = methodBody(stripComments(pickupJs), '_resolveIdentity')
    if (!body) misses.push('取不到 _resolveIdentity 的函数体')
    // 快照只许放内存，且必须在 'changed' 时当场销毁。
    else if (!/this\._account = ''/.test(body)) misses.push('换人 / 登出时没有销毁账号快照')
    else if (!/this\._account = resolved\.account/.test(body)) misses.push('没有沿用状态机给出的账号快照')
    // 反面：页面不得自己制造补签资格，也不得把快照落地（落地就是"这台设备上刚才是谁"）。
    const bare = stripComments(pickupJs)
    if (/RESIGNIN_ELIGIBLE|resignin_eligible/.test(bare)) misses.push('页面直接碰了补签资格标记')
    if (/setStorageSync|storage\.set\(/.test(bare)) misses.push('账号快照 / 凭证被写进了本机存储')
  }
  // 正面：'resignable' 必须和 'ok' 一样走到真实请求那一行，不能被提前 return 掉。
  {
    const refresh = methodBody(stripComments(pickupJs), '_refreshOrder')
    const failIdx = refresh.indexOf('_failClosedForIdentity()')
    const reqIdx = refresh.indexOf('api.getCloudPrintOrder(')
    if (!(failIdx > 0 && reqIdx > failIdx)) {
      misses.push("'unusable' fail-closed 之后 'ok'/'resignable' 必须继续发请求")
    }
    if (/identityState !== 'ok'/.test(refresh)) {
      misses.push("'resignable' 被和 'unusable' 一起拦掉了（那是一页转不完的 loading）")
    }
  }
  if (!/_failClosedForIdentity\(\)\s*\{[\s\S]{0,600}errorAction: 'login'/.test(pickupJs)) {
    misses.push('fail-closed 态没有给登录出口')
  }
  if (!pickupWxml.includes("errorAction === 'login' ? '去登录'")) misses.push('模板没有按 errorAction 分流按钮文案')
  // 反面：不许再出现「身份判定返回布尔」的老形态。
  if (/_enforceIdentity\(\)[\s\S]{0,400}return isMemberIdentity\(identity\)/.test(pickupJs)) {
    misses.push('身份判定又被压回布尔（未登录/无 id/过期会重新合流成永久 loading）')
  }
  if (!misses.length) ok('取件页身份判定四态：可补签放行真实请求，真不可用 fail-closed 并给登录出口')
  else bad('取件页不得永久 loading', misses.join('；'))
}

// R8 收口 ①：取件页**每一次 onShow 都必须先判身份，再谈别的**。
//
// 上一版 `_refreshOrder` 第一行是 `if (!this.data.orderId || this._polling) return`——
// 身份判定排在这个早退**之后**。于是这条真实链路上有一个只由网络快慢决定长短的暴露窗口：
// A 的码已经画在屏幕上、一发轮询正在飞（_polling === true），此时 A 登出、B 登录、
// 回到本页 —— onShow 调进来第一行就 return，身份根本没被判过，清场没发生，
// A 的取件凭证原样留在屏幕上，一直留到那发请求自己落定。慢响应 / 弱网重试 / 服务端卡住
// 都能把它拉到几十秒以上，而这几十秒里看着它的是共用设备上的下一位。
{
  const misses = []
  const bare = stripComments(pickupJs)
  const refresh = methodBody(bare, '_refreshOrder')
  if (!refresh) misses.push('取不到 _refreshOrder 的函数体')
  else {
    const identityIdx = refresh.indexOf('this._resolveIdentity(bindOwner === true)')
    const pollingIdx = refresh.indexOf('this._polling) return')
    if (identityIdx < 0) misses.push('_refreshOrder 里没有身份判定')
    else if (pollingIdx >= 0 && pollingIdx < identityIdx) {
      misses.push('"已经有一发在飞"的早退排在身份判定之前（A 的码会一直留到那发请求落定）')
    }
    if (/if \(!this\.data\.orderId \|\| this\._polling\) return/.test(refresh)) {
      misses.push('第一行又把 orderId 与 _polling 合并成一个早退（身份判定会被它整个跳过）')
    }
    // 去重本身要留着：判完身份之后仍然不该对同一格重复打请求。
    if (pollingIdx < 0) misses.push('在飞去重没了（同一格会被重复打请求）')
  }
  // onShow 必须真的走这条路，不能自己另判一套。
  if (!/onShow\(\) \{[\s\S]{0,600}this\._refreshOrder\(false, handoff\)/.test(bare)) {
    misses.push('onShow 没有走 _refreshOrder（那是唯一一处"先判身份"的入口）')
  }
  // R9：onShow 传进去的 bindOwner **只能**是那个一次性的登录回程标记，而且它必须
  // 在读完的同一句里被撤掉、并要求此刻没有请求在飞。写成常量 true 就等于把
  // "谁现在登录着谁就是这一页的主人"重新放了回来（那正是 R9-A 的缺口）。
  if (!/const handoff = this\._loginHandoff === true && !this\._polling/.test(bare)
    || !/this\._loginHandoff = false/.test(bare)) {
    misses.push('onShow 的归属绑定窗口不是一次性的（或没有要求此刻没有请求在飞）')
  }
  if (/this\._refreshOrder\(false, true\)/.test(bare)) {
    misses.push('onShow 无条件允许绑定开页那位（后来登录的那位会被认成这一页的主人）')
  }
  if (!misses.length) ok('取件页每一次 onShow 都先判身份再决定发不发请求（在途请求不得把清场推迟到网络之后）')
  else bad('取件页在途暴露窗口', misses.join('；'))
}

// R8 收口 ②：**请求合法发出之后才自然过期**的那条 200，仍然属于本人。
//
// enduser JWT 只签 30 分钟，而取件页会一直轮询。于是这条路径每天都在发生：请求在 'ok'
// 状态下带着 A 的登录态发出去 → 服务端按 requireOwned 校验过归属、返回 200 → 响应回来的
// 路上 A 的 JWT 到点（getToken() 过期时先 clearSession，身份于是读成 ''）。R5 之前的成功分支
// 只认 `state === 'ok'`，把这条**刚刚被服务端确认过属于 A** 的响应判成"身份说不清"，
// 当场清掉屏幕上那张码、写一句「请登录」——用户站在一体机前，手里的码没了，而它一直有效。
//
// ── R9 收紧：`'ok'` 也不许无条件放行 ────────────────────────────────────────
//
// 上一版这个函数的第一行是 `if (state === 'ok') return true`，三条归属判据全在
// `'resignable'` 分支里。而真实链路上有一条路走的是 `'ok'`：打开本页时 A 的 JWT 已经
// 自然到点（快照 / 开页账号 / 发起账号三个全是空串），请求照常发出去；在途期间 B 登录、
// 回到本页 —— `_openerAccount` 此刻还是空的，于是 B 被记成开页那位，`_resolveIdentity`
// 返回 `'ok'`，A 的迟到 200 就被判成"属于当前这位"，画在了 B 的屏幕上。
// 所以现在 `'ok'` 与 `'resignable'` **走同一组判据**，而且多一条代次：
// 身份一变、归属一存疑，在途那一发当场作废。
{
  const misses = []
  const bare = stripComments(pickupJs)
  const owns = methodBody(bare, '_ownsResponse')
  if (!owns) misses.push('缺 _ownsResponse（成功响应的归属判定）')
  else {
    if (/if \(state === 'ok'\) return true/.test(owns)) {
      misses.push("'ok' 又变回无条件放行（它只说\"此刻有个确定身份\"，不说这一发属于谁）")
    }
    if (!/if \(state !== 'ok' && state !== 'resignable'\) return false/.test(owns)) {
      misses.push("只有 'ok' / 'resignable' 是放行路径（'changed' / 'unusable' 一律 fail-closed）")
    }
    if (!/token\.epoch !== this\._requestEpoch/.test(owns)) misses.push('没有核请求代次（身份一变，在途那一发就该作废）')
    if (!/this\._ownerAmbiguous/.test(owns)) misses.push('归属存疑时没有 fail-closed')
    if (!/isMemberIdentity\(account\)/.test(owns)) misses.push('没有要求快照仍是一个确定的会员键')
    if (!/\n\s*if \(account !== this\._openerAccount\) return false/.test(owns)) {
      // 必须是**无条件**的那一行。写成 `if (this._openerAccount && account !== ...)`
      // 等于「开页那位没绑上时一律放行」—— 而「没绑上」正是 R9-A 那条路的形状。
      misses.push('没有无条件比对开页那位（本页的 orderId 属于他）')
    }
    if (!/sameAccount\(token\.account, account\)/.test(owns)) misses.push('没有比对发出这一发请求的那位')
    if (!/sameAccount\(token\.opener, account\)/.test(owns)) misses.push('没有比对发出这一发时的开页那位')
  }
  // 发起那一刻的账号 / 开页账号 / 代次必须**绑在令牌上**：回调时再读一次，读到的可能是
  // 被 clearSession 清空的会话，也可能是在途期间刚登录进来的另一位。
  if (!/const token = \{ account: this\._account, opener: this\._openerAccount, epoch: this\._requestEpoch \}/.test(bare)) {
    misses.push('没有在发请求前把发起账号 / 开页账号 / 代次一起绑进令牌')
  }
  const refresh = methodBody(bare, '_refreshOrder')
  if (refresh && refresh.indexOf('const token = {') > refresh.indexOf('api.getCloudPrintOrder(')) {
    misses.push('令牌绑在请求之后（那就不是"发出那一刻的真值"了）')
  }
  // 迟到的响应必须**在判身份之前**就被挡住，而且挡住时连去重锁都不许碰
  //（那把锁此刻可能正锁着另一发新的请求）。
  if (!/if \(!this\._settleRequest\(token\)\) return/.test(bare)) {
    misses.push('成功 / 失败分支没有先按令牌确认"这一发还属于当前这一轮"')
  }
  if (!/_settleRequest\(token\) \{[\s\S]{0,400}this\._inflight !== token\) return false/.test(bare)) {
    misses.push('_settleRequest 不是按令牌对象身份比对（比代次挡不住同代次的先后两发）')
  }
  {
    // 必须在**这个函数自己的函数体里**找，不能让正则跨出去撞上 _settleRequest 里
    // 那句同名赋值 —— 跨出去之后这条门禁对「只 +1 代次、不放锁」是瞎的。
    const invalidate = methodBody(bare, '_invalidateInflight')
    if (!/this\._requestEpoch \+= 1/.test(invalidate) || !/this\._polling = false/.test(invalidate)
      || !/this\._inflight = null/.test(invalidate)) {
      misses.push('作废在途请求时没有同时 +1 代次并交还去重锁（锁不放 = 「重新加载」按不动）')
    }
  }
  if (!/if \(!this\._ownsResponse\(state, token\)\) \{ this\._failClosedForIdentity\(\); return \}/.test(bare)) {
    misses.push('成功分支没有按 _ownsResponse 分流，或证不出归属时没有 fail-closed')
  }
  // 归属只许在两个说得清因果的时刻绑定：onLoad 的第一次判定、以及本页自己那一发
  // （发出时归属未定）的回调里且页面仍可见。少了 `this._visible` 那一半，用户切走期间
  // 别人登录同样会被认作这一页的主人。
  if (!/this\._refreshOrder\(true, true\)/.test(bare)) misses.push('onLoad 没有作为绑定开页那位的那一刻')
  {
    // then 与 catch **两个**回调各有一处，必须逐处都带 `this._visible`。只钉「存在」的话，
    // 改坏其中一个、另一个照样让这条门禁绿着 —— 而改坏的那个就是「用户切走期间
    // 别人登录，回来时这一页已经认了新主人」的入口。
    const bound = (bare.match(/this\._resolveIdentity\(token\.opener === '' && this\._visible\)/g) || []).length
    const anyToken = (bare.match(/this\._resolveIdentity\(token\.opener === ''/g) || []).length
    if (bound !== 2 || anyToken !== bound) {
      misses.push('回调里的绑定窗口没有逐处要求「发出时归属未定」与「页面仍然可见」（带 _visible 的 '
        + bound + ' 处 / 共 ' + anyToken + ' 处，应为 2/2）')
    }
  }
  if (!/isMemberIdentity\(resolved\.account\) && !this\._openerAccount && bindOwner === true/.test(bare)) {
    misses.push('_resolveIdentity 又变回"看见一个确定身份就认作开页那位"')
  }
  if (!/if \(isMemberIdentity\(resolved\.account\) && !this\._openerAccount && !this\._ownerAmbiguous\) \{\s*\n\s*this\._ownerAmbiguous = true\s*\n\s*this\._invalidateInflight\(\)/.test(bare)) {
    misses.push('认不出主人时没有标成归属存疑并作废在途那一发（只留一行赋值不算，它可能根本到不了）')
  }
  // 反面锚：401 与"真的换了人"两条 fail-closed 一个都不许被这次放宽带松。
  if (!/if \(err && err\.statusCode === 401\)/.test(bare)) misses.push('401 的清码分支没了')
  if (!/if \(this\._ownerAmbiguous \|\| foreign \|\| resolved\.state === 'changed'\)/.test(bare)) {
    misses.push('换人 / 登出 / 归属存疑的清场分支没了')
  }
  if (!misses.length) ok("取件页：归属在请求发出前就绑定，'ok' 与 'resignable' 同一组判据 + 代次，其余 fail-closed")
  else bad('取件页不得把本人的有效码当成过期清掉，也不得把它画给一个认不出的会话', misses.join('；'))
}

// R9 收口：取件页画码的 **exec 回调**必须重新确认码 / 归属 / 代次。
//
// `wx.createSelectorQuery().exec()` 的回调跨帧才回来，中间这张码完全可能已经被换掉
// （核销后重取）、被撤下（过期 / 轮询失联 / 换人清场），或者整页已经换了人。上一版
// 这个回调什么都不重认，照样把画布写成 `qrStatus: 'ready'` —— 用户会照着一张作废的、
// 或者根本不属于当前这位的码去一体机扫。package-code 早就有这三道，取件页一直没有。
{
  const misses = []
  const bare = stripComments(pickupJs)
  const draw = methodBody(bare, '_drawPickupQr')
  if (!draw) misses.push('取不到 _drawPickupQr 的函数体')
  else {
    const execIdx = draw.indexOf('.exec((result)')
    if (execIdx < 0) misses.push('取不到 exec 的回调')
    else {
      const before = draw.slice(0, execIdx)
      const after = draw.slice(execIdx)
      // 三样都必须在**进入异步之前**钉进局部变量：回调里现读 this.data 就是在读"现在"，
      // 而这一笔画的是"当时"。
      if (!/const code = this\.data\.codeRaw/.test(before)) misses.push('画哪个码没有在进入异步前钉死')
      if (!/const owner = this\._openerAccount/.test(before)) misses.push('画给谁没有在进入异步前钉死')
      if (!/const epoch = this\._requestEpoch/.test(before)) misses.push('属于哪一轮没有在进入异步前钉死')
      if (!/this\.data\.codeRaw !== code/.test(after)) misses.push('回调里没有重认这张码还是不是当时那张')
      if (!/this\._openerAccount !== owner/.test(after)) misses.push('回调里没有重认归属')
      if (!/this\._requestEpoch !== epoch/.test(after)) misses.push('回调里没有重认请求代次')
      if (!/this\._ownerAmbiguous \|\| this\._foreignBlocked/.test(after)) misses.push('归属存疑 / 已换人时仍然会画')
      // 三道守卫必须排在**任何一次 setData 之前**：先写 'error' 再判等于已经改写了
      // 当前这张码的状态（把一张好码说成画不出来）。
      const guardEnd = after.indexOf('const target = result')
      if (guardEnd < 0 || after.slice(0, guardEnd).includes('setData')) {
        misses.push('守卫排在 setData 之后（那一笔已经替当前这张码下了结论）')
      }
    }
  }
  if (!misses.length) ok('取件页画码：迟到的 exec 回调不得画、也不得把画布说成已就绪')
  else bad('取件页画码的异步回调没有重认码 / 归属 / 代次', misses.join('；'))
}

// R4 收口 ②：取件页凭证的**新鲜度**。
// 核销之后服务端不再下发 pickupCode / pickupCodeExpiresAt。若前端从旧 data 继承，
// 一张已经被消费掉的码会继续挂着倒计时留在屏幕上；而轮询一直失败时我们根本不知道
// 它是否已被扫掉，所以只在「最近一次服务端确认还够新」时保留。
{
  const misses = []
  if (/pickupCodeExpiresAt[\s\S]{0,120}:\s*this\.data\.expiresAt/.test(pickupJs)) {
    misses.push('有效期仍从旧 data 继承（核销后会继续显示上一轮那个时间）')
  }
  if (!/const CODE_TRUST_WINDOW_MS = \d+/.test(pickupJs)) misses.push('缺凭证信任窗口常量')
  if (!/const codeStale = this\.data\.showQr[\s\S]{0,200}CODE_TRUST_WINDOW_MS/.test(pickupJs)) {
    misses.push('轮询失败时没有按新鲜度判定是否撤码')
  }
  if (!/if \(codeStale\) \{[\s\S]{0,160}this\._clearCredentials\(\)/.test(pickupJs)) {
    misses.push('判定为过期后没有真的清掉凭证')
  }
  if (!/_clearCredentials\(\)\s*\{[\s\S]{0,400}expiresAt: 0/.test(pickupJs)) {
    misses.push('清凭证时没有一起清掉有效期（它是那张码的说明文字）')
  }
  if (!misses.length) ok('取件页凭证只在服务端确认仍新鲜时保留，核销 / 失联后连有效期一起清零')
  else bad('取件页凭证新鲜度', misses.join('；'))
}

// R4 收口 ③：打印订单页在**前台**失效时必须当场清列表凭证。
//
// 真实失效链路里根本没有 onShow：request.js 拿到 401 会静默续签一次，续签失败就
// auth.logout()，全程没有任何生命周期回调，页面还停在前台。只在 onShow 里清，
// 等于让一份带着到机码的订单列表停在一个已经不存在的会话上，等下一位来看。
{
  const misses = []
  const src = stripComments(ordersJs)
  if (!/_enforceIdentity\(\)\s*\{[\s\S]{0,700}this\._resetAll\(\)/.test(src)) {
    misses.push('_enforceIdentity 没有真的清场')
  }
  // 每一条**敏感异步回调**都必须先执行身份判定、再判这条响应能不能写。
  //
  // 此前这里数的是 `_enforceIdentity()` 出现了几次（`hooked < 6`）。计数挡不住这批缺陷：
  // 六次可以全落在入口守卫上，回调里一次都没有，断言照样绿 —— 而真实失效链路
  //（request.js 补签失败 → auth.logout()，页面还在前台）根本没有入口可走，
  // 能清掉屏幕的只剩回调里那一次。计数还会被"在无关位置多写一次"直接喂饱。
  // 现在逐条回调取函数体，并检查**顺序**：先判定，后决定能不能写。
  for (const [method, kind, count] of [['_load', 'then', 1], ['_load', 'catch', 1],
    ['_loadPackages', 'then', 1], ['_loadPackages', 'catch', 1],
    ['_submitCancel', 'then', 1], ['_submitCancel', 'catch', 1]]) {
    const bodies = promiseCallbackBodies(methodBody(src, method), kind)
    if (bodies.length < count) { misses.push(`${method} 的 .${kind}() 回调取不到`); continue }
    const body = bodies[0]
    const enforceAt = body.indexOf('this._enforceIdentity()')
    const decideAt = Math.min(
      ...[body.indexOf('this._accepts('), body.indexOf('this._sameIdentity(')].filter((i) => i >= 0),
    )
    if (enforceAt < 0) misses.push(`${method} 的 .${kind}() 回调没有执行身份判定（前台静默登出时无人清场）`)
    else if (!Number.isFinite(decideAt)) misses.push(`${method} 的 .${kind}() 回调没有用令牌判定能不能写`)
    else if (enforceAt > decideAt) misses.push(`${method} 的 .${kind}() 回调先判令牌后判身份（换人时只丢响应、不清屏幕）`)
  }
  if (!/onPullDownRefresh\(\)\s*\{[\s\S]{0,400}if \(!this\._enforceIdentity\(\)\) \{ stop\(\); return \}/.test(src)) {
    misses.push('下拉刷新没有先核身份（会"刷新"出仍属于上一个会话的订单与到机码）')
  }
  if (!/_resetAll\(\)\s*\{[\s\S]{0,400}pkgRows: \[\]/.test(src)) misses.push('_resetAll 没清材料包分区')
  if (!misses.length) ok('打印订单页在前台静默登出 / 401 时当场清掉列表与到机码，不依赖离页再回来')
  else bad('打印订单页前台失效清场', misses.join('；'))
}

// R4 收口 ④：单件链 print-store → print-pay → print-pickup 的 URL 只传非敏感/必要参数，
// 且建单成功后先锁 orderId。
{
  const misses = []
  // print-pay 不得再从 URL 读金额 / 页数 / 文件名 —— 它们现在一律向服务端取。
  for (const field of ['amountCents', 'total', 'pages', 'name', 'pickupCode', 'expiresAt']) {
    if (new RegExp(`q\\.${field}\\b`).test(printPayJs)) misses.push(`print-pay 仍从 URL 读 ${field}`)
  }
  if (!printPayJs.includes('api.getMyDocuments(')) misses.push('print-pay 没有从本人文件库取文件名')
  // 建单成功 → 先锁 orderId 再跳转；跳转失败有兜底；再点一次不许重复 POST。
  const payBare = stripComments(printPayJs)
  const flow = methodBody(payBare, 'continueFlow')
  if (!flow) misses.push('取不到 continueFlow 的函数体')
  const createIdx = flow.indexOf('api.createCloudPrintOrder(')
  const chain = createIdx >= 0 ? flow.slice(createIdx) : ''
  const lockIdx = chain.indexOf('this._createdOrderId = orderId')
  const redirectIdx = chain.indexOf('wx.redirectTo(')
  // R5：判据不再是"回调时再读一次身份"。同一个人的 30 分钟 JWT 在 POST 在途期间到点，
  // getToken() 会先 clearSession()，回调读到的身份是 `''` —— 逐字比对会把它判成换人，
  // 于是订单已经在服务端建出来了，页面却不锁 orderId、还把按钮解开。再点一次就是
  // 第二张订单和第二笔钱 —— 服务端的幂等键只有在**前端复用同一个键**时才救得回来，
  // 而"判成换了人"这条路径连键都不会复用。
  if (/_sameIdentity\(identity\)/.test(payBare)) {
    misses.push('建单回调仍按"回调时重读身份"判定（同一账号的自然过期会被判成换人 → 重复下单）')
  }
  const bindIdx = flow.indexOf('this._createAttempt = attempt')
  if (!(bindIdx > 0 && createIdx > bindIdx)) {
    misses.push('这次建单尝试必须在 POST **发出之前**就绑定（发出后服务端那张订单就可能已经存在）')
  }
  if (!/if \(this\._createAttempt && !this\._createAttempt\.settled\) return/.test(flow)) {
    misses.push('在途尝试没有独立的锁（只靠 setData 的 submitting，任何一条路径写回 false 就能重复 POST）')
  }
  const guardIdx = chain.indexOf('this._createAttempt !== attempt')
  if (!(guardIdx > 0 && lockIdx > guardIdx)) misses.push('建单成功回调没有先判这次尝试还属不属于当前账号，再锁 orderId')
  if (!(lockIdx > 0 && redirectIdx > lockIdx)) misses.push('orderId 必须在 redirectTo 之前锁住（跳转失败时页面还留在这里）')
  if (!/fail: \(\) => this\._lockAfterCreated\(orderId\)/.test(printPayJs)) misses.push('redirectTo 没有失败兜底')
  if (!/if \(this\._createdOrderId\) \{ this\._lockAfterCreated\(this\._createdOrderId\); return \}/.test(printPayJs)) {
    misses.push('已建过单仍可能再 POST 一次（服务端虽会按幂等键回放，页面也不该让用户白点）')
  }
  // 换人 / 登出必须当场复位与上一位绑定的全部状态，onShow 也要过一遍
  //（用户完全可能在别的页换了账号再切回来，本页收不到任何通知）。
  const reset = methodBody(payBare, '_resetForAccountChange')
  for (const [needle, why] of [
    ['this._createdOrderId = null', 'A 的订单号'],
    ['this._createAttempt = null', 'A 的建单尝试锁'],
    ['createdLocked: false', '锁定态'],
    ['submitting: false', '提交锁（留着 B 的按钮永远按不动）'],
    ["'files[0].name': '本人文件'", 'A 的文件名（常含本人姓名）'],
  ]) {
    if (!reset.includes(needle)) misses.push(`换账号没有复位${why}`)
  }
  if (!methodBody(payBare, 'onShow').includes('_resolveAccount()')) {
    misses.push('onShow 没有重新核账号（换账号后回到本页，A 的建单锁会锁死 B）')
  }
  // R5 收口：`wx.hideLoading()` 不是栈 —— 它无条件掀掉当前屏幕上那一张遮罩，不管是谁挂的。
  // 放在归属判定之前，A 的迟到回调就会掀掉 B 正在进行的那次提交的遮罩：B 的按钮还锁着、
  // 请求还在飞，屏幕上却什么都没有了。遮罩必须认主：谁挂的谁收。
  if (/wx\.hideLoading\(/.test(flow)) {
    misses.push('建单链直接调了 wx.hideLoading()（遮罩不认主，A 的迟到回调会掀掉 B 的）')
  }
  if (!/_releaseLoading\(attempt\)/.test(flow)) misses.push('建单回调没有按尝试归属收遮罩')
  const release = methodBody(payBare, '_releaseLoading')
  if (!/this\._createAttempt !== attempt\) return/.test(release)) {
    misses.push('_releaseLoading 没有在遮罩已归后来那次提交时让开')
  }
  // 报价：补签**失败**后账号从 'resignable' 掉成 'unusable'，这一跳快照始终是空、不算换人，
  // 没有人写终态。停在 'loading' 会同时锁死展示与重试（模板只在 error 时给「重新核价」，
  // retryQuote 又只在非 loading 时才动）。
  if (!/if \(state === 'unusable'\) this\._failClosedQuote\(token\)/.test(payBare)) {
    misses.push("报价 'unusable' 时没有把金额从「正在核定」里解出来（永久 loading）")
  }
  const failQuote = methodBody(payBare, '_failClosedQuote')
  if (!/token\.channel !== 'quote'\) return/.test(failQuote)) {
    misses.push('_failClosedQuote 没有只管报价通道（文件名那条链失败本来就是静默的）')
  }
  if (!/quoteState: 'error'/.test(failQuote)) misses.push('fail-closed 报价没有落到 error（「重新核价」会是死按钮）')
  if (!printPayWxml.includes('createdLocked')) misses.push('模板没有反映「订单已创建」的锁定态')
  if (!printPayJs.includes("wx.navigateTo({ url: '/pages/orders/orders'")) misses.push('锁定后没有给出找回订单的出口')
  // print-pay → print-pickup 只带 orderId。
  //
  // 取的是 `wx.redirectTo(...)` 的**整个实参段**，不是 `/print-pickup\?[^`'"]*/`。
  // 那条正则在第一个引号处就停 —— 本页的地址是 `'…?orderId=' + encodeURIComponent(id)`
  // 拼出来的，它只看得到 `orderId=`，后面再 `+ '&pickupCode=' + code` 一个字都抓不到。
  // 也就是说这条「凭证不进 URL」的断言，对本页真正的写法从来没有约束力。
  const navArgs = callArgs(payBare, 'wx.redirectTo(')
  if (!navArgs.includes('print-pickup')) misses.push('找不到 print-pay 进取件页的跳转')
  else {
    for (const field of ['pickupCode', 'expiresAt', 'amountCents', 'taskStatus', 'orderNo', 'name', 'store']) {
      if (new RegExp(`${field}=`).test(navArgs)) misses.push(`print-pay 进取件页时携带 ${field}`)
    }
    const params = navArgs.match(/[?&][A-Za-z_]+=/g) || []
    if (params.length !== 1 || params[0] !== '?orderId=') {
      misses.push(`进取件页只许带 orderId，实际带了 ${params.join(',') || '(未识别到参数)'}`)
    }
  }
  if (!misses.length) ok('单件链 URL 只传非敏感参数，建单后先锁 orderId 且可从本人订单找回')
  else bad('单件打印链凭证与幂等', misses.join('；'))
}

// 凭证不进 URL：列表拿到的 pickupCode 只用于展示，绝不拼进跳转地址。
// 一条构造出来的链接或一张转发出去的卡片就能在别人手机上渲染出带码的成功页。
{
  const offenders = []
  const openIdx = ordersJs.indexOf('openPackage(e)')
  const openBlock = openIdx >= 0 ? ordersJs.slice(openIdx, openIdx + 500) : ''
  if (!openBlock) offenders.push('orders.js 找不到 openPackage 实现')
  for (const field of ['pickupCode', 'amountCents', 'paymentSessionToken', 'expiresAt', 'price']) {
    if (openBlock.includes(`${field}=`)) offenders.push(`orders.js openPackage 把 ${field} 拼进了 URL`)
  }
  const confirmJs = read('pages/package-confirm/package-confirm.js')
  const navIdx = confirmJs.indexOf("'/pages/package-code/package-code?orderId='")
  if (navIdx < 0) offenders.push('package-confirm 建单后未以 orderId 单参跳转到机码页')
  for (const field of ['pickupCode', 'expiresAt', 'amountCents', 'paymentSessionToken', 'storeName']) {
    if (navIdx >= 0 && confirmJs.slice(navIdx, navIdx + 400).includes(`${field}=`)) {
      offenders.push(`package-confirm 跳转 URL 携带 ${field}`)
    }
  }
  if (!offenders.length) ok('材料包到机码页跳转只带 orderId，凭证与金额不进 URL')
  else bad('材料包凭证不进 URL', offenders.join('；'))
}

// 全链禁止在线支付：材料包的钱在一体机上现场付，小程序侧没有任何支付闭环。
{
  const payHits = jsFiles.filter((f) => stripComments(read(f)).includes('wx.requestPayment'))
  if (!payHits.length) ok('全仓不出现 wx.requestPayment（材料包为到机现场付款）')
  else bad('小程序不得发起在线支付', payHits.join(','))
}

// onLoad 挡不住首屏那一帧：成功横幅写死在 wxml 里，不受 data 控制。
// 必须由一个默认 false 的开关把它关在门外，否则深链打开时会先闪出一句无订单支撑的宣告。
const codeWxml = read('pages/package-code/package-code.wxml')
const codeJs = read('pages/package-code/package-code.js')
if (
  /wx:if="\{\{ready\}\}"/.test(codeWxml) &&
  /材料包订单/.test(codeWxml.split('wx:if="{{ready}}"').slice(-1)[0] || '') &&
  /\bready:\s*false\b/.test(codeJs) &&
  codeJs.includes('api.getPackageOrder(')
) ok('到机码页整块成功内容由默认关闭的开关控制，且只在服务端确认订单后打开')
else bad('到机码页首屏', 'package-code 的成功内容必须在 wx:if="{{ready}}" 之内、ready 默认 false，且数据来自 api.getPackageOrder')

// 分享会把本人凭证继续散出去，package-code 的分享标题原本就是「材料包创建成功」。
const packageShare = PACKAGE_CHAIN_PAGES
  .filter((page) => /onShare(AppMessage|Timeline)\s*\(/.test(read(`${page}.js`)))
if (!packageShare.length) ok('材料包四页均未开放分享')
else bad('材料包侧链分享', `${packageShare.join(',')} 不得提供 onShareAppMessage/onShareTimeline（到机码是本人取件凭证）`)

// 假数据即使被守卫挡住也不能留在唯一发布源里：守卫可能被回退或漏页。
const PACKAGE_FAKE_DATA = [
  { pattern: /['"]010-00000000['"]/, label: '假服务点电话 010-00000000' },
  { pattern: /39\.9925|116\.3067/, label: '写死的北大坐标' },
  { pattern: /pricePerPage|colorMode === 'bw' \? 0\.5/, label: '本地硬编码单价（价格必须由服务端报价）' },
]
const packageFakeHits = []
for (const page of PACKAGE_CHAIN_PAGES) {
  const src = stripComments(read(`${page}.js`))
  for (const { pattern, label } of PACKAGE_FAKE_DATA) {
    if (pattern.test(src)) packageFakeHits.push(`${page}.js: ${label}`)
  }
}
if (!packageFakeHits.length) ok('材料包四页无假电话 / 假坐标 / 本地硬编码计价')
else bad('材料包侧链假数据', packageFakeHits.join('；'))

// 自我探索附录只能由本人主动选择：结果页默认不选、明确不发给企业，并在本页列出
// 本人 PDF 简历。不得跳「我的文档」、不得用 getOpenerEventChannel。
// api.js 是并发改动热点，这个封装必须是文件末尾的单独追加。
const selfExploreJs = read('pages/self-explore/self-explore.js')
const selfExploreWxml = read('pages/self-explore/self-explore.wxml')
const appendPrintJs = read('pages/self-explore/append-print.js')
const documentsWxml = read('pages/documents/documents.wxml')
const apiAppendAtEnd = /module\.exports = api;\s*\/\/[\s\S]*?api\.appendSelfAssessmentToResume = function appendSelfAssessmentToResume[\s\S]*?\n};\s*$/.test(apiJs)
const appendUsesInPagePicker = appendPrintJs.includes('api.getMyDocuments')
  && appendPrintJs.includes('resume_upload')
  && appendPrintJs.includes('resume_scan')
  && appendPrintJs.includes("url: '/pages/resume-upload/resume-upload'")
  && appendPrintJs.includes('api.appendSelfAssessmentToResume(this.data.taskId, resumeFileId, this._token)')
  && appendPrintJs.includes('/pages/print-upload/print-upload?name=${name}&fileId=${encodeURIComponent(fileId)}&pages=${pages}')
  && !/\bgetOpenerEventChannel\b/.test(appendPrintJs)
  && !appendPrintJs.includes('/pages/documents/documents')
if (
  selfExploreJs.includes('appendConfirmed: false') &&
  selfExploreJs.includes("require('./append-print')") &&
  selfExploreJs.includes('...appendPrint.methods') &&
  !selfExploreJs.includes('/pages/documents/documents') &&
  !selfExploreJs.includes('getOpenerEventChannel') &&
  appendUsesInPagePicker &&
  selfExploreWxml.includes('附到简历一起打印') &&
  selfExploreWxml.includes('只给本人打印带走，平台不发给任何企业') &&
  selfExploreWxml.includes('我自行判断是否将这份附录随简历带去') &&
  selfExploreWxml.includes('暂无可选 PDF 简历') &&
  selfExploreWxml.includes('去上传 PDF 简历') &&
  !documentsJs.includes('selectingResume') &&
  !documentsWxml.includes('暂无可选 PDF 简历') &&
  apiJs.includes('data: { resumeFileId }') &&
  apiAppendAtEnd
) ok('自我探索附录合并打印为本人主动选择，页内挑选真实 PDF 简历并进入打印链路')
else bad('自我探索附录合并打印', '缺少默认未选确认、本人打印带走文案、页内 PDF 简历选择、append 调用、打印跳转、上传入口，或仍依赖 documents 页 / EventChannel / 非末尾追加封装')

// WXSS 编译器比标准 CSS 严：注释后面跟一个多余的分号（`*/;`）、或连续分号
// （`;;`），在浏览器和 postcss 里都是无害的空声明，会被静默忽略；WXSS 直接判编译
// 失败，**整个视图层不渲染**——App 照常启动、getApp() 有值、页面栈恒为 0、模拟器
// 纯白，日志里只有一句「编译 .wxss 文件错误」不指文件。
//
// 2026-09-02 就是这么炸的：app.wxss 的字阶块末尾写成 `52rpx;  /* 26px ... */;`。
// 当时 110 条静态门禁全绿、API 契约一致、视觉刻度零偏离、postcss 解析 63 个 wxss
// 全过、花括号与注释配平也全过——没有任何一道拦得住，最后是靠在开发者工具里看到
// 白屏、二分 app.wxss 才找出来。
//
// 删掉这条检查会怎样：同一类改动可以再次把整个小程序变成白屏而全部门禁保持绿色。
const wxssFiles = [
  path.join(ROOT, 'app.wxss'),
  ...PAGE_PATHS.map((pg) => path.join(ROOT, `${pg}.wxss`)),
  path.join(ROOT, 'custom-tab-bar/index.wxss'),
].filter((f) => fs.existsSync(f))
const wxssStrayHits = []
for (const f of wxssFiles) {
  const src = fs.readFileSync(f, 'utf8')
  const rel = path.relative(ROOT, f)
  for (const [re, what] of [[/\*\/\s*;/g, '注释后多余分号 `*/;`'], [/;\s*;/g, '连续分号 `;;`']]) {
    let m
    while ((m = re.exec(src))) {
      wxssStrayHits.push(`${rel}:${src.slice(0, m.index).split('\n').length} ${what}`)
    }
  }
}
if (!wxssStrayHits.length) ok(`wxss 无 WXSS 编译器拒绝的空声明（${wxssFiles.length} 个文件）`)
else bad('wxss 含 WXSS 会拒绝的空声明', `${wxssStrayHits.slice(0, 5).join('；')}——会导致整个小程序白屏`)

const pageCount = (appJson?.pages || []).length
console.log(`\n${pass} PASS / ${fails.length} FAIL（注册页面 ${pageCount}）`)
if (fails.length) {
  console.error('\n失败项：')
  for (const f of fails) console.error(`  - ${f}`)
  process.exit(1)
}
