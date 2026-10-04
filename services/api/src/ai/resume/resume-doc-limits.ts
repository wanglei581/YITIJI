import type { GeneratedResume } from '../interfaces/ai-provider.interface'

/**
 * 「优化稿」的字段上限 —— 优化接口与三个接收端（导出、排版调整、存草稿）共用的唯一一份。
 *
 * 约定：优化接口吐出来的任何结果，原样交给这三个接口都必须过校验。
 * 所以这里的数字只允许从两头同时读：DTO 用它写校验，`fitResumeToDocLimits` 用它收口。
 * 标题类字段（学校 / 公司 / 项目名称、职务、姓名）允许为空：原件里只写了公司没写职务、
 * 或者一条经历只有一段话时，如实留空，模板不印空标题，不替用户编。
 */
export const RESUME_DOC_LIMITS = {
  name: 50,
  /** 学校 / 公司 / 项目名称 */
  title: 100,
  role: 60,
  major: 60,
  degree: 20,
  period: 40,
  /** 提取层最多给 20000 字原文；描述与简介的上限留在它之上，正常简历永远走不到截断。 */
  description: 24000,
  summary: 24000,
  education: 12,
  experience: 20,
  projects: 12,
  skills: 60,
  skill: 200,
  certificates: 40,
  certificate: 200,
} as const

const TRUNCATED_NOTE = '（内容过长，后面的部分请以原件为准）'

function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - TRUNCATED_NOTE.length)}${TRUNCATED_NOTE}`
}

function joinLines(...parts: Array<string | undefined>): string {
  return parts.map((part) => (part ?? '').trim()).filter(Boolean).join('\n')
}

/** 太长的条目按分隔符拆成多条，拆不开再硬切；一个字都不丢。 */
function splitLong(value: string, max: number): string[] {
  if (value.length <= max) return [value]
  const out: string[] = []
  let buffer = ''
  for (const piece of value.split(/(?<=[、,，;；。\s])/u)) {
    if (buffer && buffer.length + piece.length > max) { out.push(buffer.trim()); buffer = '' }
    for (let rest = piece; rest; rest = rest.slice(max)) {
      if (rest.length > max) out.push(rest.slice(0, max))
      else buffer += rest
    }
  }
  if (buffer.trim()) out.push(buffer.trim())
  return out.filter(Boolean)
}

/**
 * 把一份优化稿收进 RESUME_DOC_LIMITS，尽量不丢内容：
 * - 标题、职务、时间段超长：整段挪进这一条的描述，标题留空；
 * - 条目数超过上限：多出来的并进最后一条的描述 / 个人简介；
 * - 只有单个字段超过 24000 字（高于提取层的 20000 字上限）才截断，并在截断处写明。
 */
export function fitResumeToDocLimits(resume: GeneratedResume): GeneratedResume {
  const L = RESUME_DOC_LIMITS
  const spill: string[] = []
  const over = (value: string | undefined, max: number): value is string => !!value && value.length > max

  const education = resume.education.map((item) => {
    const moved: string[] = []
    const keep = (value: string | undefined, max: number) => (over(value, max) ? (moved.push(value), undefined) : value)
    const school = keep(item.school, L.title) ?? ''
    const major = keep(item.major, L.major)
    const degree = keep(item.degree, L.degree)
    const period = keep(item.period, L.period)
    const description = joinLines(...moved, item.description)
    return { school, major, degree, period, description: description ? clamp(description, L.description) : undefined }
  })
  const experience = resume.experience.map((item) => {
    const moved: string[] = []
    const keep = (value: string | undefined, max: number) => (over(value, max) ? (moved.push(value), undefined) : value)
    const company = keep(item.company, L.title) ?? ''
    const role = keep(item.role, L.role) ?? ''
    const period = keep(item.period, L.period)
    return { company, role, period, description: clamp(joinLines(...moved, item.description), L.description) }
  })
  const projects = resume.projects.map((item) => {
    const moved: string[] = []
    const keep = (value: string | undefined, max: number) => (over(value, max) ? (moved.push(value), undefined) : value)
    const name = keep(item.name, L.title) ?? ''
    const role = keep(item.role, L.role)
    return { name, role, description: clamp(joinLines(...moved, item.description), L.description) }
  })

  const foldTail = <T extends { description?: string }>(list: T[], max: number, text: (item: T) => string): T[] => {
    if (list.length <= max) return list
    const kept = list.slice(0, max)
    const last = kept[max - 1]
    last.description = clamp(joinLines(last.description, ...list.slice(max).map(text)), L.description)
    return kept
  }
  const educationFit = foldTail(education, L.education, (e) => joinLines([e.school, e.major, e.degree, e.period].filter(Boolean).join(' '), e.description))
  const experienceFit = foldTail(experience, L.experience, (e) => joinLines([e.company, e.role, e.period].filter(Boolean).join(' '), e.description))
  const projectsFit = foldTail(projects, L.projects, (p) => joinLines([p.name, p.role].filter(Boolean).join(' '), p.description))

  const fitList = (list: string[], maxItems: number, maxLen: number, label: string): string[] => {
    const pieces = list.flatMap((value) => splitLong(value.trim(), maxLen)).filter(Boolean)
    if (pieces.length > maxItems) spill.push(`${label}：${pieces.slice(maxItems).join('、')}`)
    return pieces.slice(0, maxItems)
  }
  const skills = fitList(resume.skills, L.skills, L.skill, '其他技能')
  const certificates = fitList(resume.certificates, L.certificates, L.certificate, '其他证书')

  const name = over(resume.basic.name, L.name) ? (spill.unshift(resume.basic.name), '') : resume.basic.name ?? ''
  return {
    ...resume,
    basic: { ...resume.basic, name },
    summary: clamp(joinLines(resume.summary, ...spill), L.summary),
    education: educationFit,
    experience: experienceFit,
    projects: projectsFit,
    skills,
    certificates,
  }
}

/**
 * 条目标题：有什么印什么，用「 · 」连接；职务、公司、项目名称为空时不留悬空的分隔符。
 * 三个导出格式（PDF / Word / 文本）共用，返回空串表示这一条没有标题、调用方不要印空行。
 */
export function resumeEntryHead(...parts: Array<string | undefined>): string {
  return parts.map((part) => (part ?? '').trim()).filter(Boolean).join(' · ')
}
