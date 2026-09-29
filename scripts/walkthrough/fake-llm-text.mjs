// ============================================================
// 走查用假模型 · 文本工具（只给 fake-llm.mjs 用，不进任何生产链路）。
//
// 假模型的回包必须能过 services/api 里的真实校验器，而那些校验器的核心是
// 「引文必须逐字出自送进模型的那份文本」。所以这里做的事只有一件：
// 从请求 prompt 里把简历 / 岗位原文切出来、分块、挑出可以原样回引的行。
// 回引的每一行都是请求文本的**连续子串**，归一化后必然还是子串，校验一定过。
// ============================================================

/** 与 services/api 各校验器同一口径的归一化（去空白与常见标点、转小写）。 */
export function norm(text) {
  return String(text ?? '').replace(/[\s　,，.。;；:：、·\-—()（）'"「」『』]/g, '').toLowerCase()
}

/**
 * 回引原文时要避开的片段。各功能的输出扫描（禁词、百分比、自称查过库、
 * 心理标签……）会把整份回包判非法；原文行里恰好带这些词时就换一行引。
 * 用拼接写法，避免本文件被当成「文案里出现了禁用词」。
 */
const j = (...parts) => parts.join('')
const UNSAFE_SNIPPETS = [
  j('录', '用'), j('Off', 'er'), j('off', 'er'), j('投', '递'), j('候选', '人'), j('内', '推'),
  j('保', '过'), j('通过', '率'), j('匹配', '度'), j('匹配', '率'), j('胜', '任'), j('推荐', '给企业'),
  j('面试', '邀约'), j('企业', '筛选'), j('内部', '渠道'), j('内部', '题库'), j('精准', '命中'),
  j('适', '合'), j('排', '名'), j('排', '序'), j('诊', '断'), j('人', '格'), j('焦', '虑'),
  j('抑', '郁'), j('临', '床'), j('语', '速'), j('语', '调'), j('查', '了'), j('查', '过'),
  j('收', '简历'), j('符', '合'), '%', '％', '```',
]

export function isSafeLine(line) {
  if (!line) return false
  return !UNSAFE_SNIPPETS.some((snippet) => line.includes(snippet))
}

/** 取 start 标记之后、end 标记之前的文本；标记缺失时退化为全文 / 到末尾。 */
export function between(text, start, end) {
  const source = String(text ?? '')
  let from = 0
  if (start) {
    const i = source.indexOf(start)
    if (i < 0) return ''
    from = i + start.length
  }
  if (!end) return source.slice(from)
  const k = source.indexOf(end, from)
  return k < 0 ? source.slice(from) : source.slice(from, k)
}

const HEADER_KEYS = [
  [['个人信息', '基本信息', '基本资料', '个人资料', '联系方式'], 'basic'],
  [['求职意向', '求职目标', '应聘意向', '职业目标', '意向岗位'], 'objective'],
  [['教育经历', '教育背景', '学习经历', '学历背景'], 'education'],
  [['工作经历', '工作经验', '实习经历', '工作履历', '实践经历', '社会实践'], 'experience'],
  [['项目经历', '项目经验'], 'project'],
  [['专业技能', '技能特长', '技能与证书', '技能证书', '技能', '证书', '资格证书', '职业技能', '技能与资质'], 'skill'],
  [['自我评价', '个人评价', '自我介绍', '个人优势', '个人总结'], 'selfintro'],
]
const TITLE_LINES = new Set(['个人简历', '简历', '求职简历', '个人求职简历'])

function headerKeyOf(line) {
  const bare = line.replace(/[\s【】[\]#:：、．.()（）一二三四五六七八九十0-9|｜/-]/g, '')
  if (!bare || bare.length > 8) return null
  for (const [names, key] of HEADER_KEYS) {
    if (names.includes(bare)) return key
  }
  return null
}

/**
 * 把简历文本切成固定七块（与 RESUME_CONTENT_BLOCKS 同 key）。
 * 表头行不进块；表头出现前的内容归入 basic；整份没有表头时前 4 行算 basic、其余算 experience。
 */
export function splitResume(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const blocks = { basic: [], objective: [], education: [], experience: [], project: [], skill: [], selfintro: [] }
  let current = 'basic'
  let headerCount = 0
  for (const line of lines) {
    if (TITLE_LINES.has(line.replace(/\s/g, ''))) continue
    const key = headerKeyOf(line)
    if (key) {
      current = key
      headerCount += 1
      continue
    }
    blocks[current].push(line)
  }
  if (headerCount === 0) {
    const all = blocks.basic
    blocks.basic = all.slice(0, 4)
    blocks.experience = all.slice(4)
  }
  return { blocks, headerCount, lines }
}

/** 某块里可以原样回引的行（安全、归一化后够长），截到 maxChars（前缀仍是原文子串）。 */
export function quotableLines(blockLines, max = 6, maxChars = 80) {
  const out = []
  for (const line of blockLines ?? []) {
    const cut = line.slice(0, maxChars)
    if (norm(cut).length < 4 || !isSafeLine(cut)) continue
    if (!out.includes(cut)) out.push(cut)
    if (out.length >= max) break
  }
  return out
}

/** 在整份文本里挑 n 行可回引的行，优先经历、项目、自我评价。 */
export function pickEvidence(text, n, maxChars = 60) {
  const { blocks, lines } = splitResume(text)
  const ordered = [
    ...blocks.experience, ...blocks.project, ...blocks.selfintro, ...blocks.skill,
    ...blocks.education, ...blocks.objective, ...lines,
  ]
  return quotableLines(ordered, n, maxChars)
}

function firstMatch(text, re, group = 1) {
  const m = String(text ?? '').match(re)
  return m ? (m[group] ?? '').trim() : ''
}

const SCHOOL_RE = /([一-龥A-Za-z·]{2,30}?(?:职业技术学院|大学|学院|中等专业学校|职业学校|技工学校|技校|中学|学校))/
const DEGREE_RE = /(博士|硕士|研究生|本科|大专|专科|中专|高中|初中|技校)/
const COMPANY_RE = /([一-龥A-Za-z·]{2,40}?(?:有限责任公司|股份有限公司|有限公司|集团|公司|工厂|五金厂|厂|酒店|医院|门店|超市))/
const PERIOD_RE = /((?:19|20)\d{2}[.\-/年]\d{1,2}月?\s*[-~—至到]+\s*(?:(?:19|20)\d{2}[.\-/年]\d{1,2}月?|至今|今))/

/**
 * 从简历文本里抽结构化事实。**每个值都是原文的连续子串**（或空），
 * 所以优化 / 排版校验器的「事实必须出自原文」一定成立。
 */
export function extractFacts(text) {
  const { blocks } = splitResume(text)
  const basicText = blocks.basic.join('\n')
  const whole = String(text ?? '')

  const name = firstMatch(basicText, /姓\s*名\s*[:：]\s*([^\s|｜，,；;]+)/)
    || firstMatch(whole, /(\[劳动者_\d+\])/)
  const phone = firstMatch(whole, /(\[手机号_\d+\])/) || firstMatch(whole, /(?<!\d)(1[3-9]\d{9})(?!\d)/)
  const email = firstMatch(whole, /(\[邮箱_\d+\])/) || firstMatch(whole, /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/)
  const city = firstMatch(basicText, /(?:现居城市|现居住地|现居|所在城市|居住地|城市)\s*[:：]\s*([^\s|｜，,；;]+)/)
  const objectiveText = blocks.objective.join('\n') + '\n' + basicText
  const position = firstMatch(objectiveText, /(?:意向岗位|求职意向|应聘岗位|目标岗位|期望职位|期望岗位)\s*[:：]\s*([^\s|｜，,；;]+)/)
  const intentionCity = firstMatch(objectiveText, /(?:期望城市|期望地点|工作地点)\s*[:：]\s*([^\s|｜，,；;]+)/)

  const education = []
  for (const line of blocks.education) {
    const school = firstMatch(line, SCHOOL_RE)
    if (!school) continue
    const degree = firstMatch(line, DEGREE_RE)
    const period = firstMatch(line, PERIOD_RE)
    const rest = line.replace(period, ' ').replace(school, ' ').replace(degree, ' ')
    const major = firstMatch(rest, /专业\s*[:：]\s*([^\s|｜，,；;]+)/)
      || firstMatch(rest, /\s([一-龥]{2,12}(?:技术|工程|管理|应用|专业|科学|设计|营销|会计))(?=\s|$)/)
    education.push({ school, major, degree, period, description: '' })
    if (education.length >= 4) break
  }

  const experience = []
  let currentExp = null
  for (const line of blocks.experience) {
    const company = firstMatch(line, COMPANY_RE)
    const period = firstMatch(line, PERIOD_RE)
    // 只有「带时间段」或「以公司/集团结尾」的行才算一段经历的抬头，
    // 否则「在工厂负责……」这类描述行会被误当成新的一段经历。
    if (company && (period || /(公司|集团)$/.test(company))) {
      const after = line.slice(line.indexOf(company) + company.length).replace(period, ' ').trim()
      const role = firstMatch(after, /^([^\s|｜，,；;]{2,20})/)
      if (!role) continue
      currentExp = { company, role, period, lines: [] }
      experience.push(currentExp)
      if (experience.length >= 6) break
      continue
    }
    if (currentExp && isSafeLine(line)) currentExp.lines.push(line)
  }

  const projects = []
  for (const line of blocks.project) {
    const named = firstMatch(line, /项目名称\s*[:：]\s*([^\s|｜，,；;]+)/)
    const name = named || firstMatch(line, /^([^\s|｜，,；;:：]{4,30})/)
    if (!name) continue
    projects.push({ name, role: '', description: line })
    if (projects.length >= 3) break
  }

  const skills = []
  const certificates = []
  for (const line of blocks.skill) {
    for (const token of line.split(/[、，,；;|｜/]+/).map((t) => t.trim()).filter(Boolean)) {
      if (/证|证书|资格/.test(token) && token.length <= 30) {
        if (!certificates.includes(token)) certificates.push(token)
      } else if (token.length <= 30 && isSafeLine(token)) {
        if (!skills.includes(token)) skills.push(token)
      }
    }
  }

  return {
    blocks,
    basic: { name, phone, email, city },
    intention: { position, city: intentionCity },
    education,
    experience,
    projects,
    skills: skills.slice(0, 8),
    certificates: certificates.slice(0, 6),
  }
}

/** 从岗位文本里切出可逐字引用的要求行（按换行、分号、序号切）。 */
export function requirementLines(jobText, max = 6) {
  return String(jobText ?? '')
    .split(/[\n；;。]|(?:\d+[.、．)）])/)
    .map((s) => s.replace(/^(岗位描述|任职要求|岗位职责|职位描述|要求|描述)\s*[:：=]\s*/, '').trim())
    .filter((s) => norm(s).length >= 4 && s.length <= 80 && isSafeLine(s))
    .slice(0, max)
}

/** 常见岗位关键词（用于 decisionSupport.keywordCoverage，只报两边都真实出现的词）。 */
export const KEYWORD_VOCAB = [
  'Excel', 'Word', 'Office', 'ERP', 'CAD', '办公软件', '沟通', '团队协作', '班组管理', '排班',
  '装配', '质检', '检验', '仓储', '仓库', '出入库', '盘点', '叉车', '驾驶', '电工', '焊工',
  '设备维护', '设备调试', '安全生产', '5S', '客服', '销售', '收银', '数据录入', '物流', '配送',
  '普通话', '倒班', '服务', '培训', '生产计划', '现场管理',
]
