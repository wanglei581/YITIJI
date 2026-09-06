// 从零建简历 · 数据模型层：上限常量、空行工厂、校验、提交/导出 payload 组装。
//
// 放在 utils/ 而不是 pages/resume-build/：静态门禁禁止页面 require 兄弟页面，
// pages/resume-voice 必须和文字表单走同一份 DTO 镜像，不能再抄一份。
//
// 这里的每个上限都不是拍脑袋定的，是 services/api/src/ai/dto/resume-generate.dto.ts
// 的逐条镜像。后端全局 ValidationPipe 是 whitelist + forbidNonWhitelisted：
// **多传一个字段就是 400**，所以下面组 payload 时一律按白名单逐字段挑，
// 绝不 Object.assign 整个视图对象——视图对象里有 id / 折叠状态这类前端字段。

// ── DTO 镜像：数量上限 ──
const MAX_EDUCATION = 6
const MAX_EXPERIENCE = 8
const MAX_PROJECTS = 6
const MAX_SKILLS = 20
const MAX_CERTIFICATES = 15

// ── DTO 镜像：单字段长度上限（input/textarea 的 maxlength 也用这一份） ──
const LEN = {
  name: 50, phone: 30, email: 100, city: 50,
  position: 60, jobType: 20, salary: 40,
  school: 100, major: 60, degree: 20, period: 40,
  company: 100, role: 60, projectName: 100,
  description: 1000,
  skill: 40, certificate: 60,
  selfIntro: 500,
}

/**
 * 导出格式 + 排版参数的分段选择器数据源。
 *
 * 选中态做成每个 item 上的 on 布尔，而不是在 wxml 里写 `layout[group.key] === item.val`：
 * 变量下标取值在各版本基础库上的行为我没法在这台机器上实测，选中态判错等于用户
 * 看到的排版和实际导出的不是一回事。宁可在 js 里多算一遍这 15 个布尔。
 *
 * columns 的值刻意是**数字**：DTO 为 @IsIn([1, 2])，而全局 ValidationPipe 没开
 * enableImplicitConversion，传字符串 '1' 会被判 400。
 */
function optionGroups() {
  return [
    { key: 'format', label: '文件格式', items: [
      { val: 'pdf', label: 'PDF' }, { val: 'docx', label: 'Word' },
      { val: 'txt', label: '纯文本' }, { val: 'md', label: 'Markdown' },
    ] },
    { key: 'fontScale', label: '字号', items: [
      { val: 'compact', label: '紧凑' }, { val: 'standard', label: '标准' }, { val: 'large', label: '偏大' },
    ] },
    { key: 'lineSpacing', label: '行距', items: [
      { val: 'compact', label: '紧凑' }, { val: 'standard', label: '标准' }, { val: 'relaxed', label: '宽松' },
    ] },
    { key: 'margin', label: '页边距', items: [
      { val: 'narrow', label: '窄' }, { val: 'normal', label: '常规' }, { val: 'wide', label: '宽' },
    ] },
    { key: 'columns', label: '栏数', items: [
      { val: 1, label: '单栏' }, { val: 2, label: '双栏' },
    ] },
    { key: 'accent', label: '主色', items: [
      { val: 'blue', label: '蓝' }, { val: 'green', label: '绿' }, { val: 'slate', label: '灰蓝' },
    ] },
  ]
}

/** 按当前 format / layout 重算选中态；返回新数组供 setData。 */
function syncOptionGroups(groups, format, layout) {
  return groups.map((g) => {
    const current = g.key === 'format' ? format : layout[g.key]
    return Object.assign({}, g, { items: g.items.map((it) => Object.assign({}, it, { on: it.val === current })) })
  })
}

let rowSeq = 0
function nextId(prefix) { rowSeq += 1; return `${prefix}${rowSeq}` }

function emptyEducation() { return { id: nextId('edu'), school: '', major: '', degree: '', period: '', description: '' } }
function emptyExperience() { return { id: nextId('exp'), company: '', role: '', period: '', description: '' } }
function emptyProject() { return { id: nextId('prj'), name: '', role: '', description: '' } }

function s(value) { return String(value == null ? '' : value).trim() }

/** 整行一个字都没填 —— 用户加了行又没写，不当作错误，提交时整行略过。 */
function rowIsBlank(row, keys) {
  for (let i = 0; i < keys.length; i += 1) if (s(row[keys[i]])) return false
  return true
}

/**
 * 技能 / 证书是 string[]。手机上逐个点「添加」太碎，这里用一个多行输入，
 * 换行或中英文逗号、顿号都算分隔；解析结果实时回显成 chip，
 * 用户看到的就是将要提交的那一份，不做任何静默改写。
 */
function parseList(text) {
  return String(text || '')
    .split(/[\n,，、;；]/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0)
}

/**
 * 校验。返回错误文案数组（空数组=通过）。
 *
 * 只查两件后端会 400 的事：必填缺失、数量超限。长度超限由 input 的 maxlength
 * 在录入侧就挡住了，不在这里重复一遍——重复的那份必然先漂移。
 */
function validate(form) {
  const errors = []
  if (!s(form.basic.name)) errors.push('第 1 段：请填写姓名')
  if (!s(form.intention.position)) errors.push('第 2 段：请填写目标岗位')

  const edu = form.eduRows.filter((r) => !rowIsBlank(r, ['school', 'major', 'degree', 'period', 'description']))
  edu.forEach((r, i) => { if (!s(r.school)) errors.push(`第 3 段第 ${i + 1} 条：填了内容就必须写学校名称`) })
  if (edu.length > MAX_EDUCATION) errors.push(`教育经历最多 ${MAX_EDUCATION} 条`)

  const exp = form.expRows.filter((r) => !rowIsBlank(r, ['company', 'role', 'period', 'description']))
  exp.forEach((r, i) => {
    const n = i + 1
    if (!s(r.company)) errors.push(`第 4 段第 ${n} 条：请填写单位名称`)
    if (!s(r.role)) errors.push(`第 4 段第 ${n} 条：请填写岗位/职务`)
    if (!s(r.description)) errors.push(`第 4 段第 ${n} 条：请写一句你做过什么（AI 只润色这句，不替你编）`)
  })
  if (exp.length > MAX_EXPERIENCE) errors.push(`实习/工作经历最多 ${MAX_EXPERIENCE} 条`)

  const prj = form.projRows.filter((r) => !rowIsBlank(r, ['name', 'role', 'description']))
  prj.forEach((r, i) => {
    const n = i + 1
    if (!s(r.name)) errors.push(`第 5 段第 ${n} 个项目：请填写项目名称`)
    if (!s(r.description)) errors.push(`第 5 段第 ${n} 个项目：请写一句项目内容`)
  })
  if (prj.length > MAX_PROJECTS) errors.push(`项目经历最多 ${MAX_PROJECTS} 条`)

  const skills = parseList(form.skillsText)
  if (skills.length > MAX_SKILLS) errors.push(`技能最多 ${MAX_SKILLS} 项，当前 ${skills.length} 项`)
  skills.forEach((x) => { if (x.length > LEN.skill) errors.push(`技能「${x.slice(0, 10)}…」超过 ${LEN.skill} 字`) })

  const certs = parseList(form.certsText)
  if (certs.length > MAX_CERTIFICATES) errors.push(`证书最多 ${MAX_CERTIFICATES} 项，当前 ${certs.length} 项`)
  certs.forEach((x) => { if (x.length > LEN.certificate) errors.push(`证书「${x.slice(0, 10)}…」超过 ${LEN.certificate} 字`) })

  return errors
}

/**
 * 可选字段留空就**不传这个键**，而不是传空串。
 * 后端 @IsOptional() 只跳过 undefined/null；空串会被当成"用户填了个空值"存进结果，
 * 也会在 PDF 上占一个空位。留空就是留空。
 */
function put(target, key, value) {
  const v = s(value)
  if (v) target[key] = v
  return target
}

/** 提交给 POST /resume/generate 的 body（字段名逐字对齐 ResumeGenerateRequestDto）。 */
function buildGeneratePayload(form) {
  const basic = put(put(put({ name: s(form.basic.name) }, 'phone', form.basic.phone), 'email', form.basic.email), 'city', form.basic.city)
  const intention = put(put(put({ position: s(form.intention.position) }, 'city', form.intention.city), 'jobType', form.intention.jobType), 'salary', form.intention.salary)

  const education = form.eduRows
    .filter((r) => !rowIsBlank(r, ['school', 'major', 'degree', 'period', 'description']))
    .map((r) => put(put(put(put({ school: s(r.school) }, 'major', r.major), 'degree', r.degree), 'period', r.period), 'description', r.description))

  const experience = form.expRows
    .filter((r) => !rowIsBlank(r, ['company', 'role', 'period', 'description']))
    .map((r) => put({ company: s(r.company), role: s(r.role), description: s(r.description) }, 'period', r.period))

  const projects = form.projRows
    .filter((r) => !rowIsBlank(r, ['name', 'role', 'description']))
    .map((r) => put({ name: s(r.name), description: s(r.description) }, 'role', r.role))

  const payload = {
    basic, intention, education, experience, projects,
    skills: parseList(form.skillsText),
    certificates: parseList(form.certsText),
  }
  return put(payload, 'selfIntro', form.selfIntro)
}

/**
 * 导出 body。ResumeGenerateExportDto 的 basic/intention/summary/education/
 * experience/projects/skills/certificates 全部是**必填**（summary 允许空串）。
 *
 * resume 来源有两种，只有这两种：
 *   - 润色版：服务端返回的 resume 原样带回（AI 改过的是描述类文本）
 *   - 原样草稿：用户自己填的内容（draft:true，服务端据此把 PDF 元数据标成
 *     AIGenerated='false'，不把一个字都不是 AI 写的文件标成 AI 产物）
 * 两种都按白名单逐字段挑：视图对象里有 id 之类的前端字段，
 * 整个塞过去会被 forbidNonWhitelisted 打回 400。
 */
function buildExportPayload(resume, options) {
  const opt = options || {}
  const basic = put(put(put({ name: s(resume.basic && resume.basic.name) }, 'phone', resume.basic && resume.basic.phone), 'email', resume.basic && resume.basic.email), 'city', resume.basic && resume.basic.city)
  const intention = put(put(put({ position: s(resume.intention && resume.intention.position) }, 'city', resume.intention && resume.intention.city), 'jobType', resume.intention && resume.intention.jobType), 'salary', resume.intention && resume.intention.salary)

  const body = {
    basic,
    intention,
    summary: s(resume.summary),
    education: (resume.education || []).map((r) => put(put(put(put({ school: s(r.school) }, 'major', r.major), 'degree', r.degree), 'period', r.period), 'description', r.description)),
    experience: (resume.experience || []).map((r) => put({ company: s(r.company), role: s(r.role), description: s(r.description) }, 'period', r.period)),
    projects: (resume.projects || []).map((r) => put({ name: s(r.name), description: s(r.description) }, 'role', r.role)),
    skills: (resume.skills || []).map(s).filter(Boolean),
    certificates: (resume.certificates || []).map(s).filter(Boolean),
    format: opt.format || 'pdf',
  }
  if (opt.taskId) body.taskId = opt.taskId
  if (opt.draft) body.draft = true
  // layout 只有 PDF 会被消费；其余格式传了也是被后端忽略，不如不传，
  // 免得用户以为选了排版对 txt 生效。
  if (opt.layout && body.format === 'pdf') body.layout = opt.layout
  return body
}

/**
 * 把表单原样折成 GeneratedResume 形状，供 draft 导出使用。
 * summary 直接取用户写的自我介绍原文 —— 导出 DTO 里没有 selfIntro 这个字段，
 * summary 是用户那段话唯一能进 PDF 的位置，逐字带过去，不加工。
 */
function formAsResume(form) {
  const payload = buildGeneratePayload(form)
  return {
    basic: payload.basic,
    intention: payload.intention,
    summary: s(form.selfIntro),
    education: payload.education,
    experience: payload.experience,
    projects: payload.projects,
    skills: payload.skills,
    certificates: payload.certificates,
  }
}

module.exports = {
  MAX_EDUCATION, MAX_EXPERIENCE, MAX_PROJECTS, MAX_SKILLS, MAX_CERTIFICATES,
  LEN, optionGroups, syncOptionGroups,
  emptyEducation, emptyExperience, emptyProject,
  parseList, validate, buildGeneratePayload, buildExportPayload, formAsResume,
}
