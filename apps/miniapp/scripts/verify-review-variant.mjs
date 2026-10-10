#!/usr/bin/env node
/**
 * 小程序完整版 / 不含 AI 提审版一致性。
 *
 * (a) 当前目录的注册页、tab、隐私分类与 review-variants/variants.json 一致。
 * (b) 临时副本里生成 no-ai，再跑 static / review-scope / package-layout 和本门禁的 (a)；
 *     然后 --variant full 还原，关键文件与副本原件逐字节相同。
 * (c) no-ai 已注册页面的 wxml/js 不写死指向 aiPages 的路由（复用 verify-review-scope 的扫描）。
 *     另外：完整版里这些路由字面量只允许出现在 utils/ai-entries.js；
 *     不含 AI 版把该文件换成空版本后，js/wxml（除 scripts/、review-variants/）里也没有。
 *     全仓同样范围内不得出现 page-path，也不得用字符串拼接组装 /pages/ 路径。
 * (d) no-ai 审核说明不含「AI」「大模型」「生成」（「生成到机码」是到机取件用语，先摘掉再查）；
 *     full 审核说明含「AI 生成，仅供参考」。
 *
 * 生成器：scripts/make-review-variant.mjs
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectUnregisteredRouteRefs } from './verify-review-scope.mjs'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const INNER = process.env.MINIAPP_REVIEW_VARIANT_INNER === '1'
const KEY_FILES = [
  'app.json',
  'project.config.json',
  'custom-tab-bar/index.js',
  'scripts/privacy-api-inventory.json',
  'utils/voice-recorder.js',
  'utils/build-variant.js',
  'utils/ai-entries.js',
]

const SKIP_WALK = new Set(['scripts', 'review-variants', 'node_modules', '.git', '.claude', 'miniprogram_npm'])
const AI_ROUTE_RE = /\/pages\/(?:ai|assistant|resume-|interview-|career-plan|self-explore|job-fit|ai-records|resumes|daily-report)/
const ASSEMBLY_RES = [
  /page-path/,
  /'\/pages\/'\s*\+/,
  /"\/pages\/"\s*\+/,
  /`\/pages\/\$\{/,
]
const TEXT_EXT = new Set(['.js', '.wxml', '.mjs', '.json', '.md', '.ts', '.wxss', '.wxs'])

let pass = 0
const fails = []
const ok = (name) => { pass += 1; console.log(`  ✓ ${name}`) }
const bad = (name, detail) => { fails.push(name); console.log(`  ✗ ${name} — ${detail}`) }

function readAt(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8')
}

function registeredOf(app) {
  return [
    ...(app.pages || []),
    ...(app.subpackages || app.subPackages || []).flatMap((pkg) => (pkg.pages || []).map((page) => `${pkg.root}/${page}`)),
  ]
}

function variantOf(root) {
  const matched = readAt(root, 'utils/build-variant.js').match(/VARIANT:\s*'([^']+)'/)
  const enabled = readAt(root, 'utils/build-variant.js').match(/AI_ENABLED:\s*(true|false)/)
  return { name: matched && matched[1], aiEnabled: enabled && enabled[1] === 'true' }
}

function checkDefinitions(all) {
  const full = all.full
  const noAi = all['no-ai']
  const problems = []
  if (!full || !noAi) problems.push('缺少 full 或 no-ai')
  else {
    if (JSON.stringify(full.aiPages) !== JSON.stringify(noAi.aiPages)) problems.push('两版 aiPages 不一致')
    if (full.primaryCategory !== '工具>办公' || noAi.primaryCategory !== '工具>办公') problems.push('主类目不是工具>办公')
    if (full.categories[0] !== full.primaryCategory || noAi.categories[0] !== noAi.primaryCategory) problems.push('主类目不在类目列表第一位')
    if (!full.categories.includes('深度合成>AI 问答') || !full.categories.includes('深度合成>AI 创作')) problems.push('完整版缺少深度合成类目')
    if (!noAi.categories.includes('工具>信息查询') || noAi.categories.length !== 2) problems.push('不含 AI 版类目应为两项')
    if (noAi.categories.some((item) => item.includes('AI') || item.includes('深度合成') || item.includes('大模型'))) problems.push('不含 AI 版类目含 AI 或深度合成')
    if (JSON.stringify(noAi.privacyCategories) !== JSON.stringify(full.privacyCategories.filter((item) => item !== '麦克风'))) {
      problems.push('不含 AI 版隐私分类不是完整版去掉麦克风')
    }
    if (full.tabs.length !== 4 || noAi.tabs.length !== 3) problems.push('Tab 数量不对')
  }
  if (problems.length) bad('版本定义', problems.join('；'))
  else ok('版本定义：两版类目、隐私分类与 aiPages')
}

function noteProblems(note) {
  const hits = []
  if (note.includes('AI')) hits.push('AI')
  if (note.includes('大模型')) hits.push('大模型')
  if (note.split('生成到机码').join('').includes('生成')) hits.push('生成')
  return hits
}

function checkNotes(all) {
  const fullHits = noteProblems(all.full.reviewNote)
  const noAiHits = noteProblems(all['no-ai'].reviewNote)
  if (!all.full.reviewNote.includes('AI 生成，仅供参考')) bad('完整版审核说明', '缺少「AI 生成，仅供参考」')
  else if (fullHits.includes('大模型') && all.full.reviewNote.includes('大模型')) ok('完整版审核说明含「AI 生成，仅供参考」')
  else ok('完整版审核说明含「AI 生成，仅供参考」')
  if (noAiHits.length) bad('不含 AI 版审核说明', `含有 ${noAiHits.join('、')}`)
  else ok('不含 AI 版审核说明不含「AI」「大模型」「生成」（生成到机码除外）')
}

function checkTree(root) {
  const variant = variantOf(root)
  const all = JSON.parse(readAt(root, 'review-variants/variants.json'))
  const spec = all[variant.name]
  if (!spec) {
    bad('当前版本', `无法识别 ${variant.name || '空'}`)
    return
  }
  if (variant.name === 'full' && !variant.aiEnabled) bad('版本开关', 'full 的 AI_ENABLED 应为 true')
  else if (variant.name === 'no-ai' && variant.aiEnabled) bad('版本开关', 'no-ai 的 AI_ENABLED 应为 false')
  else ok(`版本开关 ${variant.name} / AI_ENABLED=${variant.aiEnabled}`)

  const app = JSON.parse(readAt(root, 'app.json'))
  const registered = new Set(registeredOf(app))
  const ignored = ((JSON.parse(readAt(root, 'project.config.json')).packOptions || {}).ignore || [])
    .filter((entry) => entry && entry.type === 'folder').map((entry) => entry.value)
  const ignoredSet = new Set(ignored)
  const aiPages = spec.aiPages || []
  const parking = []
  for (const name of aiPages) {
    const page = `pages/${name}/${name}`
    const folder = `pages/${name}`
    const sourceMissing = ['js', 'wxml', 'wxss', 'json'].some((ext) => !fs.existsSync(path.join(root, `pages/${name}/${name}.${ext}`)))
    if (sourceMissing) parking.push(`${name} 源码缺失`)
    if (variant.name === 'no-ai') {
      if (registered.has(page)) parking.push(`${name} 仍注册`)
      if (!ignoredSet.has(folder)) parking.push(`${name} 未忽略`)
    } else if (!registered.has(page) || ignoredSet.has(folder)) {
      parking.push(`${name} 未在完整版注册或被忽略`)
    }
  }
  if (parking.length) bad('aiPages 停放状态', parking.join('；'))
  else ok(`aiPages 停放状态与 ${variant.name} 一致（${aiPages.length} 页）`)

  if (variant.name === 'no-ai') {
    const stashPath = path.join(root, 'review-variants/stash/project.config.json')
    if (!fs.existsSync(stashPath)) bad('ignore 只增减 aiPages', 'no-ai 缺少 stash，无法证明没改别的忽略项')
    else {
      const before = JSON.parse(fs.readFileSync(stashPath, 'utf8')).packOptions.ignore.map((entry) => `${entry.type}:${entry.value}`)
      const extra = aiPages.map((name) => `folder:pages/${name}`).filter((item) => !before.includes(item))
      const expect = before.concat(extra)
      const after = JSON.parse(readAt(root, 'project.config.json')).packOptions.ignore.map((entry) => `${entry.type}:${entry.value}`)
      if (after.join('|') !== expect.join('|')) bad('ignore 只增减 aiPages', 'packOptions.ignore 除 aiPages 外有变化')
      else ok('packOptions.ignore 只追加了 aiPages')
    }
  }

  const tabExpect = (spec.tabs || []).map((tab) => `${tab.pagePath}\t${tab.text}`)
  const tabActual = ((app.tabBar && app.tabBar.list) || []).map((tab) => `${tab.pagePath}\t${tab.text}`)
  const barItems = tabBarRows(root)
  const barExpect = (spec.tabs || []).map((tab) => `${tab.pagePath}\t${tab.text}\t${tab.icon}`)
  if (tabActual.join('|') !== tabExpect.join('|')) bad('app.json tabBar', tabActual.join(' | '))
  else if (barItems.join('|') !== barExpect.join('|')) bad('custom-tab-bar', barItems.join(' | '))
  else ok('tabBar 与版本定义一致')

  const declared = JSON.parse(readAt(root, 'scripts/privacy-api-inventory.json')).declared.map((item) => item.category)
  if (declared.join('|') !== (spec.privacyCategories || []).join('|')) bad('隐私分类', declared.join('、'))
  else ok('隐私清单分类与版本定义一致')

  if (variant.name === 'no-ai') {
    const hits = collectUnregisteredRouteRefs(root).filter((ref) => aiPages.some((name) => ref.includes(`/pages/${name}/${name}`)))
    if (hits.length) bad('no-ai 上传包不指向已收起页面', hits.join('；'))
    else ok('no-ai 上传包没有指向 aiPages 的写死路由')
  }

  checkAiRoutes(root, variant.name, aiPages)
}

function relOf(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/')
}

function walkFiles(root) {
  const out = []
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_WALK.has(entry.name)) continue
      const abs = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(abs)
      else out.push(abs)
    }
  }
  walk(root)
  return out
}

function aiRouteLiteralHits(root) {
  const hits = []
  for (const abs of walkFiles(root)) {
    const rel = relOf(root, abs)
    if (rel === 'utils/ai-entries.js') continue
    if (!rel.endsWith('.js') && !rel.endsWith('.wxml')) continue
    if (AI_ROUTE_RE.test(fs.readFileSync(abs, 'utf8'))) hits.push(rel)
  }
  return hits
}

function pathAssemblyHits(root) {
  const hits = []
  for (const abs of walkFiles(root)) {
    const rel = relOf(root, abs)
    if (rel.includes('page-path')) {
      hits.push(rel)
      continue
    }
    if (!TEXT_EXT.has(path.extname(rel))) continue
    const text = fs.readFileSync(abs, 'utf8')
    if (ASSEMBLY_RES.some((re) => re.test(text))) hits.push(rel)
  }
  return hits
}

function loadEntries(file) {
  return createRequire(file)(file)
}

function entryKeyProblems(fullFile, emptyFile) {
  const full = loadEntries(fullFile)
  const empty = loadEntries(emptyFile)
  const problems = []
  const fullKeys = Object.keys(full).sort()
  const emptyKeys = Object.keys(empty).sort()
  if (fullKeys.join('|') !== emptyKeys.join('|')) problems.push(`导出键不一致：${emptyKeys.join(',')}`)
  for (const key of emptyKeys) {
    const value = empty[key]
    if (typeof value === 'function') continue
    if (value === null || (Array.isArray(value) && value.length === 0)) continue
    problems.push(`${key} 不是空值`)
  }
  if (fs.readFileSync(emptyFile, 'utf8').includes('/pages/')) problems.push('空版本含页面路径字面量')
  return problems
}

function tabBarRows(root) {
  const bar = readAt(root, 'custom-tab-bar/index.js')
  let aiTab = ''
  try {
    aiTab = String(loadEntries(path.join(root, 'utils/ai-entries.js')).aiTab || '')
  } catch {
    aiTab = ''
  }
  return [...bar.matchAll(/pagePath:\s*(?:'([^']+)'|(aiTab)),\s*icon:\s*'([^']+)',\s*text:\s*'([^']+)'/g)]
    .map((item) => {
      const raw = item[1] || (item[2] ? aiTab : '')
      return `${String(raw).replace(/^\/+/, '')}\t${item[4]}\t${item[3]}`
    })
}

function checkAiRoutes(root, variantName, aiPages) {
  const entriesPath = path.join(root, 'utils/ai-entries.js')
  if (!fs.existsSync(entriesPath)) {
    bad('AI 路由集中', '缺少 utils/ai-entries.js')
    return
  }
  const entriesText = fs.readFileSync(entriesPath, 'utf8')
  const hits = aiRouteLiteralHits(root)
  const assembly = pathAssemblyHits(root)
  if (assembly.length) bad('禁止拼接页面路径', assembly.join('；'))
  else ok('没有 page-path，也没有拼接 /pages/ 路径')

  if (variantName === 'full') {
    const missing = aiPages.filter((name) => !entriesText.includes(`'/pages/${name}/${name}'`))
    if (missing.length) bad('完整版 AI 路由在 ai-entries.js', `缺少 ${missing.join('、')}`)
    else if (hits.length) bad('完整版页面不直写 AI 路由', hits.join('；'))
    else ok('完整版 AI 路由只在 utils/ai-entries.js')
  } else if (variantName === 'no-ai') {
    const stashed = path.join(root, 'review-variants/stash/utils/ai-entries.js')
    const problems = []
    if (AI_ROUTE_RE.test(entriesText) || entriesText.includes('/pages/')) problems.push('ai-entries.js 仍有页面路径')
    if (hits.length) problems.push(hits.join('；'))
    if (fs.existsSync(stashed)) problems.push(...entryKeyProblems(stashed, entriesPath))
    if (problems.length) bad('不含 AI 版没有 AI 路由字面量', problems.join('；'))
    else ok('不含 AI 版 js/wxml 没有指向 aiPages 的路由字面量')
  }
}

function copyMiniapp(dest) {
  fs.cpSync(ROOT, dest, {
    recursive: true,
    filter: (src) => {
      const base = path.basename(src)
      return base !== 'node_modules' && base !== '.git' && base !== '.claude' && base !== 'miniprogram_npm'
    },
  })
}

function checkMutations() {
  const leaked = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-variant-leak-'))
  const assembled = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-variant-asm-'))
  try {
    copyMiniapp(leaked)
    fs.appendFileSync(path.join(leaked, 'pages/home/home.js'), "\nconst leakedAiRoute = '/pages/assistant/assistant'\n")
    const leakedHits = aiRouteLiteralHits(leaked)
    if (!leakedHits.some((rel) => rel.endsWith('pages/home/home.js'))) bad('变异：页面里直写 AI 路由', '没有转红')
    else ok('变异：页面里直写 /pages/assistant/assistant 时门禁转红')

    copyMiniapp(assembled)
    fs.writeFileSync(path.join(assembled, 'utils/page-path.js'), "function pagePath(name) {\n  return '/pages/' + name + '/' + name\n}\nmodule.exports = { pagePath }\n")
    const assembledHits = pathAssemblyHits(assembled)
    if (!assembledHits.length) bad('变异：拼接页面路径', '没有转红')
    else ok('变异：page-path 拼接 /pages/ 时门禁转红')
  } finally {
    fs.rmSync(leaked, { recursive: true, force: true })
    fs.rmSync(assembled, { recursive: true, force: true })
  }
}

function runNode(cwd, args, env) {
  const result = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8' })
  return result
}

function checkRoundTrip() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-variant-'))
  try {
    copyMiniapp(tmp)
    const before = KEY_FILES.map((rel) => fs.readFileSync(path.join(tmp, rel)))
    const env = { ...process.env, MINIAPP_REVIEW_VARIANT_INNER: '1' }
    const generated = runNode(tmp, ['scripts/make-review-variant.mjs', '--variant', 'no-ai'])
    if (generated.status !== 0) {
      bad('临时副本生成 no-ai', `${generated.stdout || ''}\n${generated.stderr || ''}`.trim().split('\n').slice(-20).join('\n'))
      return
    }
    const commands = [
      ['scripts/verify-miniapp-static.mjs'],
      ['scripts/verify-review-scope.mjs'],
      ['scripts/verify-package-layout.mjs'],
      ['scripts/verify-review-variant.mjs'],
    ]
    for (const args of commands) {
      const result = runNode(tmp, args, env)
      if (result.status !== 0) {
        bad(`临时副本 ${args[0]}`, `${result.stdout || ''}\n${result.stderr || ''}`.trim().split('\n').slice(-25).join('\n'))
        return
      }
    }
    ok('临时副本 no-ai：static、review-scope、package-layout、本门禁 (a)(c)(d) 通过')
    const noAiEntries = path.join(tmp, 'utils/ai-entries.js')
    const stashedEntries = path.join(tmp, 'review-variants/stash/utils/ai-entries.js')
    const parity = entryKeyProblems(stashedEntries, noAiEntries)
    const noAiHits = aiRouteLiteralHits(tmp)
    if (parity.length || noAiHits.length) {
      bad('临时副本 no-ai 的 AI 路由', [...parity, ...noAiHits].join('；'))
      return
    }
    ok('临时副本 no-ai 的 ai-entries 与页面都没有 AI 路由字面量')
    const restored = runNode(tmp, ['scripts/make-review-variant.mjs', '--variant', 'full'])
    if (restored.status !== 0) {
      bad('临时副本还原 full', `${restored.stdout || ''}\n${restored.stderr || ''}`.trim().split('\n').slice(-20).join('\n'))
      return
    }
    const changed = KEY_FILES.filter((rel, index) => !before[index].equals(fs.readFileSync(path.join(tmp, rel))))
    if (changed.length) bad('full 逐字节还原', changed.join('、'))
    else if (fs.existsSync(path.join(tmp, 'review-variants/stash'))) bad('full 逐字节还原', 'stash 还在')
    else ok('no-ai 再 full 后关键文件与原件逐字节相同')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

const definitions = JSON.parse(readAt(ROOT, 'review-variants/variants.json'))
checkDefinitions(definitions)
checkNotes(definitions)
checkTree(ROOT)
if (!INNER && fails.length === 0) checkMutations()
if (!INNER && fails.length === 0) checkRoundTrip()

console.log(`\n${pass} PASS / ${fails.length} FAIL（提审版本）`)
if (fails.length) process.exit(1)
