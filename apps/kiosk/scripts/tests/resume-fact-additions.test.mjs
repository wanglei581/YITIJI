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

test('一侧超过 10 个字还没遇到标点时加省略号', () => {
  const hits = findFactAdditions(
    '甲乙丙丁戊己庚辛壬癸子丑寅卯 88 辰巳午未申酉戌亥甲乙丙。',
    '',
  )
  assert.deepEqual(hits, [{ key: 'num:88', text: '…己庚辛壬癸子丑寅卯 88 辰巳午未申酉戌亥甲…' }])
})

test('相邻的职责词和中文数字合成同一个片段，仍返回两项', () => {
  const hits = findFactAdditions('带领十人团队', '')
  assert.equal(hits.length, 2)
  assert.deepEqual(hits.map((item) => item.key), ['duty:带领', 'num:10'])
  assert.equal(hits[0].text, hits[1].text)
  assert.equal(hits[0].text, '带领十人团队')
  const shown = facts.detectUnconfirmedTextAdditions('带领十人团队', '')
  assert.deepEqual(shown, ['带领十人团队'])
})

test('夹在两条事实中间的负责不再只剩两个字', () => {
  const hits = findFactAdditions('上周店长主导夜班负责三家门店。', '')
  assert.equal(hits.some((item) => item.text === '负责'), false)
  const row = hits.find((item) => item.key === 'duty:负责')
  assert.ok(row)
  assert.equal(row.text.includes('主导'), true)
  assert.equal(row.text.includes('负责'), true)
  assert.equal(row.text.includes('三'), true)
  assert.equal(hits.every((item) => item.text === row.text), true)
})

test('纯数字子串：周更 20 篇对原文 2020年要报', () => {
  const hits = findFactAdditions('周更 20 篇。', '2020年入学。')
  assert.deepEqual(hits.map((item) => item.key), ['num:20'])
  assert.equal(hits[0].text, '周更 20 篇')
})

test('一个月要报，一个一份一种一名一位仍不报', () => {
  const month = findFactAdditions('干了一个月。', '')
  assert.equal(month.some((item) => item.key === 'num:1' && item.text.includes('一个月')), true)
  assert.deepEqual(findFactAdditions('完成一个作品和一份总结', ''), [])
  assert.deepEqual(findFactAdditions('找到一名同学和一位老师', ''), [])
  assert.deepEqual(findFactAdditions('准备一种材料', ''), [])
})

test('专业第一和全系第二要报，第一次第一步第一阶段第一年不报', () => {
  assert.equal(findFactAdditions('专业第一', '').some((item) => item.key === 'num:1'), true)
  assert.equal(findFactAdditions('全系第二。', '').some((item) => item.key === 'num:2'), true)
  assert.deepEqual(findFactAdditions('第一次参加。', ''), [])
  assert.deepEqual(findFactAdditions('第一步就停下。', ''), [])
  assert.deepEqual(findFactAdditions('第一阶段完成。', ''), [])
  assert.deepEqual(findFactAdditions('第一年没有排名。', ''), [])
  assert.deepEqual(findFactAdditions('第一时间赶到。', ''), [])
})

test('长整数按字符串比，0.0001 不等于 0', () => {
  const left = '110101199001011234'
  const right = '110101199001011235'
  const hits = findFactAdditions(`证件 ${left}`, `证件 ${right}`)
  assert.deepEqual(hits.map((item) => item.key), [`num:${left}`])
  assert.deepEqual(findFactAdditions('误差 0.0001', '误差 0').map((item) => item.key), ['num:0.0001'])
  assert.deepEqual(findFactAdditions('0.000100', '0.0001'), [])
})

test('300万等于三百万，两千五百万等于 25000000', () => {
  assert.deepEqual(findFactAdditions('今年 300万。', '今年三百万。'), [])
  assert.deepEqual(findFactAdditions('1.5万', '15000'), [])
  assert.deepEqual(findFactAdditions('两千五百万', '25000000'), [])
  assert.deepEqual(findFactAdditions('三亿五千万', '350000000'), [])
  assert.deepEqual(findFactAdditions('一万零五', '10005'), [])
  assert.deepEqual(keysOf('300万', '300'), ['num:3000000'])
})

function resumeFields({ summary = '', education = '', experience = '', project = '', skills = [] }) {
  return {
    basic: { name: '周晴', phone: '', city: '青岛' },
    intention: { position: '运营', city: '青岛' },
    summary,
    education: [{ school: '青岛大学', major: '新闻', degree: '本科', period: '2020-2024', description: education }],
    experience: [{ company: '学生会', role: '干事', period: '2023-2025', description: experience }],
    projects: [{ name: '项目', role: '成员', description: project }],
    skills,
    certificates: [],
  }
}

test('教育里本人写的 2 不豁免经历里 AI 的 2', () => {
  const input = resumeFields({ education: '完成本科学业。', experience: '负责排版。' })
  const generated = resumeFields({ education: '完成本科学业。', experience: '负责排版，周更 2 篇。' })
  const edited = resumeFields({ education: '读了 2 年。', experience: '负责排版，周更 2 篇。' })
  const userAdditions = detectUserResumeEdits(generated, edited)
  assert.equal(userAdditions.some((token) => token.includes('education:name:青岛大学') && token.includes('num:2')), true)
  const hits = detectGeneratedUnconfirmedAdditions(edited, generated, input, userAdditions)
  assert.equal(hits.some((text) => text.includes('周更')), true)
  assert.equal(hits.some((text) => text.includes('读了')), false)
})

test('项目里本人写的 2 不算 AI 新增', () => {
  const input = resumeFields({ experience: '负责排版。', project: '参与一个活动。' })
  const generated = resumeFields({ experience: '负责排版，周更 2 篇。', project: '参与一个活动。' })
  const edited = resumeFields({ experience: '负责排版，周更 2 篇。', project: '主持 2 个项目。' })
  const userAdditions = detectUserResumeEdits(generated, edited)
  const hits = detectGeneratedUnconfirmedAdditions(edited, generated, input, userAdditions)
  assert.equal(hits.some((text) => text.includes('主持')), false)
  assert.equal(hits.some((text) => text.includes('周更')), true)
})

test('同一字段里本人在 AI 的数旁边再写一个数，AI 那个仍要确认', () => {
  const generated = resumeWith('负责学院公众号的选题、撰写和排版，周更 2 篇。')
  const edited = resumeWith('负责学院公众号的选题、撰写和排版，周更 2 篇，另记 3 项。')
  const userAdditions = detectUserResumeEdits(generated, edited)
  assert.equal(userAdditions.some((token) => token.includes('num:3')), true)
  assert.equal(userAdditions.some((token) => token.includes('num:2')), false)
  const hits = detectGeneratedUnconfirmedAdditions(edited, generated, originalInput, userAdditions)
  assert.equal(hits.some((text) => text.includes('2')), true)
  assert.equal(hits.some((text) => text.includes('3')), false)
})

test('技能里本人把数字敲回去不算 AI 新增', () => {
  const generated = resumeWith('负责学院公众号的选题、撰写和排版。', ['熟练使用 5 种工具'])
  const cleared = resumeWith('负责学院公众号的选题、撰写和排版。', ['熟练使用工具'])
  const retyped = resumeWith('负责学院公众号的选题、撰写和排版。', ['熟练使用 5 种工具'])
  const userAdditions = detectUserResumeEdits(cleared, retyped)
  assert.equal(userAdditions.some((token) => token.startsWith('field:skill:') && token.includes('num:5')), true)
  const hits = detectGeneratedUnconfirmedAdditions(retyped, generated, originalInput, userAdditions)
  assert.equal(hits.some((text) => text.includes('5')), false)
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

function shellResume(experience, skills = []) {
  return {
    basic: { name: '周晴', phone: '', city: '青岛' },
    intention: { position: '新媒体运营', city: '青岛' },
    summary: '',
    education: [],
    experience,
    projects: [],
    skills,
    certificates: [],
  }
}

const frontExp = {
  company: '青岛大学学生会',
  role: '宣传部干事',
  period: '2022-2023',
  description: '负责学院公众号的选题、撰写和排版。',
}
const backExp = {
  company: '青岛海边书店',
  role: '店员',
  period: '2023-2024',
  description: '负责门店陈列，周更 2 篇。',
}
const twoExperienceInput = shellResume([
  frontExp,
  { ...backExp, description: '负责门店陈列。' },
])
const twoExperienceGenerated = shellResume([frontExp, backExp])

test('删掉前段经历后，后段 AI 加的数字仍待确认', () => {
  const edited = shellResume([backExp])
  const userAdditions = detectUserResumeEdits(twoExperienceGenerated, edited)
  const hits = detectGeneratedUnconfirmedAdditions(edited, twoExperienceGenerated, twoExperienceInput, userAdditions)
  assert.equal(hits.some((text) => text.includes('周更') && text.includes('2')), true)
})

test('两段经历对调顺序，待确认结果不变', () => {
  const swapped = shellResume([backExp, frontExp])
  const kept = detectGeneratedUnconfirmedAdditions(twoExperienceGenerated, twoExperienceGenerated, twoExperienceInput, [])
  const hits = detectGeneratedUnconfirmedAdditions(swapped, twoExperienceGenerated, twoExperienceInput, [])
  assert.deepEqual([...hits].sort(), [...kept].sort())
  assert.equal(hits.some((text) => text.includes('周更') && text.includes('2')), true)
})

test('删掉一项技能后，剩下的 AI 数字仍待确认，本人敲的免确认', () => {
  const input = shellResume([frontExp], ['沟通协调', '熟练使用工具'])
  const generated = shellResume([frontExp], ['沟通协调', '熟练使用 5 种工具'])
  const edited = shellResume([frontExp], ['熟练使用 5 种工具', '会用 3 种排版'])
  const userAdditions = detectUserResumeEdits(generated, edited)
  const hits = detectGeneratedUnconfirmedAdditions(edited, generated, input, userAdditions)
  assert.equal(hits.some((text) => text.includes('5')), true)
  assert.equal(hits.some((text) => text.includes('3')), false)
})

test('公司名和描述都对不上的条目，里面的数字都待确认', () => {
  const input = shellResume([frontExp])
  const generated = shellResume([frontExp])
  const edited = shellResume([{
    company: '夜班仓库',
    role: '理货',
    period: '2024-2025',
    description: '独立完成夜间盘点三千件。',
  }])
  const userAdditions = detectUserResumeEdits(generated, edited)
  const hits = detectGeneratedUnconfirmedAdditions(edited, generated, input, userAdditions)
  assert.equal(hits.some((text) => text.includes('三千')), true)
  assert.equal(hits.some((text) => text.includes('独立完成')), true)
})

test('公司名改了但描述几乎一样时仍按描述配对，本人新写的数免确认', () => {
  const input = shellResume([{ ...backExp, description: '负责门店陈列。' }])
  const generated = shellResume([backExp])
  const edited = shellResume([{
    ...backExp,
    company: '海边书店改名',
    description: '负责门店陈列，周更 2 篇，另记 3 项。',
  }])
  const userAdditions = detectUserResumeEdits(generated, edited)
  assert.equal(userAdditions.some((token) => token.includes('num:3')), true)
  assert.equal(userAdditions.some((token) => token.includes('num:2')), false)
  const hits = detectGeneratedUnconfirmedAdditions(edited, generated, input, userAdditions)
  assert.equal(hits.some((text) => text.includes('周更') && text.includes('2')), true)
  assert.equal(hits.some((text) => text.includes('3')), false)
})

test('条目上有 id 时按 id 对齐，改了公司名也不放过 AI 的数字', () => {
  const plain = { ...backExp, description: '负责门店陈列。' }
  const generated = shellResume([{ ...backExp, id: 'exp-b' }])
  const input = shellResume([{ ...plain, id: 'exp-b' }])
  const edited = shellResume([{
    ...backExp,
    id: 'exp-b',
    company: '另一块招牌',
    role: '店长',
    description: '负责门店陈列，周更 2 篇。',
  }])
  const userAdditions = detectUserResumeEdits(generated, edited)
  const hits = detectGeneratedUnconfirmedAdditions(edited, generated, input, userAdditions)
  assert.equal(hits.some((text) => text.includes('周更') && text.includes('2')), true)
})

test('口语省略位按下一单位读，一万零二仍是 10002', () => {
  assert.deepEqual(findFactAdditions('月薪一万二。', '月薪 12000。'), [])
  assert.deepEqual(findFactAdditions('月薪三千五。', '月薪 3500。'), [])
  assert.deepEqual(findFactAdditions('奖金两百五。', '奖金 250。'), [])
  assert.deepEqual(findFactAdditions('月薪一万二千。', '月薪 12000。'), [])
  assert.deepEqual(findFactAdditions('月薪 1万2。', '月薪 12000。'), [])
  assert.deepEqual(findFactAdditions('月薪一万零二。', '月薪 10002。'), [])
  assert.deepEqual(keysOf('一万二', '10002'), ['num:12000'])
})
