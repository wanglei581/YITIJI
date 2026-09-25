#!/usr/bin/env node
/**
 * 小程序分包与隐私接口门禁（2026-09-26，推进方案 2.6）。
 *
 * 为什么要分包：微信主包上限 2MB。2026-09-25 全部页面都在主包，按源码算约 2.02MB，
 * 已经没有余量，再加功能就传不上去。现在主包只留四个 Tab 页和登录页，其余每个页面各成一个分包。
 *
 * 为什么是「一页一个分包」而不是「一个业务域一个分包」：分包的 root 必须是一个目录，
 * 同一业务域的页面分散在 pages/ 下的兄弟目录里，按域打包就得把页面挪进新目录，页面路径跟着变。
 * 这些路径写死在服务端（今日提醒的 route、社区卡片、小程序码接口只收 pages/ 开头的路径）、
 * 分享卡片和将来一体机上的小程序码里，改了就断链。所以 root 就设成页面自己的目录，路径一个字不变；
 * 同一业务流的衔接交给 preloadRule：进入一页时，预下载它能直接跳到的分包。
 *
 * 本门禁锁住：
 *   1. 主包只有四个 Tab 页和登录页，首页排第一；
 *   2. 每个分包的 root 是 pages/<名>、只含 <名> 这一页，页面四件套都在；
 *   3. 主包代码不引用分包文件，分包之间不互相引用，引用的文件都在上传包里
 *      （require / @import / <import> / <include> / <wxs> / usingComponents / 本地图片）；
 *   4. preloadRule 只写已注册页面和已声明分包；
 *   5. 主包源码体积不超过预算（远低于 2MB），每个分包也不超过预算；
 *   6. 上传包里用到的隐私接口与 privacy-api-inventory.json 一一对应：
 *      用了没声明，微信会直接拦掉那个接口；声明了没用，审核会问。
 *
 * 体积按源码字节算。开发者工具上传时会压缩 JS / WXSS，但 WXML 会被编译成 JS，
 * 两者不一定抵消，所以预算只取 2MB 的一半，另一半留作余量。最终以开发者工具「详情 → 基本信息」为准。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
let pass = 0
const fails = []
const ok = (name) => { pass += 1; console.log(`  ✓ ${name}`) }
const bad = (name, detail) => { fails.push(name); console.log(`  ✗ ${name} — ${detail}`) }

const KB = 1024
const MAIN_BUDGET = 1024 * KB
const SUB_BUDGET = 1024 * KB
const MAIN_PAGES = ['pages/home/home', 'pages/launch/launch', 'pages/ai/ai', 'pages/print/print', 'pages/me/me']

const app = JSON.parse(read('app.json'))
const packOptions = JSON.parse(read('project.config.json')).packOptions || {}
const ignoredDirs = new Set((packOptions.ignore || []).filter((e) => e && e.type === 'folder').map((e) => e.value))
const ignoredFiles = new Set((packOptions.ignore || []).filter((e) => e && e.type === 'file').map((e) => e.value))
const DEV_DIRS = new Set(['.claude', '.git', 'node_modules', 'scripts', 'tools'])

// ── 1. 主包页面 ──────────────────────────────────────────────
const mainPages = app.pages || []
if (mainPages.length === MAIN_PAGES.length && mainPages[0] === MAIN_PAGES[0] &&
    MAIN_PAGES.every((p) => mainPages.includes(p))) ok(`主包只有四个 Tab 页和登录页（${mainPages.length} 页，首页排第一）`)
else bad('主包只有四个 Tab 页和登录页', `实际：${mainPages.join(', ')}`)

// ── 2. 分包结构 ──────────────────────────────────────────────
const subs = app.subpackages || app.subPackages || []
const shapeErrors = []
const roots = new Set()
const names = new Set()
for (const pkg of subs) {
  const dir = String(pkg.root || '').replace(/\/+$/, '')
  const name = dir.split('/')[1] || ''
  if (!/^pages\/[a-z0-9-]+$/.test(dir)) shapeErrors.push(`root「${pkg.root}」不是 pages/<名>`)
  if (!Array.isArray(pkg.pages) || pkg.pages.length !== 1 || pkg.pages[0] !== name) shapeErrors.push(`${dir} 的 pages 应为 ["${name}"]`)
  if (pkg.name !== name) shapeErrors.push(`${dir} 的 name 应为「${name}」`)
  if (pkg.independent) shapeErrors.push(`${dir} 不应是独立分包（独立分包拿不到 app.js 与主包 utils）`)
  if (roots.has(dir)) shapeErrors.push(`${dir} 重复声明`)
  roots.add(dir)
  names.add(name)
  for (const ext of ['js', 'wxml', 'wxss', 'json']) {
    if (!fs.existsSync(path.join(ROOT, `${dir}/${name}.${ext}`))) shapeErrors.push(`${dir}/${name}.${ext} 不存在`)
  }
  if (ignoredDirs.has(dir)) shapeErrors.push(`${dir} 既是分包又在 packOptions.ignore 里`)
  if (mainPages.some((p) => p.startsWith(`${dir}/`))) shapeErrors.push(`${dir} 下有主包页面`)
}
const tabPaths = ((app.tabBar && app.tabBar.list) || []).map((t) => t.pagePath)
for (const t of tabPaths) if (!mainPages.includes(t)) shapeErrors.push(`Tab 页 ${t} 不在主包`)
if (shapeErrors.length) bad('分包 root 即页面目录、页面路径不变', shapeErrors.join('; '))
else ok(`分包 root 即页面目录、页面路径不变（${subs.length} 个分包）`)

const registered = new Set([...mainPages, ...[...roots].map((dir) => `${dir}/${dir.split('/')[1]}`)])

// ── 上传范围与归属 ───────────────────────────────────────────
const packed = []
;(function walk(dir) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir || '.'), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name
    if (DEV_DIRS.has(entry.name) || ignoredDirs.has(rel) || ignoredFiles.has(rel)) continue
    if (entry.isDirectory()) walk(rel)
    else packed.push(rel)
  }
})('')
const packedSet = new Set(packed)
const packageOf = (rel) => {
  const m = rel.match(/^(pages\/[a-z0-9-]+)\//)
  return m && roots.has(m[1]) ? m[1] : 'main'
}

// ── 3. 引用关系 ──────────────────────────────────────────────
function resolveRef(fromRel, ref, kind) {
  if (!ref || /^(plugin|https?|wxfile|data):/.test(ref) || ref.includes('{{')) return null
  const base = ref.startsWith('/') ? ref.slice(1) : path.posix.join(path.posix.dirname(fromRel), ref)
  const norm = path.posix.normalize(base)
  const candidates = {
    require: [norm, `${norm}.js`, `${norm}/index.js`],
    wxss: [norm, `${norm}.wxss`],
    wxml: [norm, `${norm}.wxml`],
    wxs: [norm, `${norm}.wxs`],
    component: [`${norm}.json`, `${norm}/index.json`],
    asset: [norm],
  }[kind]
  return candidates.find((c) => packedSet.has(c)) || { missing: norm }
}
const refErrors = []
for (const rel of packed) {
  const refs = []
  if (rel.endsWith('.js')) {
    for (const m of read(rel).matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) refs.push(['require', m[1]])
  } else if (rel.endsWith('.wxss')) {
    for (const m of read(rel).matchAll(/@import\s+['"]([^'"]+)['"]/g)) refs.push(['wxss', m[1]])
  } else if (rel.endsWith('.wxml')) {
    const src = read(rel).replace(/<!--[\s\S]*?-->/g, '')
    for (const m of src.matchAll(/<(import|include)\b[^>]*\bsrc=['"]([^'"]+)['"]/g)) refs.push(['wxml', m[2]])
    for (const m of src.matchAll(/<wxs\b[^>]*\bsrc=['"]([^'"]+)['"]/g)) refs.push(['wxs', m[1]])
    for (const m of src.matchAll(/<(?:image|cover-image)\b[^>]*\bsrc=['"]([^'"{}]+\.(?:png|jpe?g|gif|webp|svg))['"]/gi)) refs.push(['asset', m[1]])
  } else if (rel.endsWith('.json')) {
    let json = null
    try { json = JSON.parse(read(rel)) } catch (_) { json = null }
    for (const v of Object.values((json && json.usingComponents) || {})) refs.push(['component', v])
  }
  const from = packageOf(rel)
  for (const [kind, ref] of refs) {
    const target = resolveRef(rel, ref, kind)
    if (target === null) continue
    if (typeof target === 'object') { refErrors.push(`${rel} → ${ref}（上传包里没有 ${target.missing}，运行时会白屏）`); continue }
    const to = packageOf(target)
    if (from === 'main' && to !== 'main') refErrors.push(`主包 ${rel} → 分包 ${target}`)
    if (from !== 'main' && to !== 'main' && to !== from) refErrors.push(`分包 ${rel} → 另一个分包 ${target}`)
  }
}
if (refErrors.length) bad('主包不引用分包、分包之间不互相引用、引用目标都在上传包里', refErrors.slice(0, 8).join('; '))
else ok('主包不引用分包、分包之间不互相引用、引用目标都在上传包里')

// ── 4. preloadRule ──────────────────────────────────────────
const preloadErrors = []
for (const [page, rule] of Object.entries(app.preloadRule || {})) {
  if (!registered.has(page)) preloadErrors.push(`${page} 不是已注册页面`)
  if (!rule || !Array.isArray(rule.packages) || !rule.packages.length) { preloadErrors.push(`${page} 没有 packages`); continue }
  if (rule.network && !['all', 'wifi'].includes(rule.network)) preloadErrors.push(`${page} 的 network 只能是 all / wifi`)
  const own = packageOf(`${page}.js`)
  for (const name of rule.packages) {
    const dir = roots.has(name) ? name : `pages/${name}`
    if (!names.has(name) && !roots.has(name)) preloadErrors.push(`${page} 预下载了不存在的分包「${name}」`)
    else if (dir === own) preloadErrors.push(`${page} 预下载了自己所在的分包`)
  }
}
if (preloadErrors.length) bad('preloadRule 只写已注册页面和已声明分包', preloadErrors.join('; '))
else ok(`preloadRule 只写已注册页面和已声明分包（${Object.keys(app.preloadRule || {}).length} 条）`)

// ── 5. 体积预算 ──────────────────────────────────────────────
const sizes = new Map()
for (const rel of packed) {
  const pkg = packageOf(rel)
  sizes.set(pkg, (sizes.get(pkg) || 0) + fs.statSync(path.join(ROOT, rel)).size)
}
const mainBytes = sizes.get('main') || 0
const fmt = (b) => `${(b / KB).toFixed(1)}KB`
if (mainBytes <= MAIN_BUDGET) ok(`主包源码 ${fmt(mainBytes)}，预算 ${fmt(MAIN_BUDGET)}（微信上限 2048KB）`)
else bad('主包源码体积预算', `${fmt(mainBytes)} > ${fmt(MAIN_BUDGET)}：新文件先想清楚该放哪个分包`)
const subSizes = [...sizes.entries()].filter(([k]) => k !== 'main').sort((a, b) => b[1] - a[1])
const overSub = subSizes.filter(([, b]) => b > SUB_BUDGET)
const totalBytes = [...sizes.values()].reduce((s, b) => s + b, 0)
if (overSub.length) bad('分包源码体积预算', overSub.map(([k, b]) => `${k}=${fmt(b)}`).join(', '))
else ok(`每个分包都在 ${fmt(SUB_BUDGET)} 以内（最大 ${subSizes.length ? `${subSizes[0][0]} ${fmt(subSizes[0][1])}` : '—'}；全部 ${fmt(totalBytes)}）`)

// ── 6. 隐私接口与后台声明一一对应 ─────────────────────────────
// 分类名与接口归属取自微信「小程序用户隐私保护指引内容介绍」（2026-09-26 核对）。
// 只认调用形态（带括号或写在组件属性里），注释里提到接口名不算用到。
const PRIVACY_CATEGORIES = [
  ['手机号', /open-type=["'](?:getPhoneNumber|getRealtimePhoneNumber)["']/],
  ['选中的照片或视频信息', /wx\.(?:chooseImage|chooseMedia|chooseVideo)\s*\(/],
  ['选中的文件', /wx\.chooseMessageFile\s*\(/],
  ['麦克风', /getRecorderManager\s*\(|wx\.startRecord\s*\(|["']scope\.record["']|<live-pusher\b/],
  ['摄像头', /<camera\b|createVKSession\s*\(|["']scope\.camera["']|<live-pusher\b/],
  ['剪切板', /wx\.(?:setClipboardData|getClipboardData)\s*\(/],
  ['位置信息', /wx\.(?:getLocation|getFuzzyLocation|startLocationUpdate|startLocationUpdateBackground|onLocationChange|chooseLocation|choosePoi)\s*\(|["']scope\.userLocation["']/],
  ['昵称、头像', /open-type=["']chooseAvatar["']|type=["']nickname["']|wx\.getUserProfile\s*\(|wx\.getUserInfo\s*\(/],
  ['通讯地址', /wx\.chooseAddress\s*\(/],
  ['发票信息', /wx\.chooseInvoice(?:Title)?\s*\(/],
  ['微信运动步数', /wx\.getWeRunData\s*\(/],
  ['车牌号', /wx\.chooseLicensePlate\s*\(/],
  ['蓝牙', /wx\.(?:openBluetoothAdapter|createBLEPeripheralServer)\s*\(/],
  ['相册（仅写入）', /wx\.(?:saveImageToPhotosAlbum|saveVideoToPhotosAlbum)\s*\(|["']scope\.writePhotosAlbum["']/],
  ['通讯录（仅写入）', /wx\.addPhoneContact\s*\(/],
  ['日历（仅写入）', /wx\.(?:addPhoneCalendar|addPhoneRepeatCalendar)\s*\(/],
]
const stripComments = (rel, src) => rel.endsWith('.wxml')
  ? src.replace(/<!--[\s\S]*?-->/g, '')
  : src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const used = new Map()
for (const rel of packed.filter((f) => /\.(js|wxml)$/.test(f))) {
  const src = stripComments(rel, read(rel))
  for (const [category, re] of PRIVACY_CATEGORIES) {
    if (re.test(src)) used.set(category, [...(used.get(category) || []), rel])
  }
}
const inventory = JSON.parse(read('scripts/privacy-api-inventory.json'))
const declared = new Map((inventory.declared || []).map((d) => [d.category, d]))
const knownCategories = new Set(PRIVACY_CATEGORIES.map(([c]) => c))
const privacyErrors = []
for (const [category, where] of used) {
  if (!declared.has(category)) privacyErrors.push(`用到「${category}」但没声明（${where.slice(0, 3).join(', ')}）`)
}
for (const [category, d] of declared) {
  if (!knownCategories.has(category)) privacyErrors.push(`「${category}」不是微信隐私指引里的分类名`)
  else if (!used.has(category)) privacyErrors.push(`声明了「${category}」但上传包里没有用到`)
  if (!d.purpose || !String(d.purpose).trim()) privacyErrors.push(`「${category}」缺少用途说明`)
}
if (privacyErrors.length) bad('隐私接口与用户隐私保护指引一一对应', privacyErrors.join('; '))
else ok(`隐私接口与用户隐私保护指引一一对应：${[...used.keys()].join('、')}`)

console.log(`\n${pass} PASS / ${fails.length} FAIL（分包与隐私接口）`)
console.log(`主包 ${fmt(mainBytes)} · 分包 ${subSizes.length} 个 · 上传包合计 ${fmt(totalBytes)}`)
if (fails.length) process.exit(1)
