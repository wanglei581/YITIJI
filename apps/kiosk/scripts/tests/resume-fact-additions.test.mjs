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
const { detectUnconfirmedAdditions, detectGeneratedUnconfirmedAdditions, detectUserResumeEdits, previewUserEditTokens } = facts
const entryIndex = loadTs(join(kioskRoot, 'src/pages/resume/components/resume-deliver/generatedEntryIndex.ts')).exports
const { stampGeneratedEntryIndexes, copyEntryFields, readGeneratedEntryIndex } = entryIndex
const { replaceResumeText } = loadTs(join(kioskRoot, 'src/pages/resume/components/resume-deliver/resumeDecisions.ts')).exports

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
  const userAdditions = detectUserResumeEdits(cleared, retyped, cleared)
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
  const userAdditions = detectUserResumeEdits(generated, edited, generated)
  assert.equal(userAdditions.some((token) => token.includes('education:name:青岛大学') && token.includes('num:2')), true)
  const hits = detectGeneratedUnconfirmedAdditions(edited, generated, input, userAdditions)
  assert.equal(hits.some((text) => text.includes('周更')), true)
  assert.equal(hits.some((text) => text.includes('读了')), false)
})

test('项目里本人写的 2 不算 AI 新增', () => {
  const input = resumeFields({ experience: '负责排版。', project: '参与一个活动。' })
  const generated = resumeFields({ experience: '负责排版，周更 2 篇。', project: '参与一个活动。' })
  const edited = resumeFields({ experience: '负责排版，周更 2 篇。', project: '主持 2 个项目。' })
  const userAdditions = detectUserResumeEdits(generated, edited, generated)
  const hits = detectGeneratedUnconfirmedAdditions(edited, generated, input, userAdditions)
  assert.equal(hits.some((text) => text.includes('主持')), false)
  assert.equal(hits.some((text) => text.includes('周更')), true)
})

test('同一字段里本人在 AI 的数旁边再写一个数，AI 那个仍要确认', () => {
  const generated = resumeWith('负责学院公众号的选题、撰写和排版，周更 2 篇。')
  const edited = resumeWith('负责学院公众号的选题、撰写和排版，周更 2 篇，另记 3 项。')
  const userAdditions = detectUserResumeEdits(generated, edited, generated)
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
  const userAdditions = detectUserResumeEdits(cleared, retyped, cleared)
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
  const userAdditions = detectUserResumeEdits(twoExperienceGenerated, edited, twoExperienceGenerated)
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
  const userAdditions = detectUserResumeEdits(generated, edited, generated)
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
  const userAdditions = detectUserResumeEdits(generated, edited, generated)
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
  const userAdditions = detectUserResumeEdits(generated, edited, generated)
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
  const userAdditions = detectUserResumeEdits(generated, edited, generated)
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
  assert.deepEqual(findFactAdditions('月薪1万2', '月薪12000'), [])
  assert.deepEqual(findFactAdditions('预算3千5', '预算3500'), [])
  assert.deepEqual(keysOf('3千5', ''), ['num:3500'])
  assert.deepEqual(keysOf('到账1万2', '账上有 10000 和 2'), ['num:12000'])
  assert.deepEqual(findFactAdditions('到账1万2', '账上有 12000'), [])
})

const sharedShelf = '完成门店陈列、补货、闭店卫生和每日台账交接。'

test('同名同职务两段里，本人在第 1 段加的同一个数不豁免第 2 段', () => {
  const company = { company: '青岛海边书店', role: '店员', period: '2019-2021' }
  const plain = { ...company, description: sharedShelf }
  const aiLine = { ...company, description: `${sharedShelf.slice(0, -1)}，周更 2 篇。` }
  const userLine = { ...company, description: `${sharedShelf.slice(0, -1)}，另记 2 项。` }
  const input = shellResume([plain, plain])
  const generated = shellResume([plain, aiLine])
  const edited = shellResume([userLine, aiLine])
  const userAdditions = detectUserResumeEdits(generated, edited, generated)
  assert.equal(userAdditions.some((token) => token.includes('同名1') && token.includes('num:2')), true)
  assert.equal(userAdditions.some((token) => token.includes('同名2') && token.includes('num:2')), false)
  const hits = detectGeneratedUnconfirmedAdditions(edited, generated, input, userAdditions)
  assert.equal(hits.some((text) => text.includes('周更') && text.includes('2')), true)
  assert.equal(hits.some((text) => text.includes('另记')), false)
})

test('同名同职务两段里，本人在第 1 段加的同一个职责词不豁免第 2 段', () => {
  const company = { company: '青岛海边书店', role: '店员', period: '2019-2021' }
  const plain = { ...company, description: sharedShelf }
  const aiLine = { ...company, description: `${sharedShelf.slice(0, -1)}，并牵头夜班交接。` }
  const userLine = { ...company, description: `牵头${sharedShelf}` }
  const input = shellResume([plain, plain])
  const generated = shellResume([plain, aiLine])
  const edited = shellResume([userLine, aiLine])
  const userAdditions = detectUserResumeEdits(generated, edited, generated)
  assert.equal(userAdditions.some((token) => token.includes('同名1') && token.includes('duty:牵头')), true)
  assert.equal(userAdditions.some((token) => token.includes('同名2') && token.includes('duty:牵头')), false)
  const hits = detectGeneratedUnconfirmedAdditions(edited, generated, input, userAdditions)
  assert.equal(hits.some((text) => text.includes('夜班') && text.includes('牵头')), true)
  assert.equal(hits.some((text) => text.startsWith('牵头完成')), false)
})

test('技能里只改数字旁边的字，AI 写的数字仍待确认；本人新写的数免确认', () => {
  const input = shellResume([frontExp], ['沟通协调'])
  const generated = shellResume([frontExp], ['Excel 数据透视（3 年）'])
  const edited = shellResume([frontExp], ['Excel 数据透视熟练（3 年）', '叉车证 2 年'])
  const userAdditions = detectUserResumeEdits(generated, edited, generated)
  assert.equal(userAdditions.some((token) => token.includes('num:3')), false)
  assert.equal(userAdditions.some((token) => token.includes('num:2')), true)
  const hits = detectGeneratedUnconfirmedAdditions(edited, generated, input, userAdditions)
  assert.equal(hits.some((text) => text.includes('3')), true)
  assert.equal(hits.some((text) => text.includes('2')), false)
})

test('套话相似度低于 0.72 时不把另一段配上来，AI 的数字仍待确认', () => {
  // 「负责日常工作，整理货架和台账。」对「负责日常运营，整理货架和台账，周更 2 篇。」实算 Dice 0.6061。
  // 夜班那句对第二句只有 0.1364。门槛降到 0.5 会配上前一句，把 2 豁免掉。
  const plain = '负责日常工作，整理货架和台账。'
  const near = '负责日常运营，整理货架和台账，周更 2 篇。'
  const far = '在夜班仓库独立核对入库清单，把差异写成周更 2 篇汇报。'
  const input = shellResume([
    { company: '海风便利', role: '店员', period: '2019-2021', description: plain },
    { company: '山海超市', role: '理货', period: '2018-2020', description: '在夜班仓库独立核对入库清单，把差异写成汇报。' },
  ])
  const generated = shellResume([
    { company: '海风便利', role: '店员', period: '2019-2021', description: plain },
    { company: '山海超市', role: '理货', period: '2018-2020', description: far },
  ])
  const edited = shellResume([
    { company: '东岸分拣点', role: '分拣', period: '2019-2021', description: near },
    { company: '西街花店', role: '店员', period: '2017-2018', description: '接待订花顾客并按花材颜色分区摆放。' },
  ])
  const userAdditions = detectUserResumeEdits(generated, edited, generated)
  const hits = detectGeneratedUnconfirmedAdditions(edited, generated, input, userAdditions)
  assert.equal(hits.some((text) => text.includes('周更') && text.includes('2')), true)
})

test('百分点、千分之里的百和千不是单位', () => {
  assert.deepEqual(keysOf('增长1百分点', ''), ['num:1'])
  assert.deepEqual(keysOf('降低3千分之', ''), ['num:3'])
  assert.equal(findFactAdditions('增长1百分点', '原稿写了 100').length, 1)
  assert.deepEqual(findFactAdditions('增长1百分点', '原稿写了 1'), [])
  assert.equal(findFactAdditions('降低3千分之', '原稿写了 3000').length, 1)
  assert.deepEqual(findFactAdditions('降低3千分之', '原稿写了 3'), [])
  assert.deepEqual(keysOf('5百', ''), ['num:500'])
  assert.deepEqual(keysOf('3千万', ''), ['num:30000000'])
  assert.deepEqual(findFactAdditions('第3百货', ''), [])
})

test('多单位逐级变小合成一个数，单位变大就拆开', () => {
  assert.deepEqual(keysOf('3千5百', ''), ['num:3500'])
  assert.deepEqual(keysOf('1万2千', ''), ['num:12000'])
  assert.deepEqual(keysOf('2千万5', ''), ['num:25000000'])
  assert.equal(findFactAdditions('月薪3000', '月薪3千5百').length, 1)
  assert.deepEqual(findFactAdditions('月薪3500', '月薪3千5百'), [])
  assert.deepEqual(keysOf('5百3千', ''), ['num:500', 'num:3000'])
})

test('同名两段对调后，累计令牌仍只豁免原来那一段', () => {
  const company = { company: '青岛海边书店', role: '店员', period: '2019-2021' }
  const plain = { ...company, description: sharedShelf }
  const aiLine = { ...company, description: `${sharedShelf.slice(0, -1)}，周更 2 篇。` }
  const userLine = { ...company, description: `${sharedShelf.slice(0, -1)}，另记 2 项。` }
  const input = shellResume([plain, plain])
  const generated = shellResume([plain, aiLine])
  const edited = shellResume([userLine, aiLine])
  const swapped = shellResume([aiLine, userLine])
  const userAdditions = detectUserResumeEdits(generated, edited, generated)
  const kept = [...new Set([...userAdditions, ...detectUserResumeEdits(edited, swapped, generated)])]
  assert.equal(kept.some((token) => token.includes('同名1') && token.includes('num:2')), true)
  assert.equal(kept.some((token) => token.includes('同名2') && token.includes('num:2')), false)
  const hits = detectGeneratedUnconfirmedAdditions(swapped, generated, input, kept)
  assert.equal(hits.some((text) => text.includes('周更') && text.includes('2')), true)
  assert.equal(hits.some((text) => text.includes('另记')), false)
})

test('同名三段里改第 2 段后再和第 3 段对调，第 3 段的数仍待确认', () => {
  const company = { company: '青岛海边书店', role: '店员', period: '2019-2021' }
  const base = '完成门店陈列、补货、闭店卫生和每日台账交接'
  const first = `${base}，早班开门整理门口。`
  const second = `${base}，午间补货并核对价签。`
  const thirdPlain = `${base}，晚班闭店清点库存。`
  const thirdAi = `${base}，晚班闭店清点库存，周更 2 篇。`
  const secondUser = `${base}，午间补货并核对价签，另记 2 项。`
  const row = (description) => ({ ...company, description })
  const input = shellResume([row(first), row(second), row(thirdPlain)])
  const generated = shellResume([row(first), row(second), row(thirdAi)])
  const edited = shellResume([row(first), row(secondUser), row(thirdAi)])
  const swapped = shellResume([row(first), row(thirdAi), row(secondUser)])
  const userAdditions = detectUserResumeEdits(generated, edited, generated)
  assert.equal(userAdditions.some((token) => token.includes('同名2') && token.includes('num:2')), true)
  assert.equal(userAdditions.some((token) => token.includes('同名3') && token.includes('num:2')), false)
  const kept = [...new Set([...userAdditions, ...detectUserResumeEdits(edited, swapped, generated)])]
  const hits = detectGeneratedUnconfirmedAdditions(swapped, generated, input, kept)
  assert.equal(hits.some((text) => text.includes('周更') && text.includes('2')), true)
  assert.equal(hits.some((text) => text.includes('另记')), false)
})

test('较小单位后面紧跟着又一个单位时不合并', () => {
  assert.deepEqual(keysOf('3千5百', ''), ['num:3500'])
  assert.deepEqual(keysOf('1万2千', ''), ['num:12000'])
  assert.deepEqual(keysOf('2千万5', ''), ['num:25000000'])
  assert.deepEqual(keysOf('5百3千', ''), ['num:500', 'num:3000'])
  assert.deepEqual(keysOf('增长1百分点', ''), ['num:1'])
  assert.deepEqual(keysOf('3千5百万', ''), ['raw:3千5百万'])
  assert.deepEqual(keysOf('2千5百万', ''), ['raw:2千5百万'])
  assert.deepEqual(keysOf('2亿3千万', ''), ['raw:2亿3千万'])
  assert.deepEqual(keysOf('1亿2千万', ''), ['raw:1亿2千万'])
  assert.deepEqual(keysOf('1万2千5百万', ''), ['raw:1万2千5百万'])
  assert.equal(keysOf('3千5百万', '').includes('num:3500'), false)
  assert.equal(keysOf('2亿3千万', '').includes('num:200003000'), false)
  assert.equal(keysOf('1万2千5百万', '').includes('num:12500'), false)
  assert.deepEqual(keysOf('完成销售额3千5百万', '期望月薪3500'), ['raw:3千5百万'])
  assert.equal(findFactAdditions('完成销售额3千5百万', '期望月薪3500').length >= 1, true)
  assert.deepEqual(keysOf('月薪3500', '营收3千5百万'), ['num:3500'])
  assert.equal(findFactAdditions('月薪3500', '营收3千5百万').length, 1)
})

/** 预览页每次改动都拿最初的生成稿做第三参，不拿这一步之前的稿。 */
function accumulatePageEdits(generated, steps) {
  let tokens = []
  let current = generated
  for (const next of steps) {
    tokens = [...new Set([...tokens, ...detectUserResumeEdits(current, next, generated)])]
    current = next
  }
  return tokens
}

function storeRow(company, role, description) {
  return { company, role, period: '2019-2021', description }
}

test('改公司名撞上另一条后，那一条里 AI 的数仍待确认', () => {
  const shelf = '整理仓库货架，按保质期先进先出调整摆放顺序。'
  const posts = '维护门店公众号，撰写新书推荐与活动预告。'
  const postsAi = '维护门店公众号，撰写新书推荐与活动预告，周更 2 篇。'
  const input = shellResume([storeRow('海岸超市', '店员', shelf), storeRow('灯塔书店', '店员', posts)])
  const generated = shellResume([storeRow('海岸超市', '店员', shelf), storeRow('灯塔书店', '店员', postsAi)])
  const renamed = shellResume([storeRow('灯塔书店', '店员', shelf), storeRow('灯塔书店', '店员', postsAi)])
  const typed = shellResume([
    storeRow('灯塔书店', '店员', shelf.replace(/。$/, '，另记 2 项。')),
    storeRow('灯塔书店', '店员', postsAi),
  ])
  const tokens = accumulatePageEdits(generated, [renamed, typed])
  const hits = detectGeneratedUnconfirmedAdditions(typed, generated, input, tokens)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].includes('周更') && hits[0].includes('2'), true)
})

test('改职务撞上另一条后，那一条里 AI 的数仍待确认', () => {
  const shelf = '整理仓库货架，按保质期先进先出调整摆放顺序。'
  const posts = '维护门店公众号，撰写新书推荐与活动预告。'
  const postsAi = '维护门店公众号，撰写新书推荐与活动预告，周更 2 篇。'
  const input = shellResume([storeRow('灯塔书店', '理货员', shelf), storeRow('灯塔书店', '店员', posts)])
  const generated = shellResume([storeRow('灯塔书店', '理货员', shelf), storeRow('灯塔书店', '店员', postsAi)])
  const renamed = shellResume([storeRow('灯塔书店', '店员', shelf), storeRow('灯塔书店', '店员', postsAi)])
  const typed = shellResume([
    storeRow('灯塔书店', '店员', shelf.replace(/。$/, '，另记 2 项。')),
    storeRow('灯塔书店', '店员', postsAi),
  ])
  const tokens = accumulatePageEdits(generated, [renamed, typed])
  const hits = detectGeneratedUnconfirmedAdditions(typed, generated, input, tokens)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].includes('周更') && hits[0].includes('2'), true)
})

test('改公司名撞上后，另一条里 AI 的职责词牵头仍待确认', () => {
  const shelf = '整理仓库货架，按保质期先进先出调整摆放顺序。'
  const posts = '维护门店公众号，撰写新书推荐与活动预告。'
  const postsAi = '维护门店公众号，撰写新书推荐与活动预告，牵头周末读书会。'
  const input = shellResume([storeRow('海岸超市', '店员', shelf), storeRow('灯塔书店', '店员', posts)])
  const generated = shellResume([storeRow('海岸超市', '店员', shelf), storeRow('灯塔书店', '店员', postsAi)])
  const renamed = shellResume([storeRow('灯塔书店', '店员', shelf), storeRow('灯塔书店', '店员', postsAi)])
  const typed = shellResume([
    storeRow('灯塔书店', '店员', shelf.replace(/。$/, '，牵头盘点。')),
    storeRow('灯塔书店', '店员', postsAi),
  ])
  const tokens = accumulatePageEdits(generated, [renamed, typed])
  const hits = detectGeneratedUnconfirmedAdditions(typed, generated, input, tokens)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].includes('牵头') && hits[0].includes('读书会'), true)
})

test('两组同名各两条互相改名后，AI 加的数仍待确认', () => {
  const descA = '负责收银台开闭店交接，核对备用金和当日小票。'
  const descB = '整理仓库货架，按保质期先进先出调整摆放顺序。'
  const descC = '接待到店顾客，介绍新到绘本并登记预订需求。'
  const descD = '维护门店公众号，撰写新书推荐与活动预告。'
  const descDai = '维护门店公众号，撰写新书推荐与活动预告，周更 2 篇。'
  const row = (company, description) => storeRow(company, '店员', description)
  const input = shellResume([row('海岸超市', descA), row('海岸超市', descB), row('灯塔书店', descC), row('灯塔书店', descD)])
  const generated = shellResume([row('海岸超市', descA), row('海岸超市', descB), row('灯塔书店', descC), row('灯塔书店', descDai)])
  const renamed = shellResume([row('海岸超市', descA), row('灯塔书店', descB), row('海岸超市', descC), row('灯塔书店', descDai)])
  const typed = shellResume([
    row('海岸超市', descA),
    row('灯塔书店', descB.replace(/。$/, '，另记 2 项。')),
    row('海岸超市', descC),
    row('灯塔书店', descDai),
  ])
  const tokens = accumulatePageEdits(generated, [renamed, typed])
  const hits = detectGeneratedUnconfirmedAdditions(typed, generated, input, tokens)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].includes('周更') && hits[0].includes('2'), true)
})

test('同名三段删掉第 1 段后再在第 3 段写同一个数，第 2 段 AI 的数仍待确认', () => {
  const row = (description) => storeRow('滨海超市', '理货员', description)
  const base = '负责生鲜区上货、临期商品下架和每晚盘点交接'
  const first = `${base}。`
  const second = `${base}，夜班。`
  const secondAi = `${base}，夜班，日均理货 3 车。`
  const third = `${base}，早班。`
  const thirdUser = `${base}，早班，另带 3 名新人。`
  const input = shellResume([row(first), row(second), row(third)])
  const generated = shellResume([row(first), row(secondAi), row(third)])
  const deleted = shellResume([row(secondAi), row(third)])
  const typed = shellResume([row(secondAi), row(thirdUser)])
  const tokens = accumulatePageEdits(generated, [deleted, typed])
  assert.equal(tokens.some((token) => token.includes('同名3') && token.includes('num:3')), true)
  assert.equal(tokens.some((token) => token.includes('同名2') && token.includes('num:3')), false)
  const hits = detectGeneratedUnconfirmedAdditions(typed, generated, input, tokens)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].includes('3') && hits[0].includes('车'), true)
})

test('读不准的数整串比较，原文里的整串不放过 AI 写的数值', () => {
  assert.deepEqual(keysOf('3千5百多万', ''), ['raw:3千5百多万'])
  assert.deepEqual(keysOf('3千5百余万', ''), ['raw:3千5百余万'])
  assert.deepEqual(keysOf('3千5百 万', ''), ['raw:3千5百万'])
  assert.deepEqual(keysOf('3千5百来万', ''), ['raw:3千5百来万'])
  assert.deepEqual(keysOf('3千5百几万', ''), ['raw:3千5百几万'])
  assert.deepEqual(keysOf('3千5百左右万', ''), ['raw:3千5百左右万'])
  assert.equal(keysOf('3千5百多万', '').includes('num:3500'), false)
  assert.equal(keysOf('3千5百余万', '').includes('num:3500'), false)
  assert.equal(keysOf('3千5百 万', '').includes('num:3500'), false)
  assert.deepEqual(keysOf('5百万', ''), ['num:5000000'])
  assert.deepEqual(keysOf('3500万', ''), ['num:35000000'])
  assert.deepEqual(keysOf('1亿2千5百万', ''), ['raw:1亿2千5百万'])
  assert.deepEqual(findFactAdditions('营收３千５百万', '营收3千5百万'), [])
  assert.deepEqual(findFactAdditions('营收3千5百 万', '营收3千5百万'), [])
  assert.deepEqual(findFactAdditions('营收3千5百　万', '营收3千5百万'), [])
  assert.equal(findFactAdditions('营收3千5百多万', '营收3千5百万').length >= 1, true)
  const leaks = [
    ['营收3千5百万', '服务客户3000人'],
    ['营收3千5百万', '管理5百万预算'],
    ['销售额2亿3千万', '销售额3千万'],
    ['销售额1亿2千万', '销售额1亿'],
    ['营收1万2千5百万', '月薪1万2'],
    ['团队3千人，预算5百万', '营收3千5百万'],
    ['期望月薪3500', '营收3千5百多万'],
    ['期望月薪3500', '营收3千5百余万'],
    ['期望月薪3500', '营收3千5百 万'],
    ['营收3500万', '营收3千5百万'],
  ]
  for (const [input, ai] of leaks) {
    assert.equal(findFactAdditions(ai, input).length >= 1, true, `${input} -> ${ai}`)
  }
  assert.equal(keysOf('1万2.5千', '')[0].startsWith('raw:'), true)
  assert.equal(keysOf('1万零2千', '')[0].startsWith('raw:'), true)
  assert.equal(keysOf('1万2.5千', '').some((key) => key.startsWith('num:')), false)
  assert.equal(keysOf('1万零2千', '').some((key) => key.startsWith('num:')), false)
  assert.equal(findFactAdditions('月薪1万2.5千', '月薪10000').length >= 1, true)
  assert.equal(findFactAdditions('月薪1万2.5千', '月薪2500').length >= 1, true)
  assert.equal(findFactAdditions('月薪1万零2千', '月薪10000').length >= 1, true)
  assert.equal(findFactAdditions('月薪1万零2千', '月薪2000').length >= 1, true)
  assert.equal(keysOf('2千5百千克', '').some((key) => key.startsWith('num:')), false)
  assert.equal(keysOf('1万2千千瓦', '').some((key) => key.startsWith('num:')), false)
})

function editExperience(resume, index, patch) {
  return {
    ...resume,
    experience: resume.experience.map((row, i) => (i === index ? copyEntryFields(row, patch) : row)),
  }
}

function deleteExperience(resume, index) {
  return { ...resume, experience: resume.experience.filter((_, i) => i !== index) }
}

function accumulateAnchored(generated, steps) {
  let tokens = []
  let current = generated
  for (const next of steps) {
    tokens = [...new Set([...tokens, ...previewUserEditTokens(generated, current, next)])]
    current = next
  }
  return tokens
}

const shelfLine = '整理仓库货架，按保质期先进先出调整摆放顺序。'
const postsLine = '维护门店公众号，撰写新书推荐与活动预告。'
const postsAiLine = '维护门店公众号，撰写新书推荐与活动预告，周更 2 篇。'

test('有下标时互换两条公司名，AI 的数仍待确认', () => {
  const input = shellResume([storeRow('海岸超市', '店员', shelfLine), storeRow('灯塔书店', '店员', postsLine)])
  const generated = stampGeneratedEntryIndexes(shellResume([
    storeRow('海岸超市', '店员', shelfLine),
    storeRow('灯塔书店', '店员', postsAiLine),
  ]))
  const swapped = editExperience(editExperience(generated, 0, { company: '灯塔书店' }), 1, { company: '海岸超市' })
  const tokens = accumulateAnchored(generated, [
    editExperience(generated, 0, { company: '灯塔书店' }),
    swapped,
  ])
  const hits = detectGeneratedUnconfirmedAdditions(swapped, generated, input, tokens)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].includes('周更') && hits[0].includes('2'), true)
  const unstamped = shellResume([storeRow('灯塔书店', '店员', shelfLine), storeRow('海岸超市', '店员', postsAiLine)])
  const oldHits = detectGeneratedUnconfirmedAdditions(unstamped, shellResume([
    storeRow('海岸超市', '店员', shelfLine),
    storeRow('灯塔书店', '店员', postsAiLine),
  ]), input, [])
  assert.equal(oldHits.length, 0)
})

test('有下标时删掉第 2 条再把第 1 条改成第 2 条的名字，AI 的数仍待确认', () => {
  const input = shellResume([storeRow('海岸超市', '店员', postsLine), storeRow('灯塔书店', '店员', shelfLine)])
  const generated = stampGeneratedEntryIndexes(shellResume([
    storeRow('海岸超市', '店员', postsAiLine),
    storeRow('灯塔书店', '店员', shelfLine),
  ]))
  const deleted = deleteExperience(generated, 1)
  const renamed = editExperience(deleted, 0, { company: '灯塔书店' })
  const tokens = accumulateAnchored(generated, [deleted, renamed])
  const hits = detectGeneratedUnconfirmedAdditions(renamed, generated, input, tokens)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].includes('周更') && hits[0].includes('2'), true)
  assert.equal(readGeneratedEntryIndex(renamed.experience[0]), 0)
})

test('两条空名带下标，填名后在第 1 条写同一个数，第 2 条 AI 的数仍待确认', () => {
  const input = shellResume([storeRow(' ', '店员', shelfLine), storeRow(' ', '店员', postsLine)])
  const generated = stampGeneratedEntryIndexes(shellResume([
    storeRow(' ', '店员', shelfLine),
    storeRow(' ', '店员', postsAiLine),
  ]))
  const namedFirst = editExperience(generated, 0, { company: '海岸超市' })
  const namedBoth = editExperience(namedFirst, 1, { company: '灯塔书店' })
  const typed = editExperience(namedBoth, 0, { description: shelfLine.replace(/。$/, '，另记 2 项。') })
  const tokens = accumulateAnchored(generated, [namedFirst, namedBoth, typed])
  assert.equal(tokens.some((token) => token.includes('experience:gen:0') && token.includes('num:2')), true)
  assert.equal(tokens.some((token) => token.includes('experience:gen:1') && token.includes('num:2')), false)
  const hits = detectGeneratedUnconfirmedAdditions(typed, generated, input, tokens)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].includes('周更') && hits[0].includes('2'), true)
  const plainGenerated = shellResume([storeRow(' ', '店员', shelfLine), storeRow(' ', '店员', postsAiLine)])
  const plainTyped = shellResume([
    storeRow('海岸超市', '店员', shelfLine.replace(/。$/, '，另记 2 项。')),
    storeRow('灯塔书店', '店员', postsAiLine),
  ])
  const plainTokens = accumulatePageEdits(plainGenerated, [
    shellResume([storeRow('海岸超市', '店员', shelfLine), storeRow(' ', '店员', postsAiLine)]),
    shellResume([storeRow('海岸超市', '店员', shelfLine), storeRow('灯塔书店', '店员', postsAiLine)]),
    plainTyped,
  ])
  const plainHits = detectGeneratedUnconfirmedAdditions(plainTyped, plainGenerated, input, plainTokens)
  assert.equal(plainHits.length, 0)
})

test('预览页记令牌拿生成稿做锚，第三参传当前稿会把数记到另一条', () => {
  const row = (description) => storeRow('滨海超市', '理货员', description)
  const base = '负责生鲜区上货、临期商品下架和每晚盘点交接'
  const first = `${base}。`
  const secondAi = `${base}，夜班，日均理货 3 车。`
  const third = `${base}，早班。`
  const thirdUser = `${base}，早班，另带 3 名新人。`
  const input = shellResume([row(first), row(`${base}，夜班。`), row(third)])
  const generated = shellResume([row(first), row(secondAi), row(third)])
  const deleted = shellResume([row(secondAi), row(third)])
  const typed = shellResume([row(secondAi), row(thirdUser)])
  const tokens = previewUserEditTokens(generated, deleted, typed)
  assert.equal(tokens.some((token) => token.includes('同名3') && token.includes('num:3')), true)
  assert.equal(tokens.some((token) => token.includes('同名2') && token.includes('num:3')), false)
  const hits = detectGeneratedUnconfirmedAdditions(typed, generated, input, tokens)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].includes('3') && hits[0].includes('车'), true)
  const page = readFileSync(join(kioskRoot, 'src/pages/resume/ResumeGeneratePreviewPage.tsx'), 'utf8')
  assert.equal(page.includes('previewUserEditTokens(generatedResume, resume, next)'), true)
  assert.equal(page.includes('type GeneratedAnchor'), false)
  assert.equal(page.includes('detectUserResumeEdits('), false)
})

test('生成稿下标不进 JSON，改一行和替换正文后还在', () => {
  const stamped = stampGeneratedEntryIndexes(shellResume([storeRow('海岸超市', '店员', '整理货架。')]))
  assert.equal(JSON.stringify(stamped).includes('generatedEntryIndex'), false)
  assert.equal(readGeneratedEntryIndex(stamped.experience[0]), 0)
  assert.equal(readGeneratedEntryIndex(stamped.experience[1] ?? {}), null)
  const edited = copyEntryFields(stamped.experience[0], { company: '灯塔书店' })
  assert.equal(readGeneratedEntryIndex(edited), 0)
  assert.equal(JSON.stringify(edited).includes('generatedEntryIndex'), false)
  const replaced = replaceResumeText(stamped, '整理货架', '整理货架并补货')
  assert.equal(readGeneratedEntryIndex(replaced.experience[0]), 0)
  assert.equal(JSON.stringify(replaced).includes('generatedEntryIndex'), false)
})
