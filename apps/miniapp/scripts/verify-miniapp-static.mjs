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

for (const f of wxmlFiles) {
  const src = read(f)
  const urls = [...src.matchAll(/data-url="([^"]+)"/g)].map((m) => m[1]).filter((u) => !u.includes('{{'))
  const dead = urls.filter((u) => !TAB_PATHS.includes(u))
  if (dead.length) bad('路由不指向死页面', `${f}: ${dead.join(',')}`)
  else ok(`路由检查 ${f}`)
}

const forbidden = ['一键投递', '立即投递', '录用概率', '成功率', '匹配率', 'matchRate']
for (const f of wxmlFiles) {
  const src = read(f)
  const hit = forbidden.filter((w) => src.includes(w))
  if (hit.length) bad('合规文案', `${f}: ${hit.join(',')}`)
}
if (!fails.some((x) => x.startsWith('合规文案'))) ok('合规文案无违规词')

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
