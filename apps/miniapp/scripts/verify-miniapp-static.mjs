#!/usr/bin/env node
/**
 * apps/miniapp 静态门禁（原生 1.0.2 唯一工程底座）：
 * - JSON 全部可解析
 * - app.json pages 均有四件套（js/wxml/wxss/json）
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
if (
  pickupWxml.includes('输入此取件码') &&
  !pickupWxml.includes('扫描下方二维码') &&
  !pickupWxml.includes('bindtap="scanTerminal"') &&
  !apiJs.includes('/pickup`')
) ok('取件页不伪造二维码或不存在的详情接口')
else bad('取件页真实能力', '不得恢复空白二维码、扫码关联或未实现 pickup 详情端点')

const documentsJs = read('pages/documents/documents.js')
const printUploadJs = read('pages/print-upload/print-upload.js')
if (
  documentsJs.includes('api.uploadPrintFile') &&
  printUploadJs.includes('hasPageCount') &&
  printUploadJs.includes('本版本不会把未知页数按 0 页计价')
) ok('文档真实上传且未知页数拒绝按零计价')
else bad('文档上传与计价诚实性', '缺少 print_doc 上传或可信页数 fail-closed')

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
