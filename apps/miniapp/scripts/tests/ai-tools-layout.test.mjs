/**
 * AI 工具页重排（产品负责人 2026-11-03：按推荐）。
 *
 * 四组：准备简历、改进材料、练习面试、探索方向。
 * 小青在四组之前；AI 服务记录和我的文档在四组之后。
 * 入口一个不少。统一的「AI 生成，仅供参考」不覆盖材料模板，其余 AI 项仍覆盖。
 * 在 node:vm 里执行页面源码。由 verify:page-lifecycle 拉起。不发网络请求。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { instantiate, loadPageDefinition } from './page-sandbox.mjs'

const MINIAPP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// 重排前磁贴 id。重排后必须还是这一组，一个不能少，也不能多出一个同义入口。
const ENTRY_IDS = [
  'build', 'voice', 'diagnose', 'optimize', 'materials', 'documents',
  'match', 'interview', 'plan', 'explore',
]

const GROUP_TITLES = ['准备简历', '改进材料', '练习面试', '探索方向']
const GROUP_IDS = [
  ['build', 'voice', 'diagnose'],
  ['optimize', 'match', 'materials'],
  ['interview'],
  ['plan', 'explore'],
]
const GROUP_SUBS = [
  '从零填写、语音说，或上传后诊断',
  '改已有简历、对照要求，或按模板自己填',
  '按你填的目标出题，做完可以复盘',
  '方向建议和自我了解，只供参考',
]

// 名字、说明、图标、配色保持重排前的写法。这轮不改功能名。
const FIELDS = {
  build: { icon: 'plus', title: '生成简历', desc: '从零填写，AI 只润色不编造', accent: 'cyan' },
  voice: { icon: 'comment', title: '语音说简历', desc: '一题一问，看字确认再生成', accent: 'plum' },
  diagnose: { icon: 'file-search', title: '简历诊断', desc: '逐条给出问题与依据', accent: 'plum' },
  optimize: { icon: 'edit', title: '简历优化', desc: '改写前后对照可选用', accent: 'teal' },
  materials: { icon: 'form', title: '材料模板', desc: '自荐信、感谢信、材料清单', accent: 'wheat' },
  documents: { icon: 'folder', title: '我的文档', desc: '管理材料并再次打印', accent: 'clay' },
  match: { icon: 'link', title: '简历对照', desc: '粘贴岗位要求，看简历还差什么', accent: 'teal' },
  interview: { icon: 'comment', title: '模拟面试', desc: '按目标岗位出题并复盘', accent: 'plum' },
  plan: { icon: 'compass', title: '职业规划', desc: '方向建议仅供参考', accent: 'wheat' },
  explore: { icon: 'aim', title: '自我探索', desc: '五维倾向参考，非资格评定', accent: 'slate' },
}

const ROUTES = {
  build: '/pages/resume-build/resume-build',
  voice: '/pages/resume-voice/resume-voice',
  diagnose: '/pages/resume-diagnose/resume-diagnose',
  documents: '/pages/documents/documents',
  materials: '/pages/job-materials/job-materials',
  match: '/pages/job-fit/job-fit',
  interview: '/pages/interview-entry/interview-entry',
  explore: '/pages/self-explore/self-explore',
  plan: '/pages/career-plan/career-plan',
}

const AI_TITLES = [
  '生成简历', '语音说简历', '简历诊断', '简历优化', '简历对照',
  '模拟面试', '职业规划', '自我探索',
]

function loadAi(wx) {
  return loadPageDefinition('pages/ai/ai.js', {
    wx: wx || { navigateTo() {}, showModal() {} },
    modules: {},
  })
}

function sameList(actual, expected, label) {
  assert.equal(actual.length, expected.length, `${label} 个数`)
  for (let i = 0; i < expected.length; i += 1) {
    assert.equal(actual[i], expected[i], `${label}[${i}]`)
  }
}

function entryIds(data) {
  const ids = []
  for (let i = 0; i < data.groups.length; i += 1) {
    const items = data.groups[i].items
    for (let j = 0; j < items.length; j += 1) ids.push(items[j].id)
  }
  ids.push(data.documents.id)
  for (let i = 0; i < data.pending.length; i += 1) ids.push(data.pending[i].id)
  return ids
}

function visibleWxml() {
  const src = fs.readFileSync(path.join(MINIAPP, 'pages/ai/ai.wxml'), 'utf8')
  return src.replace(/<!--[\s\S]*?-->/g, '')
}

test('AI 工具页四组的名字、顺序和每组入口顺序', () => {
  const data = loadAi().data
  assert.equal(data.groups.length, 4)
  const titles = []
  const subs = []
  for (let i = 0; i < data.groups.length; i += 1) {
    titles.push(data.groups[i].title)
    subs.push(data.groups[i].sub)
    const ids = []
    for (let j = 0; j < data.groups[i].items.length; j += 1) ids.push(data.groups[i].items[j].id)
    sameList(ids, GROUP_IDS[i], data.groups[i].title)
  }
  sameList(titles, GROUP_TITLES, '组名')
  sameList(subs, GROUP_SUBS, '组说明')
})

test('重排前后入口 id 集合相同，名字说明图标配色不变', () => {
  const data = loadAi().data
  const ids = entryIds(data)
  assert.equal(new Set(ids).size, ids.length, '入口 id 不能重复')
  sameList([...ids].sort(), [...ENTRY_IDS].sort(), '入口 id')
  for (let i = 0; i < data.groups.length; i += 1) {
    const items = data.groups[i].items
    for (let j = 0; j < items.length; j += 1) {
      const item = items[j]
      const expect = FIELDS[item.id]
      assert.ok(expect, item.id)
      assert.equal(item.icon, expect.icon, item.id)
      assert.equal(item.title, expect.title, item.id)
      assert.equal(item.desc, expect.desc, item.id)
      assert.equal(item.accent, expect.accent, item.id)
    }
  }
  const doc = data.documents
  assert.equal(doc.icon, FIELDS.documents.icon)
  assert.equal(doc.title, FIELDS.documents.title)
  assert.equal(doc.desc, FIELDS.documents.desc)
  assert.equal(doc.accent, FIELDS.documents.accent)
  for (let i = 0; i < data.groups.length; i += 1) {
    const items = data.groups[i].items
    for (let j = 0; j < items.length; j += 1) {
      assert.notEqual(items[j].id, 'documents', '我的文档不在四组磁贴里')
    }
  }
})

test('小青在四组之前，AI 服务记录和我的文档在四组之后', () => {
  const wxml = visibleWxml()
  const xiaoqing = wxml.indexOf('bindtap="tapChat"')
  const groupsAt = wxml.indexOf('wx:for="{{groups}}"')
  const groupsEnd = wxml.indexOf('</block>', groupsAt)
  const records = wxml.indexOf('bindtap="toRecords"')
  const documents = wxml.indexOf('data-id="{{documents.id}}"')
  assert.ok(xiaoqing >= 0, '页面要有问小青的入口')
  assert.ok(groupsAt > xiaoqing, '小青要在四组之前')
  assert.ok(groupsEnd > groupsAt, '四组要包在一组循环里')
  assert.ok(records > groupsEnd, 'AI 服务记录要在四组之后')
  assert.ok(documents > records, '我的文档要在 AI 服务记录之后、四组之后')
  assert.equal(wxml.split('bindtap="tapChat"').length - 1, 1, '小青只留一个入口')
  assert.equal(wxml.split('bindtap="toRecords"').length - 1, 1, 'AI 服务记录只留一个入口')
  assert.equal(wxml.split('data-id="{{documents.id}}"').length - 1, 1, '我的文档只留一个入口')
  assert.ok(wxml.slice(groupsAt, groupsEnd).indexOf('documents') < 0, '四组循环里不再放我的文档')
})

test('我的文档磁贴与上面的记录卡之间用现有间距类拉开', () => {
  const wxml = visibleWxml()
  const records = wxml.indexOf('bindtap="toRecords"')
  const documents = wxml.indexOf('data-id="{{documents.id}}"')
  const between = wxml.slice(records, documents)
  assert.match(between, /<view class="tiles mt12">/, '我的文档所在磁贴要用现有 mt12，与本页卡片 12px 间距一致')
})

test('统一 AI 声明不覆盖材料模板，仍覆盖其余 AI 项和小青', () => {
  const data = loadAi().data
  const wxml = visibleWxml()
  const discAt = wxml.indexOf('class="as-disc"')
  const discEnd = wxml.indexOf('</view>', discAt)
  const disc = wxml.slice(discAt, discEnd)
  assert.match(disc, /\{\{aiNotice\}\}/, '声明条要显示页上的统一那句')
  assert.doesNotMatch(wxml, /下面各项结果都由 AI 生成/)

  const notice = data.aiNotice
  const parts = String(notice).split('。').map((s) => s.trim()).filter(Boolean)
  assert.equal(parts.length, 2, '声明分两句：AI 各项一句，材料模板一句')
  const aiPart = parts[0]
  const templatePart = parts[1]
  assert.match(aiPart, /^AI 生成，仅供参考：/)
  assert.match(aiPart, /小青的回答/)
  assert.match(aiPart, /都由 AI 生成，可能有错，请核对后再用/)
  assert.doesNotMatch(aiPart, /材料模板/)
  for (let i = 0; i < AI_TITLES.length; i += 1) {
    assert.ok(aiPart.includes(AI_TITLES[i]), `声明应覆盖${AI_TITLES[i]}`)
  }
  assert.equal(templatePart, '材料模板由你自己填写、按模板排版，不经过 AI')
  assert.doesNotMatch(templatePart, /AI 生成|由 AI/)

  const materials = data.groups[1].items[2]
  assert.equal(materials.id, 'materials')
  assert.doesNotMatch(materials.title + materials.desc, /AI/)
})

test('各入口仍跳到原来的页面，小青和记录也不改去向', () => {
  const urls = []
  const def = loadAi({
    navigateTo(opt) { urls.push(opt.url) },
    showModal() {},
  })
  const page = instantiate(def)
  const ids = Object.keys(ROUTES)
  for (let i = 0; i < ids.length; i += 1) {
    page.tapEntry({ currentTarget: { dataset: { id: ids[i] } } })
  }
  sameList(urls, ids.map((id) => ROUTES[id]), '跳转')
  page.tapChat()
  page.toRecords()
  assert.equal(urls[urls.length - 2], '/pages/assistant/assistant')
  assert.equal(urls[urls.length - 1], '/pages/ai-records/ai-records')
})
