#!/usr/bin/env node
/**
 * 小程序完整版 / 不含 AI 提审版一致性。
 *
 * (a) 当前目录的注册页、tab、隐私分类与 review-variants/variants.json 一致。
 * (b) 临时副本里生成 no-ai，再跑 static / review-scope / package-layout 和本门禁的 (a)；
 *     然后 --variant full 还原，关键文件与副本原件逐字节相同。
 * (c) no-ai 已注册页面的 wxml/js 不写死指向 aiPages 的路由（复用 verify-review-scope 的扫描）。
 * (d) no-ai 审核说明不含「AI」「大模型」「生成」（「生成到机码」是到机取件用语，先摘掉再查）；
 *     full 审核说明含「AI 生成，仅供参考」。
 *
 * 生成器：scripts/make-review-variant.mjs
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
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
]

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
  const bar = readAt(root, 'custom-tab-bar/index.js')
  const barItems = [...bar.matchAll(/pagePath:\s*'([^']+)',\s*icon:\s*'([^']+)',\s*text:\s*'([^']+)'/g)]
    .map((item) => `${item[1].replace(/^\/+/, '')}\t${item[3]}\t${item[2]}`)
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
}

function runNode(cwd, args, env) {
  const result = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8' })
  return result
}

function checkRoundTrip() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'miniapp-variant-'))
  try {
    fs.cpSync(ROOT, tmp, {
      recursive: true,
      filter: (src) => {
        const base = path.basename(src)
        return base !== 'node_modules' && base !== '.git' && base !== '.claude' && base !== 'miniprogram_npm'
      },
    })
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
if (!INNER && fails.length === 0) checkRoundTrip()

console.log(`\n${pass} PASS / ${fails.length} FAIL（提审版本）`)
if (fails.length) process.exit(1)
