import type { ResumeContentBlock, ResumeIssue, ResumeReport } from '@ai-job-print/shared'

/** capture/debug 夹具。只在 ?capture=1 / ?debug=1 下可达，页面必须标「合成演示」。 */
export const FIXTURE_REPORT: ResumeReport = {
  sections: [
    { key: 'basic', label: '基础信息完整度', score: 8, maxScore: 10 },
    { key: 'objective', label: '求职目标清晰度', score: 6, maxScore: 10 },
    { key: 'experience', label: '经历表达清晰度', score: 5, maxScore: 10 },
    { key: 'quantification', label: '成果量化程度', score: 3, maxScore: 10 },
    { key: 'keyword', label: '岗位关键词覆盖', score: 6, maxScore: 10 },
    { key: 'readability', label: '版式与可读性', score: 8, maxScore: 10 },
  ],
  priorities: [
    { focus: '职责后面补一句结果', reason: '现在多数条目停在「负责什么」，看的人要自己猜你做成了什么。' },
    { focus: '把求职目标写在最前面', reason: '开头没有一句明确的岗位方向，前半屏的指向就散了。' },
    { focus: '能写数字的地方写数字', reason: '规模、频次、周期这类可核实的信息，比形容词更容易被看懂。' },
  ],
  suggestions: [
    '每段经历用「做了什么 → 怎么做 → 结果如何」三句收住，不要只写岗位职责。',
    '开头一句写清目标岗位与方向，让第一屏就能看出你想去哪儿。',
    '技能按「工具名称 + 熟练程度」成对写，不要只写「熟练办公软件」。',
  ],
  riskNotes: [
    '「精通」「资深」这类程度词如果没有具体例子支撑，建议换成你实际做过的事。',
    '简历里出现多套联系方式时，读的人不知道该联系哪一个，建议只留一套。',
  ],
}

export const FIXTURE_BLOCKS: ResumeContentBlock[] = [
  {
    key: 'basic',
    label: '基础信息',
    lines: ['某某（合成示例姓名） · 求职者', '手机 138****0000（公共终端默认遮挡）', '邮箱：这一行在原文里是空的'],
  },
  { key: 'objective', label: '求职目标', lines: ['希望找一份稳定的工作，用户运营或者社群运营都可以。'] },
  { key: 'education', label: '教育经历', lines: ['XX 大学 市场营销 本科 2019.09-2023.06'] },
  {
    key: 'experience',
    label: '工作经历',
    lines: [
      '示例科技（合成公司名） · 运营专员 · 2023.07-2025.08',
      '负责社群运营，维护用户关系，日常维护 3 个用户社群共 1200 人。',
      '配合市场部完成活动落地，参与内容排期。',
    ],
  },
  {
    key: 'project',
    label: '项目经历',
    lines: [
      '社群月活跃提升项目 · 主要参与人',
      '梳理入群路径并调整活动节奏，月活跃用户从 600 增至 780。',
      '另一个内容排期项目，原文只写了「参与」，没写做了什么。',
    ],
  },
  {
    key: 'skill',
    label: '技能',
    lines: ['熟练使用 Office 办公软件', 'Excel 会用数据透视表和 VLOOKUP，PPT 做过路演材料'],
  },
  { key: 'selfintro', label: '自我评价', lines: ['本人性格开朗，工作认真负责，交接文档一直是我在整理和更新。'] },
]

function ev(blockKey: ResumeContentBlock['key'], lineIndex: number): ResumeIssue['evidence'][number] {
  const block = FIXTURE_BLOCKS.find((item) => item.key === blockKey)
  return { blockKey, lineIndex, quote: block?.lines[lineIndex] ?? '' }
}

export const FIXTURE_ISSUES: ResumeIssue[] = [
  {
    id: 'I1',
    dim: 'basic',
    title: '邮箱一栏是空的',
    evidence: [ev('basic', 2)],
    impact: '只留一个联系方式时，对方换一种方式联系不到你。',
    fixIt: '把常用邮箱补在手机号后面，两个都留。',
  },
  {
    id: 'I2',
    dim: 'objective',
    title: '求职目标写成了愿望，没有岗位方向',
    evidence: [ev('objective', 0)],
    impact: '第一屏看不出你想去哪个岗位，后面的经历就没有对照的标准。',
    fixIt: '开头改成一句「求职方向：用户运营 / 社群运营」。',
  },
  {
    id: 'I3',
    dim: 'experience',
    title: '职责句停在「负责什么」，没有交代结果',
    evidence: [ev('experience', 1), ev('experience', 2)],
    impact: '读的人只知道你被安排做什么，不知道你做成了什么。',
    fixIt: '每条后面补一句结果，把「负责」换成你实际做到的动作。',
  },
  {
    id: 'I4',
    dim: 'quantification',
    title: '两段项目里只有一段写了可核实的数字',
    evidence: [ev('project', 1), ev('project', 2)],
    impact: '没有数字的那一段，读的人无法判断规模，也无从比较。',
    fixIt: '第二段补上你自己核对过的规模或频次；核不到就如实写做法。',
  },
  {
    id: 'I5',
    dim: 'keyword',
    title: '技能写成了程度词，工具名和熟练度分在两行',
    evidence: [ev('skill', 0), ev('skill', 1)],
    impact: '「熟练使用」这类词没有信息量，读的人要往下翻才知道你会什么。',
    fixIt: '合并成「Excel：数据透视表、VLOOKUP；PPT：路演材料」这种写法。',
  },
  {
    id: 'I6',
    dim: 'readability',
    title: '同一段里的分隔符与格式不统一',
    evidence: [ev('education', 0)],
    impact: '同类信息写法不一致时，视线要在同一行里来回找边界。',
    fixIt: '统一成「学校 · 专业 · 学历 · 起止时间」的分隔写法。',
  },
]

export function fixtureReport(kind: 'full' | 'minimal' | 'empty'): ResumeReport {
  if (kind === 'empty') return { sections: [], suggestions: [] }
  if (kind === 'minimal') {
    return { sections: FIXTURE_REPORT.sections, suggestions: FIXTURE_REPORT.suggestions }
  }
  return {
    ...FIXTURE_REPORT,
    contentBlocks: FIXTURE_BLOCKS,
    issues: FIXTURE_ISSUES,
  }
}
