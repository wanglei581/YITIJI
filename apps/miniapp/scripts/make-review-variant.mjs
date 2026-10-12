#!/usr/bin/env node
/**
 * 就地生成小程序提审版本。
 *
 *   node scripts/make-review-variant.mjs --variant no-ai
 *   node scripts/make-review-variant.mjs --variant full
 *
 * full 是仓库默认。切到 no-ai 前把关键文件原样收进 review-variants/stash，
 * 再只改页面注册、ignore 里的 aiPages、tab、隐私清单、录音实现、版本开关，
 * 以及把 utils/ai-entries.js 整份换成空版本。
 * 再跑 --variant full 时按 stash 逐字节写回并删掉 stash。
 * 当前已经是目标版本时什么都不做（幂等）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const STASH = path.join(ROOT, 'review-variants', 'stash')
const KEY_FILES = [
  'app.json',
  'project.config.json',
  'custom-tab-bar/index.js',
  'scripts/privacy-api-inventory.json',
  'utils/voice-recorder.js',
  'utils/build-variant.js',
  'utils/ai-entries.js',
]

const arg = process.argv.indexOf('--variant')
const target = arg >= 0 ? process.argv[arg + 1] : ''
if (target !== 'full' && target !== 'no-ai') {
  console.error('usage: node scripts/make-review-variant.mjs --variant <full|no-ai>')
  process.exit(2)
}

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const write = (rel, text) => fs.writeFileSync(path.join(ROOT, rel), text)

function currentVariant() {
  const matched = read('utils/build-variant.js').match(/VARIANT:\s*'([^']+)'/)
  if (!matched) throw new Error('utils/build-variant.js 缺少 VARIANT')
  return matched[1]
}

function variants() {
  return JSON.parse(read('review-variants/variants.json'))
}

function stashOriginals() {
  if (fs.existsSync(STASH)) return
  for (const rel of KEY_FILES) {
    const dest = path.join(STASH, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(path.join(ROOT, rel), dest)
  }
}

function restoreOriginals() {
  if (!fs.existsSync(STASH)) throw new Error('没有 stash，无法还原完整版')
  for (const rel of KEY_FILES) {
    const from = path.join(STASH, rel)
    if (!fs.existsSync(from)) throw new Error(`stash 缺少 ${rel}`)
    fs.copyFileSync(from, path.join(ROOT, rel))
  }
  fs.rmSync(STASH, { recursive: true, force: true })
}

function registeredPages(app) {
  return [
    ...(app.pages || []),
    ...(app.subpackages || []).flatMap((pkg) => (pkg.pages || []).map((page) => `${pkg.root}/${page}`)),
  ]
}

function applyAppJson(aiPages, tabs) {
  const app = JSON.parse(read('app.json'))
  const ai = new Set(aiPages)
  app.pages = (app.pages || []).filter((page) => !ai.has(page.split('/')[1]))
  app.subpackages = (app.subpackages || []).filter((pkg) => !ai.has(pkg.name))
  const names = new Set((app.subpackages || []).map((pkg) => pkg.name))
  const registered = new Set(registeredPages(app))
  const preload = {}
  for (const [page, rule] of Object.entries(app.preloadRule || {})) {
    if (!registered.has(page)) continue
    const packages = (rule.packages || []).filter((name) => names.has(name))
    if (!packages.length) continue
    preload[page] = { ...rule, packages }
  }
  app.preloadRule = preload
  app.tabBar.list = tabs.map((tab) => ({ pagePath: tab.pagePath, text: tab.text }))
  if (app.permission && app.permission['scope.record']) {
    delete app.permission['scope.record']
    if (Object.keys(app.permission).length === 0) delete app.permission
  }
  write('app.json', `${JSON.stringify(app, null, 2)}\n`)
}

function applyIgnore(aiPages) {
  const text = read('project.config.json')
  const json = JSON.parse(text)
  const ignore = (json.packOptions && json.packOptions.ignore) || []
  const have = new Set(ignore.filter((entry) => entry && entry.type === 'folder').map((entry) => entry.value))
  const missing = aiPages.map((name) => `pages/${name}`).filter((value) => !have.has(value))
  if (!missing.length) return
  const marker = '"include":'
  const includeAt = text.indexOf(marker)
  if (includeAt < 0) throw new Error('project.config.json 找不到 packOptions.include')
  const close = text.lastIndexOf(']', includeAt)
  if (close < 0) throw new Error('project.config.json 找不到 ignore 数组结尾')
  const block = missing.map((value) => `      {\n        "value": "${value}",\n        "type": "folder"\n      }`).join(',\n')
  const before = text.slice(0, close).replace(/\s*$/, '')
  write('project.config.json', `${before},\n${block}\n    ${text.slice(close)}`)
}

function applyTabBar(tabs) {
  const rows = tabs.map((tab) => `      { pagePath: '/${tab.pagePath}', icon: '${tab.icon}', text: '${tab.text}' },`).join('\n')
  const next = `list: [\n${rows}\n    ],`
  const src = read('custom-tab-bar/index.js')
  const replaced = src.replace(/list:\s*\[[\s\S]*?\n    \],/, next)
  if (replaced === src) throw new Error('custom-tab-bar/index.js 找不到 list')
  write('custom-tab-bar/index.js', replaced)
}

/**
 * 隐私清单按版本定义重写：只留 privacyCategories 里的类别（不含 AI 版去掉麦克风），
 * privacyPurposes 里登记了的类别换成该版本自己的用途句（他照这几句填公众平台表单，
 * 不含 AI 版不能照搬完整版那几句里的「AI 识别整理」「AI 分析」「简历」；字由合规十 10/12 定）。
 * 清单原文就是 JSON.stringify(…, null, 2) 的格式，重写不改别处排版；--variant full 照旧从 stash 逐字节还原。
 */
function applyPrivacy(categories, purposes) {
  const inventory = JSON.parse(read('scripts/privacy-api-inventory.json'))
  const declared = (inventory.declared || []).filter((item) => categories.includes(item.category))
  const kept = declared.map((item) => item.category)
  if (kept.join('|') !== categories.join('|')) throw new Error(`隐私清单的类别和版本定义对不上：${kept.join('、')}`)
  for (const [category, purpose] of Object.entries(purposes || {})) {
    const item = declared.find((entry) => entry.category === category)
    if (!item) throw new Error(`隐私清单里没有「${category}」，改不了它的用途句`)
    item.purpose = purpose
  }
  inventory.declared = declared
  write('scripts/privacy-api-inventory.json', `${JSON.stringify(inventory, null, 2)}\n`)
}

function applyVoiceStub() {
  write('utils/voice-recorder.js', `// 不含 AI 的提审版不上传录音实现。原文件在 review-variants/stash，--variant full 会逐字节还原。
const QUESTION_MAX_MS = 58000
const PROBE_MAX_MS = 10000

function unavailable() {
  return Promise.reject(new Error('录音在此版本不可用'))
}

module.exports = {
  QUESTION_MAX_MS,
  PROBE_MAX_MS,
  ensureRecordAuth: unavailable,
  start() { throw new Error('录音在此版本不可用') },
  stop: unavailable,
  cancel() {},
}
`)
}

function writeVariant(name, aiEnabled) {
  write('utils/build-variant.js', `// 当前打包版本。由 scripts/make-review-variant.mjs 写入。
module.exports = { VARIANT: '${name}', AI_ENABLED: ${aiEnabled ? 'true' : 'false'} }
`)
}

function writeEmptyAiEntries() {
  write('utils/ai-entries.js', `// 不含 AI 的提审版。路由为空，列表为空。完整版按 stash 还原本文件。
function href() {
  return ''
}

module.exports = {
  href,
  aiTab: null,
  assistantUrl: null,
  resumeBuildUrl: null,
  resumeVoiceUrl: null,
  resumeUploadUrl: null,
  resumeDiagnoseUrl: null,
  resumeOptimizeUrl: null,
  resumeParseUrl: null,
  interviewEntryUrl: null,
  interviewQaUrl: null,
  interviewResultUrl: null,
  careerPlanUrl: null,
  selfExploreUrl: null,
  jobFitUrl: null,
  aiRecordsUrl: null,
  resumesUrl: null,
  dailyReportUrl: null,
  PRIMARY_SERVICES: [],
  meEntries: [],
  printDailyPath: null,
}
`)
}

const now = currentVariant()
if (now === target) {
  console.log(`review variant already ${target}`)
  process.exit(0)
}

const spec = variants()[target]
if (!spec) {
  console.error(`variants.json 没有 ${target}`)
  process.exit(2)
}

if (target === 'no-ai') {
  stashOriginals()
  applyAppJson(spec.aiPages, spec.tabs)
  applyIgnore(spec.aiPages)
  applyTabBar(spec.tabs)
  applyPrivacy(spec.privacyCategories, spec.privacyPurposes)
  applyVoiceStub()
  writeVariant('no-ai', false)
  writeEmptyAiEntries()
  console.log('review variant: no-ai')
} else {
  restoreOriginals()
  console.log('review variant: full')
}
