#!/usr/bin/env node
/**
 * 小程序首发审核范围门禁（无人力资源服务许可证期间）。
 *
 * 背景：compliance-boundary.md §1.1 —— 「只展示岗位、不做投递」同样可能需要许可证，
 * 微信「求职/招聘」类目也要许可证。产品负责人 2026-09-25 决定：小程序首发不上岗位、
 * 招聘会、找企业页，按非招聘类目提审，拿证后再加回。只藏按钮不够——页面还在注册表里，
 * 审核员照样能打开，所以这些页面「停放」：源码留在仓库，不注册、不打包。
 *
 * 本门禁锁住四件事：
 *   1. 停放清单里的页面源码还在（拿证后要恢复，不许顺手删掉）；
 *   2. 它们没有注册、不在 Tab 里，且在 project.config.json 的 packOptions.ignore 里（不进上传包）；
 *   3. 实际上传的页面里，写死的页面路径都指向已注册页面（停放页的入口一个不剩）；
 *   4. 实际上传的页面里不出现岗位 / 招聘会类按钮文案，也不用 navigateTo 打开 Tab 页（运行时必失败）。
 *
 * 拿证恢复时：先改这里的 PARKED_PAGES（把要恢复的页面挪出去），再注册页面、恢复入口。
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

// 12 个招聘类页面 + 合同审查（法律咨询类目风险）+ 政策三页、最新动态、收藏、浏览记录、
// 我的权益（产品负责人 2026-09-25「按推荐」拍板，首发先收起）。
const PARKED_PAGES = [
  'jobs', 'job-detail', 'fairs', 'fair-detail', 'fair-venue', 'fair-companies', 'fair-company-detail',
  'fair-visit-plan', 'fair-materials', 'fair-reminders', 'companies', 'company-detail', 'contract-review',
  'policies', 'policy-detail', 'policy-check', 'community', 'favorites', 'browse-history', 'membership',
]
// CLAUDE.md §2 按钮白名单里的招聘类文案 + 禁用文案：首发包里一个都不该出现。
const RECRUITMENT_CTAS = ['查看岗位', '去来源平台投递', '扫码投递', '查看招聘会', '去来源平台预约', '扫码预约', '复制来源链接', '一键投递', '立即投递']

const app = JSON.parse(read('app.json'))
const registered = new Set(app.pages || [])
const tabs = ((app.tabBar && app.tabBar.list) || []).map((t) => `/${t.pagePath}`)
const ignored = new Set(((JSON.parse(read('project.config.json')).packOptions || {}).ignore || [])
  .filter((e) => e && e.type === 'folder').map((e) => e.value))

const missingSource = PARKED_PAGES.filter((p) => ['.js', '.wxml', '.wxss', '.json']
  .some((ext) => !fs.existsSync(path.join(ROOT, `pages/${p}/${p}${ext}`))))
if (missingSource.length) bad('停放页源码保留', `缺少：${missingSource.join(',')}（拿证后要恢复，不许删）`)
else ok(`停放页源码保留（${PARKED_PAGES.length} 页）`)

const stillRegistered = PARKED_PAGES.filter((p) => registered.has(`pages/${p}/${p}`) || tabs.includes(`/pages/${p}/${p}`))
if (stillRegistered.length) bad('停放页未注册', stillRegistered.join(','))
else ok('停放页不在页面表与 Tab 里')

const notIgnored = PARKED_PAGES.filter((p) => !ignored.has(`pages/${p}`))
if (notIgnored.length) bad('停放页不进上传包', `packOptions.ignore 缺少：${notIgnored.join(',')}`)
else ok('停放页都在 packOptions.ignore 里')

// 实际上传范围：去掉 packOptions.ignore 里的目录与开发目录。
const SKIP = new Set(['.claude', 'node_modules', '.git', 'scripts', 'tools'])
const packed = []
;(function walk(dir) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name
    if (SKIP.has(entry.name) || ignored.has(rel)) continue
    if (entry.isDirectory()) walk(rel)
    else if (/\.(js|wxml)$/.test(entry.name)) packed.push(rel)
  }
})('')

const deadRefs = []
const ctaHits = []
const navToTab = []
for (const f of packed) {
  const src = read(f)
  // 只认规范页面路径 /pages/<名>/<同名>：注释里提到一体机源码路径（如 pages/resume/selfAssessmentSession）不会误报。
  for (const m of src.matchAll(/\/pages\/([a-z0-9-]+)\/\1\b/g)) {
    if (!registered.has(`pages/${m[1]}/${m[1]}`)) deadRefs.push(`${f} → ${m[0]}`)
  }
  for (const word of RECRUITMENT_CTAS) if (src.includes(word)) ctaHits.push(`${f}「${word}」`)
  for (const m of src.matchAll(/navigateTo\(\{\s*url:\s*[`'"]([^`'"?]+)/g)) {
    if (tabs.includes(m[1])) navToTab.push(`${f} → ${m[1]}`)
  }
}
if (deadRefs.length) bad('上传包里没有指向未注册页面的路径', [...new Set(deadRefs)].join('; '))
else ok(`上传包里的页面路径都已注册（扫描 ${packed.length} 个文件）`)
if (ctaHits.length) bad('上传包里没有岗位 / 招聘会按钮文案', ctaHits.join('; '))
else ok('上传包里没有岗位 / 招聘会按钮文案')
if (navToTab.length) bad('不用 navigateTo 打开 Tab 页', navToTab.join('; '))
else ok('没有用 navigateTo 打开 Tab 页')

console.log(`\n${pass} PASS / ${fails.length} FAIL（首发审核范围）`)
if (fails.length) process.exit(1)
