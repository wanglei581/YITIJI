import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const repoRoot = join(kioskRoot, '../..')
const cache = new Map()
const loadTs = (absPath) => {
  if (cache.has(absPath)) return cache.get(absPath)
  const output = ts.transpileModule(readFileSync(absPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const loaded = { exports: {} }
  cache.set(absPath, loaded)
  const dir = dirname(absPath)
  const localRequire = (id) => {
    if (!id.startsWith('.')) throw new Error(`unexpected require ${id}`)
    return loadTs(join(dir, id.endsWith('.ts') ? id : `${id}.ts`)).exports
  }
  new Function('exports', 'module', 'require', output)(loaded.exports, loaded, localRequire)
  return loaded
}

const rule = loadTs(join(kioskRoot, 'src/pages/resume/components/resume-deliver/factAdditionsRule.ts')).exports
const facts = loadTs(join(kioskRoot, 'src/pages/resume/components/resume-deliver/facts.ts')).exports
const { findFactAdditions } = rule
const { detectUnconfirmedAdditions, detectGeneratedUnconfirmedAdditions, detectUserResumeEdits } = facts

const kioskRulePath = join(kioskRoot, 'src/pages/resume/components/resume-deliver/factAdditionsRule.ts')
const apiRulePath = join(repoRoot, 'services/api/src/ai/resume/resume-fact-additions-rule.ts')

const FALSE_PHRASES = [
  '一起', '一直', '一定', '一些', '一般', '一样', '一切', '一致', '一体', '一线', '一流',
  '一贯', '一向', '一旦', '一同', '一再', '一律', '一下', '一边', '一方面', '进一步',
  '统一', '唯一', '同一', '单一', '之一', '万一', '第一时间',
]

const DUTY_WORDS = [
  '主导', '负责', '牵头', '带领', '领导', '管理', '统筹', '主持', '组建',
  '独立完成', '独立负责', '全面负责', '季度之星',
]

function keysOf(after, before) {
  return findFactAdditions(after, before).map((item) => item.key)
}

test('两份规则文件逐字节相同', () => {
  const left = readFileSync(kioskRulePath)
  const right = readFileSync(apiRulePath)
  assert.equal(left.equals(right), true)
  assert.equal(left.length > 0, true)
})

test('数字按完整数值比，不按子串', () => {
  const raised = findFactAdditions('提升 20%', '2020年')
  assert.deepEqual(raised.map((item) => item.key), ['pct:20'])
  assert.equal(raised[0].text.includes('20%'), true)

  assert.deepEqual(findFactAdditions('2020年', '2020年'), [])
  assert.deepEqual(findFactAdditions('20人', '20 人'), [])
  assert.deepEqual(findFactAdditions('1500', '1,500'), [])
  assert.deepEqual(findFactAdditions('20', '２０'), [])
  assert.deepEqual(findFactAdditions('2.5', '2.50'), [])
  assert.deepEqual(findFactAdditions('5', '05'), [])
  assert.deepEqual(keysOf('提升 20%', '20 人'), ['pct:20'])
})

test('中文数字和阿拉伯数字按数值放在一起比', () => {
  const team = findFactAdditions('带领十人团队', '写过一段社团经历')
  assert.equal(team.some((item) => item.key === 'num:10' && item.text.includes('十人')), true)
  assert.deepEqual(findFactAdditions('三年', '3年'), [])
  assert.deepEqual(findFactAdditions('2场', '两场'), [])
  assert.deepEqual(findFactAdditions('20%', '百分之二十'), [])
  assert.deepEqual(findFactAdditions('百分之二十', '20%'), [])
})

test('防误报词、一个和一份都不算数', () => {
  for (const phrase of FALSE_PHRASES) {
    assert.deepEqual(findFactAdditions(`这里提到${phrase}就好`, ''), [], phrase)
  }
  assert.deepEqual(findFactAdditions('完成一个作品和一份总结', ''), [])
  assert.deepEqual(findFactAdditions('找到一名同学和一位老师', ''), [])
  assert.deepEqual(findFactAdditions('准备一种材料', ''), [])
})

test('一年、一等奖、第一名在原文没有时要报', () => {
  assert.equal(findFactAdditions('一年', '没有年限').some((item) => item.key === 'num:1'), true)
  assert.equal(findFactAdditions('获得一等奖', '').some((item) => item.key === 'num:1' && item.text.includes('一等')), true)
  assert.equal(findFactAdditions('拿到第一名', '').some((item) => item.key === 'num:1' && item.text.includes('第一名')), true)
})

test('职责词原文没有就报，原文有就不报；独立负责只报一次', () => {
  for (const word of DUTY_WORDS) {
    const added = findFactAdditions(`本学期${word}活动`, '')
    assert.equal(added.some((item) => item.key === `duty:${word}`), true, word)
    const kept = findFactAdditions(`本学期${word}活动`, `早前${word}过`)
    assert.equal(kept.some((item) => item.key === `duty:${word}`), false, word)
  }
  const once = findFactAdditions('他独立负责整个项目。', '')
  assert.deepEqual(once.map((item) => item.key), ['duty:独立负责'])
})

test('周更 2 篇的片段恰好停在标点上', () => {
  const hits = findFactAdditions(
    '负责学院公众号的选题、撰写和排版，周更 2 篇。',
    '负责学院公众号的选题、撰写和排版。',
  )
  assert.deepEqual(hits, [{ key: 'num:2', text: '周更 2 篇' }])
})

function resumeWith(description, skills = []) {
  return {
    basic: { name: '周晴', phone: '', city: '青岛' },
    intention: { position: '新媒体运营', city: '青岛' },
    summary: '',
    education: [],
    experience: [{
      company: '青岛大学学生会',
      role: '宣传部干事',
      period: '2023-2025',
      description,
    }],
    projects: [],
    skills,
    certificates: [],
  }
}

const originalInput = resumeWith('负责学院公众号的选题、撰写和排版。')

test('本人改了数字旁边的字，这个数仍要确认', () => {
  const generated = resumeWith('负责学院公众号的选题、撰写和排版，周更 2 篇。')
  const edited = resumeWith('负责学院公众号的选题、撰写和排版，每周更新 2 篇。')
  const hits = detectGeneratedUnconfirmedAdditions(edited, generated, originalInput, [])
  assert.equal(hits.some((text) => text.includes('2')), true)
})

test('本人自己新写的数不算 AI 新增', () => {
  const generated = resumeWith('负责学院公众号的选题、撰写和排版，周更 2 篇。')
  const cleared = resumeWith('负责学院公众号的选题、撰写和排版。')
  const retyped = resumeWith('负责学院公众号的选题、撰写和排版，一共写过 2 篇。')
  const userAdditions = detectUserResumeEdits(cleared, retyped)
  assert.equal(userAdditions.some((text) => text.includes('2')), true)
  const hits = detectGeneratedUnconfirmedAdditions(retyped, generated, originalInput, userAdditions)
  assert.equal(hits.some((text) => text.includes('2')), false)
})

test('技能里 AI 新写的数字也要确认', () => {
  const modules = [{
    title: '经历',
    before: '负责学院公众号的选题、撰写和排版。',
    after: '负责学院公众号的选题、撰写和排版。',
    category: 'experience',
  }]
  const resume = resumeWith('负责学院公众号的选题、撰写和排版。', ['熟练使用 5 种工具'])
  const hits = detectUnconfirmedAdditions(resume, modules)
  assert.equal(hits.some((text) => text.includes('5')), true)
  assert.equal(hits.some((text) => text.includes('负责')), false)
})
