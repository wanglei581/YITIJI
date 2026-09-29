// ============================================================
// 走查用假模型 · 按功能生成回包（只给 fake-llm.mjs 用）。
//
// 每个生成器对应 services/api 里一个真实调用方，回包形状照该调用方的解析 / 校验器写：
//   resume_diagnosis        ai/resume/llm-resume.service.ts（parseReport + llm-resume-evidence.ts）
//   resume_optimize         ai/resume/llm-resume-optimize.service.ts（parseAndValidate）
//   resume_layout_adjust    同上（parseLayoutAdjustAndValidate，带 warnings）
//   resume_generate         ai/resume/llm-resume-generate.service.ts（parsePolish）
//   job_fit                 ai/resume/llm-job-fit.service.ts
//   career_plan             ai/resume/llm-career-plan.service.ts
//   self_assessment         ai/resume/llm-self-assessment.service.ts
//   fair_visit_plan/_review ai/resume/llm-fair-visit-plan.service.ts
//   job_recommend/_explain  job-ai/job-ai-llm.service.ts
//   mock_interview_*        mock-interview/mock-interview-llm.service.ts
//   advisor_*               advisor/llm-advisor.service.ts
//   assistant_summary       advisor/assistant-summary.service.ts
//   contract_review         contract-review/contract-review-provider.service.ts
//   assistant_chat          ai/llm/llm-chat.service.ts（纯文本）
//
// 内容一律是「走查测试数据」：不出现真实人名，回引的原文都来自请求本身。
// ============================================================

import {
  KEYWORD_VOCAB, between, extractFacts, isSafeLine, norm, pickEvidence,
  quotableLines, requirementLines, splitResume,
} from './fake-llm-text.mjs'

/** 按 system prompt 里的独有短语识别调用方。顺序有意义：先具体后宽泛。 */
const DETECTORS = [
  ['resume_layout_adjust', '简历排版与内容微调引擎'],
  ['resume_optimize', '的简历优化引擎'],
  ['resume_diagnosis', '的简历诊断引擎'],
  ['resume_generate', '的简历润色引擎'],
  ['job_fit', '逐条对照岗位要求与简历原文'],
  ['career_plan', '你是求职者本人的职业发展顾问'],
  ['self_assessment', '倾向参考」工具的解读助手'],
  ['fair_visit_review', '这场招聘会已经结束'],
  ['fair_visit_plan', '招聘会参会准备顾问'],
  ['job_recommend', '你是求职者本人的岗位筛选助手'],
  ['job_explain', '你是求职者本人的岗位解读助手'],
  ['mock_interview_question', '提出下一道面试问题'],
  ['mock_interview_report', '模拟面试练习报告'],
  ['advisor_classify', '属于哪种作业型'],
  ['advisor_qa', '回答他拿不准的求职判断题'],
  ['advisor_draft', '顺成一段可以直接念出口的书面表达'],
  ['advisor_compare', '把岗位正文的要求逐条拿去材料里找'],
  ['assistant_summary', '浓缩成要点和待办'],
  ['contract_review', '你不是律师'],
]

export const TEXT_FEATURES = new Set(['assistant_chat'])

export function detectFeature(systemText) {
  for (const [feature, phrase] of DETECTORS) {
    if (systemText.includes(phrase)) return feature
  }
  return 'assistant_chat'
}

const json = (value) => JSON.stringify(value)

// ── 简历诊断 ──────────────────────────────────────────────────

function resumeDiagnosis({ user }) {
  const text = between(user, '"""\n', '\n"""')
  const { blocks, headerCount } = splitResume(text)
  const contentBlocks = Object.entries(blocks)
    .map(([key, lines]) => ({ key, lines: quotableLines(lines, 6, 80) }))
    .filter((b) => b.lines.length > 0)
  const has = (key) => contentBlocks.some((b) => b.key === key)
  const expLines = contentBlocks.find((b) => b.key === 'experience')?.lines ?? []
  const withDigits = expLines.filter((l) => /\d/.test(l)).length
  const sections = [
    { key: 'basic', label: '基础信息完整度', score: has('basic') ? 8 : 5, maxScore: 10 },
    { key: 'objective', label: '求职目标清晰度', score: has('objective') ? 7 : 4, maxScore: 10 },
    { key: 'experience', label: '经历表达清晰度', score: has('experience') ? 7 : 3, maxScore: 10 },
    { key: 'quantification', label: '成果量化程度', score: withDigits >= 2 ? 6 : 4, maxScore: 10 },
    { key: 'keyword', label: '岗位关键词覆盖', score: 6, maxScore: 10 },
    { key: 'readability', label: '版式与可读性', score: headerCount >= 4 ? 8 : 6, maxScore: 10 },
  ]
  const issues = []
  const plainExp = expLines.find((l) => !/\d/.test(l) && !/(公司|厂)/.test(l)) ?? expLines[0]
  if (plainExp) {
    issues.push({
      dim: 'quantification', title: '这段经历没有写出规模或结果',
      evidence: [{ blockKey: 'experience', quote: plainExp }],
      impact: '读简历的人只看到做了什么，看不到做到什么程度。',
      fixIt: '在这一行后面补上你实际负责的人数、数量或周期；没有准确数字就写清具体做了哪些环节。',
    })
  }
  const objLine = contentBlocks.find((b) => b.key === 'objective')?.lines[0]
  if (objLine) {
    issues.push({
      dim: 'objective', title: '求职方向可以再收窄一点',
      evidence: [{ blockKey: 'objective', quote: objLine }],
      impact: '同时写两个方向时，读的人不容易一眼看出你最想做哪一个。',
      fixIt: '把最想做的方向放在前面，另一个方向放到自我评价里简单带过。',
    })
  }
  const selfLine = contentBlocks.find((b) => b.key === 'selfintro')?.lines[0]
  if (selfLine) {
    issues.push({
      dim: 'readability', title: '自我评价偏概括',
      evidence: [{ blockKey: 'selfintro', quote: selfLine }],
      impact: '概括性的形容词多，读的人记不住具体的长处。',
      fixIt: '每个长处后面接一件你真实做过的小事，用事实代替形容词。',
    })
  }
  return json({
    sections,
    suggestions: [
      '工作经历按时间倒序排列，最近一段放在最前面，每段用三到四行写清职责和结果。',
      '把带数字的成果句放在每段经历的第一行，方便读的人快速看到。',
      '求职意向只保留一到两个方向，并与下面的经历描述用同一套说法。',
      '技能和证书单独成块，证书写全称，方便核对。',
    ],
    riskNotes: ['部分经历只写了工作内容，没有写出实际结果，建议补充真实情况。'],
    priorities: [
      { focus: '先补经历里的结果描述', reason: '这是整份简历里信息最少、最影响阅读的部分。' },
      { focus: '再统一求职方向', reason: '方向清楚后，经历和技能的写法才有取舍依据。' },
      { focus: '最后整理版式', reason: '内容定下来再调版式，避免反复返工。' },
    ],
    contentBlocks,
    issues,
  })
}

// ── 简历优化 / 排版调整 / 生成 ────────────────────────────────

function rewriteLine(line) {
  const core = line.replace(/^(负责|从事|参与|在|担任)/, '')
  return `负责${core}，写清本人承担的环节与实际结果`
}

function resumeOptimize({ user }) {
  const text = between(user, '简历原文:\n', null)
  const facts = extractFacts(text)
  const experience = facts.experience.map((e) => ({
    company: e.company, role: e.role, period: e.period,
    description: e.lines.length > 0 ? e.lines.map((l) => `· ${l}`).join('\n') : `· 在${e.company}担任${e.role}`,
  }))
  const modules = []
  for (const e of facts.experience) {
    for (const line of e.lines) {
      if (line.length >= 6 && modules.length < 4) modules.push({ title: `${e.role}经历`, before: line, after: rewriteLine(line) })
    }
  }
  for (const line of quotableLines(facts.blocks.selfintro, 2, 120)) {
    if (line.length >= 6 && modules.length < 6) modules.push({ title: '自我评价', before: line, after: `用事实说明：${line}` })
  }
  const companies = facts.experience.map((e) => e.company).slice(0, 2).join('、')
  const summaryParts = [
    facts.intention.position ? `求职方向为${facts.intention.position}` : '',
    companies ? `曾在${companies}工作` : '',
    quotableLines(facts.blocks.selfintro, 1, 60)[0] ?? '',
  ].filter(Boolean)
  return json({
    resume: {
      basic: facts.basic,
      intention: facts.intention,
      summary: summaryParts.join('；'),
      education: facts.education,
      experience,
      projects: facts.projects,
      skills: facts.skills,
      certificates: facts.certificates,
    },
    modules,
  })
}

function resumeLayoutAdjust({ user }) {
  const raw = between(user, '当前结构化简历(JSON,字段名不是事实来源):\n', '\n\n原始简历文本:\n')
  let resume
  try { resume = JSON.parse(raw) } catch { resume = null }
  if (!resume || typeof resume !== 'object') return json({ resume: {}, warnings: ['走查假模型没能读到当前结构化简历'] })
  const condense = user.includes('action=condense')
  const cut = (value, n) => (typeof value === 'string' && condense ? value.slice(0, n) : value)
  const out = {
    ...resume,
    summary: cut(resume.summary ?? '', 80),
    education: (resume.education ?? []).map((e) => ({ ...e, description: cut(e.description ?? '', 60) })),
    experience: (resume.experience ?? []).map((e) => ({ ...e, description: cut(e.description ?? '', 90) })),
    projects: (resume.projects ?? []).map((p) => ({ ...p, description: cut(p.description ?? '', 90) })),
  }
  return json({
    resume: out,
    warnings: condense
      ? ['已精简简介与经历描述，保留原有事实；请核对删减后的句子是否完整。']
      : ['已按排版参数调整描述密度，未改动任何事实字段。'],
  })
}

function resumeGenerate({ user }) {
  let input
  try { input = JSON.parse(user) } catch { input = {} }
  const edu = Array.isArray(input['教育经历']) ? input['教育经历'] : []
  const exp = Array.isArray(input['实习工作经历']) ? input['实习工作经历'] : []
  const proj = Array.isArray(input['项目经历']) ? input['项目经历'] : []
  const skills = Array.isArray(input['技能']) ? input['技能'] : []
  const polish = (desc) => (typeof desc === 'string' && desc.trim() ? rewriteLine(desc.trim()) : '')
  const position = input['求职意向']?.position ?? ''
  const first = exp[0]
  const summary = [
    position ? `求职方向为${position}。` : '',
    first ? `在${first['公司']}担任${first['职务']}，熟悉岗位日常工作。` : '',
    input['自我评价草稿'] ? String(input['自我评价草稿']).slice(0, 80) : '做事踏实，愿意学习新方法。',
  ].join('')
  return json({
    summary,
    educationDesc: edu.map((e) => polish(e['描述'])),
    experienceDesc: exp.map((e) => polish(e['描述'])),
    projectDesc: proj.map((p) => polish(p['描述'])),
    skillsPolished: skills.map((s) => String(s).trim()),
  })
}

// ── 岗位对照 / 职业规划 / 自我探索 ────────────────────────────

function jobFit({ user }) {
  const jobText = between(user, '【目标岗位】\n', '\n【简历原文】')
  const resume = between(user, '【简历原文】\n', null)
  const evidence = pickEvidence(resume, 3, 60)
  const reqs = requirementLines(between(jobText, '任职要求：', null) || jobText, 6)
  const duties = requirementLines(between(jobText, '岗位描述：', '任职要求：'), 4)
  const allReqs = [...reqs, ...duties]
  const matchPoints = evidence.slice(0, 3).map((ev, i) => ({
    ...(allReqs[i] ? { requirement: allReqs[i] } : {}),
    point: '简历里已经写到与这条要求相关的实际经历',
    evidence: ev,
  }))
  const gapPoints = (reqs.slice(3).length ? reqs.slice(3) : reqs.slice(0, 1)).slice(0, 2).map((r) => ({
    requirement: r,
    gap: '简历里还没有直接写到这一条',
    suggestion: '如果你确实做过相关工作，把当时的背景、你的职责和实际结果写成一句；没有做过就不要写。',
  }))
  const nResume = norm(resume)
  const nJob = norm(jobText)
  const matched = KEYWORD_VOCAB.filter((k) => nJob.includes(norm(k)) && nResume.includes(norm(k))).slice(0, 6)
  const missing = KEYWORD_VOCAB.filter((k) => nJob.includes(norm(k)) && !nResume.includes(norm(k))).slice(0, 4)
  return json({
    summary: '简历原文里已经写到了这个岗位的几项主要要求，另有少数要求还没有写到。以下对照只用于整理本人材料。',
    matchPoints,
    gapPoints,
    targetedSuggestions: [
      '把与岗位职责最接近的那段经历放到最前面。',
      '用岗位原文里的说法描述你已经做过的工作，方便读的人对照。',
      '补充你实际处理的数量、频次或结果，没有准确数字就写清工作环节。',
    ],
    decisionSupport: {
      analysisVersion: 'job_fit_m1_5',
      keywordCoverage: { matched, missing },
      requirementBreakdown: {
        responsibilities: duties.slice(0, 3),
        mustHave: reqs.filter((r) => !/优先/.test(r)).slice(0, 3),
        preferred: reqs.filter((r) => /优先/.test(r)).slice(0, 2),
        attention: allReqs.filter((r) => /(倒班|夜班|出差|接受|需)/.test(r)).slice(0, 2),
      },
    },
  })
}

function careerPlan({ user }) {
  const resume = between(user, '【简历原文】\n', '\n\n【')
  const facts = extractFacts(resume)
  const evidence = pickEvidence(resume, 3, 60)
  const role = facts.experience[0]?.role || '现岗位'
  const target = facts.intention.position || '目标方向'
  return json({
    summary: `以下是基于你简历原文整理的职业规划建议，仅供本人参考。你已有${role}相关经历，可以沿着${target}方向继续积累。`,
    currentSnapshot: evidence.map((ev, i) => ({
      point: ['已有一线岗位经历', '做过带人或协调类工作', '有可以直接写进简历的具体事项'][i] ?? '已有相关经历',
      evidence: ev,
    })),
    directions: [
      { title: `${target}方向`, why: `简历里已经写到与${role}相关的日常工作，这是已有事实的延伸。`, firstStep: '整理一份近期工作中做过的具体事项清单，用来更新简历。' },
      { title: '现场管理与协调方向', why: '简历里写到了带班组、排班或协调类的工作内容。', firstStep: '把带班组时处理过的具体问题写成两到三个小例子。' },
    ],
    skillPlan: [
      { skill: '办公软件', action: '练习用表格整理日报和出入库记录', timeframe: '1-3 个月' },
      { skill: '岗位证书', action: '了解目标方向常见的上岗证书及报考条件', timeframe: '3-6 个月' },
      { skill: '表达与沟通', action: '准备一段讲清自己经历的口头介绍并反复练习', timeframe: '1 个月内' },
    ],
    actionChecklist: [
      '按时间倒序更新简历里的工作经历',
      '把做过的具体事项写成完整句子',
      '去来源平台查看目标方向岗位的公开要求',
      '准备一份口头自我介绍',
    ],
  })
}

function selfAssessment({ user }) {
  const dims = [...user.matchAll(/^(.+?)（(\w+)）：强度\s*([\d.]+)\/5$/gm)].map((m) => ({ label: m[1], key: m[2], strength: Number(m[3]) }))
  const note = (d) => (d.strength >= 4
    ? `在「${d.label}」这一项上，你本次作答的倾向比较明显，回答里多次选择了相近的选项。`
    : d.strength >= 2
      ? `在「${d.label}」这一项上，你本次作答的倾向居中，不同情境下的选择有所不同。`
      : `在「${d.label}」这一项上，你本次作答的倾向较弱，可以结合自己的实际经历再想一想。`)
  return json({
    dimensions: dims.map((d) => ({ key: d.key, note: note(d) })),
    summary: '整体来看，你本次作答在几个维度上各有侧重，可以把倾向明显的几项和过往经历对照着看。本解读基于本人作答，仅作为自助参考，不代任何招聘结果、能力证明或心理评估',
  })
}

// ── 招聘会 / 岗位 AI ──────────────────────────────────────────

function fairCompaniesOf(user) {
  const raw = between(user, '【fairCompanies】\n', null)
  try { return JSON.parse(raw) } catch { /* 超长时被截断，退回正则 */ }
  return [...raw.matchAll(/"companyName":"((?:[^"\\]|\\.)*)"/g)].map((m) => ({ companyName: JSON.parse(`"${m[1]}"`), positions: [] }))
}

function fairVisit({ user }, review) {
  const resume = between(user, '【简历原文】\n', '\n\n【招聘会】')
  let fair = {}
  try { fair = JSON.parse(between(user, '【招聘会】\n', '\n\n【fairCompanies】')) } catch { /* ignore */ }
  const companies = fairCompaniesOf(user).slice(0, 3)
  const ev = pickEvidence(resume, 1, 30)[0] ?? '简历中的工作经历'
  const priorityCompanies = companies.map((c) => ({
    companyName: c.companyName,
    reason: `简历里写到「${ev}」，该企业公开岗位里有${c.positions?.[0]?.title ?? '相近方向'}。`,
    sourceUrl: null,
  }))
  const title = fair.title ?? '本场招聘会'
  const base = {
    fairHighlights: [`${title}在${fair.venue ?? '场馆'}举办，来源：${fair.sourceName ?? '官方来源'}。`, `参展企业 ${companies.length} 家（仅列与简历有对应的几家）。`],
    priorityCompanies,
  }
  if (review) {
    return json({
      summary: `${title}已经结束，以下为后续跟进参考，仅供本人使用。`,
      ...base,
      followUpActions: ['去来源平台查看上面几家企业目前仍在招的岗位', '按岗位公开要求补充简历里的对应经历'],
      nextTimeQuestions: ['这个岗位的日常工作内容主要有哪些', '岗位需要哪些上岗证书'],
    })
  }
  return json({
    summary: `这是${title}的参会准备单，仅供本人参会准备参考。`,
    ...base,
    preparationChecklist: ['打印几份最新简历', '带好身份证原件', '提前查看场馆路线和入口'],
    questionsToAsk: ['岗位的主要工作内容是什么', '是否需要倒班'],
    onsiteTips: ['到场后先看展位图，按顺序走', '简历用文件袋装好，避免折皱'],
  })
}

function jobRecommend({ user }) {
  const ids = [...user.matchAll(/^#\d+ jobId=(\S+)$/gm)].map((m) => m[1])
  const titles = [...user.matchAll(/^岗位=(.*)$/gm)].map((m) => m[1])
  const levels = ['reference_high', 'reference_medium', 'reference_low']
  return json(ids.map((jobId, i) => ({
    jobId,
    fitLevel: levels[i % levels.length],
    summary: `${titles[i] ?? '该岗位'}与简历中的部分经历方向相近，仅供参考，请以来源平台信息为准。`,
    matchPoints: ['简历里有相近的一线工作经历'],
    gapPoints: ['岗位列出的个别技能在简历里没有写到'],
    actionChecklist: ['去来源平台查看岗位完整说明', '按岗位要求核对自己的证书'],
  })))
}

function jobExplain({ user }) {
  const desc = between(user, '描述=', '\n要求=')
  const req = between(user, '要求=', '\n技能=')
  const duties = requirementLines(desc, 4)
  const reqs = requirementLines(req, 5)
  return json({
    responsibilities: duties.length ? duties : ['来源平台未提供详细职责，请以来源页面为准'],
    mustHaveRequirements: reqs.filter((r) => !/优先/.test(r)).slice(0, 4),
    niceToHaveRequirements: reqs.filter((r) => /优先/.test(r)).slice(0, 3),
    preparationTips: ['对照要求逐条准备能说明的真实经历', '准备好相关证书原件或复印件'],
  })
}

// ── 模拟面试 ──────────────────────────────────────────────────

function mockQuestion({ system }) {
  const m = system.match(/共 (\d+) 题，当前是第 (\d+) 题/)
  const total = Number(m?.[1] ?? 5)
  const nth = Number(m?.[2] ?? 1)
  const position = system.match(/目标岗位「([^」]*)」/)?.[1] ?? '目标岗位'
  if (nth === 1) {
    return json({ greeting: '你好，我是今天的练习面试官，我们开始吧。', question: `请先用一两分钟做个自我介绍，重点讲讲和${position}有关的经历。`, qType: 'intro' })
  }
  if (nth >= total) {
    return json({ question: '今天的练习就到这里，你有什么想问我的，或者还想补充的内容吗？', qType: 'closing' })
  }
  const pool = [
    [`你为什么想做${position}这份工作？`, 'position'],
    ['讲一段你印象最深的工作经历，当时你具体负责什么？', 'experience'],
    [`${position}需要的哪项技能是你最有把握的？请举个例子。`, 'skill'],
    ['工作中和同事意见不一致时，你一般怎么处理？', 'behavior'],
    ['接下来一两年，你在工作上有什么打算？', 'plan'],
  ]
  const [question, qType] = pool[(nth - 2) % pool.length]
  return json({ question, qType })
}

function mockReport() {
  return json({
    overall: { level: 'pass', summary: '本次练习能把主要经历讲出来，结构基本清楚。建议多准备一两个带结果的具体例子。' },
    expression: ['回答能围绕问题展开，先说结论再讲过程的时候更清楚。', '个别回答偏短，可以补一句具体做法。'],
    positionFit: ['对话里提到了与目标岗位日常工作相关的经历。'],
    credibility: ['讲经历时有背景和职责，结果部分可以再具体一些。'],
    professional: ['提到的专业内容讲得比较清楚，术语使用得当。'],
    adaptability: ['遇到不确定的问题能如实说明，表达稳定性较好。'],
    risks: ['准备两个能说明结果的工作例子', '自我介绍控制在一分半钟左右', '提前想好一个反问问题'],
    predictedQuestions: [
      { question: '你之前的工作中遇到过最大的困难是什么？', why: '考察解决问题的思路', approach: '按背景、任务、行动、结果讲一件真实的事。' },
      { question: '你为什么离开上一份工作？', why: '了解求职动机', approach: '如实简要说明，重点放在接下来想做什么。' },
      { question: '你能接受什么样的工作安排？', why: '了解工作条件', approach: '提前想清楚自己的实际情况，如实回答。' },
    ],
    starAdvice: { s: '先用一句话交代当时的情况', t: '说明你当时要完成的任务', a: '重点讲你自己做了哪些事', r: '最后讲结果和收获', reminder: '结果尽量用真实的数量或变化来说明' },
    checklist: ['了解应聘单位的基本情况', '准备自我介绍', '准备两个代表性经历', '准备一个反问问题', '带好简历和证件', '提前确认路线'],
  })
}

// ── 顾问作业面 / 小青要点 ─────────────────────────────────────

function advisorClassify({ user }) {
  const topic = between(user, '【用户诉求】', null)
  if (/(够不够|符不符合|对得上|比一比|对比|差在哪)/.test(topic)) {
    return json({ skill: 'compare', reason: '你想知道自己的材料和岗位要求对不对得上，所以按逐条比对来办。' })
  }
  if (/(不会写|帮我写|怎么写|自我介绍|求职信|写一段)/.test(topic)) {
    return json({ skill: 'slot_fill', reason: '你要的东西还没写出来，先把需要的信息问清楚再帮你顺成稿子。' })
  }
  return json({ skill: 'qa', reason: '你问的是一个拿不准的判断题，按问答来办。' })
}

function advisorQa({ user }) {
  const q = between(user, '【用户这一问】', null)
  const answer = /(辞职|离职|跳槽)/.test(q)
    ? '先别急着做决定。可以先想清楚三件事：现在的工作哪里让你不满意、下一份工作最看重什么、手头的积蓄能撑多久。三件事都想清楚了再定时间。本机没有你所在行业的具体数据，这条算参考。'
    : '这个问题没有统一答案，常见做法是先把自己的实际情况列出来，再对照岗位公开要求逐条看。拿不准的地方可以直接去来源平台看岗位说明。本机没有你所在行业的具体数据，这条算参考。'
  return json({ answer, evidenceLevel: 'E3', sourceNote: '这是通行做法的整理，不是针对你所在行业的数据结论。' })
}

function advisorDraft({ user }) {
  const body = between(user, '【用户自己填的内容】\n', null)
  const slots = [...body.matchAll(/^【([^】]+)】(.*)$/gm)].map((m) => ({ key: m[1], value: m[2].trim() })).filter((s) => s.value)
  const sentences = slots.map((s) => `关于${s.key}：${s.value}。`)
  const draft = `您好，我先简单介绍一下自己。${sentences.join('')}我在上一份工作里主要负责____，离开的原因是____。`
  return json({ draft, blanks: ['上一份工作的主要职责', '离开的原因'], summary: '稿子里还有两处留空，需要你按实际情况补上。' })
}

function advisorCompare({ user }) {
  const material = between(user, '【你的材料】\n', '\n\n【岗位正文要求】\n')
  const reqText = between(user, '【岗位正文要求】\n', null)
  const reqs = requirementLines(reqText, 6)
  const materialLines = quotableLines(material.split(/\r?\n/), 40, 60)
  const items = reqs.map((requirement) => {
    if (/(不限|接受|可接受)/.test(requirement)) return { requirement, verdict: 'not_a_capability', evidence: '这一条是工作条件，不是能力要求。' }
    const words = KEYWORD_VOCAB.filter((k) => requirement.includes(k))
    const hit = materialLines.find((line) => words.some((w) => line.includes(w)))
    return hit ? { requirement, verdict: 'covered', evidence: hit } : { requirement, verdict: 'missing', evidence: '材料里找不到对应内容' }
  })
  return json({
    items: items.length ? items : [{ requirement: reqText.slice(0, 60) || '岗位要求', verdict: 'missing', evidence: '材料里找不到对应内容' }],
    extras: [{ point: '材料里写到了一线工作经历', note: '岗位正文没有提到，但可以在自我介绍里带一句。' }],
    summary: '以上是逐条比对结果，只反映有没有写到，不代表任何结果判断。',
  })
}

function assistantSummary({ user }) {
  const turns = between(user, '【本次对话】\n', null).split('\n').filter((l) => l.startsWith('用户：'))
  const highlights = turns.slice(0, 4).map((t) => `你问到：${t.slice(3, 40)}`).filter((t) => isSafeLine(t))
  return json({
    highlights: highlights.length ? highlights : ['本次对话围绕简历整理和打印展开。'],
    todos: ['按小青的建议更新简历后，再到打印页打印一份核对'],
  })
}

// ── 合同审查（仅供直接调用；生产配置只认 https://api.deepseek.com/，见 README）────

function contractReview({ user }) {
  let input = {}
  try { input = JSON.parse(user) } catch { /* ignore */ }
  const pages = Array.isArray(input.pages) ? input.pages : []
  const findLine = (re) => {
    for (const p of pages) {
      const line = String(p.text ?? '').split('\n').find((l) => re.test(l) && l.trim().length > 0)
      if (line) return { pageNumber: p.pageNumber, excerpt: line.trim().slice(0, 200) }
    }
    return null
  }
  const findings = []
  const probation = findLine(/试用期/)
  findings.push(probation
    ? { category: 'probation', priority: 'attention', title: '试用期约定需要核对', pageNumber: probation.pageNumber, excerpt: probation.excerpt, explanation: '试用期长度与合同期限有对应关系，建议对照合同期限核对。', basisRef: '《劳动合同法》第十九条', verificationQuestion: '合同期限是多久？试用期是否在对应范围内？', uncertainty: '仅凭文本无法确认实际执行情况。' }
    : { category: 'probation', priority: 'insufficient_info', title: '未找到试用期约定', pageNumber: null, excerpt: '合同文本中没有找到试用期相关条款', explanation: '如果实际有试用期，建议写进合同。', basisRef: null, verificationQuestion: '是否约定了试用期？', uncertainty: '可能在附件中另行约定。' })
  const insurance = findLine(/社会保险|社保/)
  if (insurance) {
    findings.push({ category: 'social_insurance', priority: 'attention', title: '社会保险条款', pageNumber: insurance.pageNumber, excerpt: insurance.excerpt, explanation: '建议确认缴纳险种和起缴时间。', basisRef: null, verificationQuestion: '从哪个月开始缴纳社会保险？', uncertainty: '' })
  }
  return json({ findings })
}

// ── 小青对话（纯文本）────────────────────────────────────────

function assistantChat({ system, user }) {
  if (user.includes('请用一句话自我介绍')) return '你好，我是小青，可以帮你整理简历、打印扫描材料，也能说明常见的就业政策。（走查假模型回复）'
  const skill = system.match(/当前处于百宝箱「([^」]+)」技能场景/)?.[1]
  if (skill) return `好的，我们来做「${skill}」。请先告诉我你的目标岗位和你真实做过的相关经历，我只按你提供的信息整理，结果仅供参考。（走查假模型回复）`
  if (/简历|履历/.test(user)) return '简历建议先把最近一段工作经历写清楚：做了什么、负责哪些环节、结果怎样。写好后可以在「AI 简历服务」里做一次诊断，再打印出来核对。（走查假模型回复）'
  if (/打印|复印|扫描/.test(user)) return '打印可以在「打印扫描」里上传文件或扫码上传，选好份数和单双面后确认即可；扫描原件请把纸放进上方的输稿器。（走查假模型回复）'
  if (/政策|补贴|社保|人社/.test(user)) return '就业补贴和社保相关政策以当地人社部门发布为准，可以在「政策服务」里查看本机构发布的说明。（走查假模型回复）'
  return '我可以帮你整理简历、打印扫描材料，也可以说明常见的就业政策。你想先做哪一件？（走查假模型回复）'
}

const GENERATORS = {
  resume_diagnosis: resumeDiagnosis,
  resume_optimize: resumeOptimize,
  resume_layout_adjust: resumeLayoutAdjust,
  resume_generate: resumeGenerate,
  job_fit: jobFit,
  career_plan: careerPlan,
  self_assessment: selfAssessment,
  fair_visit_plan: (ctx) => fairVisit(ctx, false),
  fair_visit_review: (ctx) => fairVisit(ctx, true),
  job_recommend: jobRecommend,
  job_explain: jobExplain,
  mock_interview_question: mockQuestion,
  mock_interview_report: mockReport,
  advisor_classify: advisorClassify,
  advisor_qa: advisorQa,
  advisor_draft: advisorDraft,
  advisor_compare: advisorCompare,
  assistant_summary: assistantSummary,
  contract_review: contractReview,
  assistant_chat: assistantChat,
}

export function generateContent(feature, ctx) {
  return (GENERATORS[feature] ?? assistantChat)(ctx)
}

/** badjson 模式：JSON 类功能给一段解析不了的内容；纯文本功能给空内容。 */
export function badContent(feature) {
  if (TEXT_FEATURES.has(feature)) return ''
  return '走查故障模拟：模型没有按要求输出 JSON。{"note":"字段缺失"'
}
