#!/usr/bin/env node
/**
 * apps/miniapp 静态门禁（M0.1 壳）：
 * - JSON 全部可解析
 * - app.json pages 均有四件套（js/wxml/wxss/json）
 * - tabBar 四 Tab 与 custom-tab-bar 一致
 * - 页面路由不指向未注册页面
 * - 合规文案与密钥残留扫描
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
  const dead = urls.filter((u) => !TAB_PATHS.includes(u))
  if (dead.length) bad('路由不指向死页面', `${f}: ${dead.join(',')}`)
  else ok(`路由检查 ${f}`)
}

// M0.3：JS 跳转目标审计（navigateTo / switchTab / redirectTo）+ 死绑定检查
const jsFiles = files.filter((f) => f.endsWith('.js') && !f.includes('/scripts/'))
const pagePathSet = new Set(PAGE_PATHS)
for (const f of jsFiles) {
  const src = read(f)
  const targets = [...src.matchAll(/(?:navigateTo|switchTab|redirectTo|reLaunch)\(\{\s*url:\s*[`'"]([^`'"?]+)/g)].map((m) => m[1])
  const deadJs = targets
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

const forbidden = ['一键投递', '立即投递', '录用概率', '成功率', '匹配率', 'matchRate']
for (const f of wxmlFiles) {
  const src = read(f)
  const hit = forbidden.filter((w) => src.includes(w))
  if (hit.length) bad('合规文案', `${f}: ${hit.join(',')}`)
}
if (!fails.some((x) => x.startsWith('合规文案'))) ok('合规文案无违规词')

// M0.2 登录门禁
const loginWxml = read('pages/login/login.wxml')
const loginJs = read('pages/login/login.js')
const apiJs = read('utils/api.js')
const meWxml = read('pages/me/me.wxml')
const loginPageOk = PAGE_PATHS.includes('pages/login/login') &&
  PAGE_PATHS.includes('pages/terms/terms') &&
  PAGE_PATHS.includes('pages/privacy/privacy')
if (loginPageOk) ok('登录/协议/隐私页已注册')
else bad('登录/协议/隐私页已注册', 'app.json 缺少页面')
if (loginWxml.includes('open-type="getPhoneNumber"') && loginWxml.includes('短信验证码')) ok('登录页含微信一键登录与短信降级')
else bad('登录页含微信一键登录与短信降级', '缺少 open-type 或短信入口')
if (loginWxml.includes('我已阅读并同意') && loginWxml.includes('《服务协议》') && loginWxml.includes('《隐私政策》')) ok('登录页含协议勾选')
else bad('登录页含协议勾选', '缺少同意文案')
if (
  apiJs.includes('wx.login') &&
  loginJs.includes('api.loginByPhone') &&
  !/appSecret\s*[:=]/.test(loginJs) &&
  !/session_key\s*[:=]/.test(loginJs) &&
  !/appSecret\s*[:=]/.test(apiJs)
) ok('登录实现无密钥残留')
else bad('登录实现无密钥残留', '检查 api.js 的 wx.login 与敏感字段')
if (meWxml.includes('登录 / 注册') && meWxml.includes('退出登录')) ok('我的页含登录/退出入口')
else bad('我的页含登录/退出入口', '缺少按钮')

const secretPatterns = [/sk-[A-Za-z0-9]{12,}/, /AKID[A-Za-z0-9]{10,}/, /AI_LLM_API_KEY\s*[:=]/, /DATABASE_URL\s*[:=]/]
const textFiles = files.filter((f) => !f.endsWith('.json') || f.endsWith('app.json'))
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
