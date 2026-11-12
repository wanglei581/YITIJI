import type { GeneratedResume } from '@ai-job-print/shared'

/**
 * 编辑区简介、描述的输入上限，与导出稿 `RESUME_DOC_LIMITS.summary` / `.description` 相同。
 * 输入框用 maxLength 挡住新打的字，onChange 不再截已经在稿里的内容。
 */
export const RESUME_EDIT_LIMITS = {
  summary: 24000,
  description: 24000,
} as const

/**
 * 优化页经历 / 教育标题的就地校验。
 * 字数对齐服务端简历稿 DTO（公司、学校 100，职务、专业 60），超长才拦：服务端会拒，提前在本页说。
 * 公司、学校、职务、专业都可以空，和服务端 ResumeDocExperienceDto / ResumeDocEducationDto 一致：
 * 原件只写了公司没写职务、或者某一项本来就没有，就如实留空，不逼用户编一个出来（10/6 走查 W-119 回归）。
 * 学历、时间段、项目标题不在这里校验。
 */
export const RESUME_ENTRY_TITLE_LIMITS = {
  company: 100,
  school: 100,
  role: 60,
  major: 60,
} as const

export type ResumeTitleIssue = {
  id: string
  message: string
}

function optionalText(value: string | undefined, max: number, maxMessage: string): string | null {
  if (!value) return null
  if (value.length > max) return maxMessage
  return null
}

export function resumeTitleIssues(resume: GeneratedResume): ResumeTitleIssue[] {
  const issues: ResumeTitleIssue[] = []
  const limits = RESUME_ENTRY_TITLE_LIMITS
  resume.experience.forEach((item, index) => {
    const company = optionalText(item.company, limits.company, '公司名最多 100 字')
    if (company) issues.push({ id: `experience-${index}-company`, message: company })
    const role = optionalText(item.role, limits.role, '职务最多 60 字')
    if (role) issues.push({ id: `experience-${index}-role`, message: role })
  })
  resume.education.forEach((item, index) => {
    const school = optionalText(item.school, limits.school, '学校名最多 100 字')
    if (school) issues.push({ id: `education-${index}-school`, message: school })
    const major = optionalText(item.major, limits.major, '专业最多 60 字')
    if (major) issues.push({ id: `education-${index}-major`, message: major })
  })
  return issues
}

export function focusResumeTitleIssue(id: string): void {
  if (typeof document === 'undefined') return
  const el = document.querySelector(`[data-entry-field="${id}"]`)
  if (!(el instanceof HTMLElement)) return
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  el.focus()
}

export type ResumeOriginalHit = { fieldId: string; start: number }

/** 与编辑区从上到下的栏顺序一致。同一句出现多处时停在第一处。 */
function resumeOriginalFields(resume: GeneratedResume): Array<{ id: string; text: string }> {
  const fields: Array<{ id: string; text: string }> = [{ id: 'summary', text: resume.summary ?? '' }]
  resume.education.forEach((item, index) => {
    fields.push({ id: `education-${index}-school`, text: item.school ?? '' })
    fields.push({ id: `education-${index}-major`, text: item.major ?? '' })
    fields.push({ id: `education-${index}-description`, text: item.description ?? '' })
  })
  resume.experience.forEach((item, index) => {
    fields.push({ id: `experience-${index}-company`, text: item.company ?? '' })
    fields.push({ id: `experience-${index}-role`, text: item.role ?? '' })
    fields.push({ id: `experience-${index}-description`, text: item.description ?? '' })
  })
  resume.projects.forEach((item, index) => {
    fields.push({ id: `projects-${index}-description`, text: item.description ?? '' })
  })
  resume.skills.forEach((skill, index) => {
    fields.push({ id: `skill-${index}`, text: skill ?? '' })
  })
  return fields
}

/** 在编辑区当前内容里找这句原文。没有（原文为空或已被改掉）返回 null。 */
export function findResumeOriginalField(resume: GeneratedResume, original: string): ResumeOriginalHit | null {
  const needle = original.trim()
  if (!needle) return null
  for (const field of resumeOriginalFields(resume)) {
    const start = field.text.indexOf(needle)
    if (start >= 0) return { fieldId: field.id, start }
  }
  return null
}

function scrollResumeEditorToTop(): void {
  const page = document.querySelector('[data-qx-page="resume-edit"]')
  const scroller = page?.parentElement
  if (scroller instanceof HTMLElement) scroller.scrollTo({ top: 0 })
  if (page instanceof HTMLElement) page.scrollTo({ top: 0 })
}

/** 滚到这句原文所在的那一栏，聚焦并用 setSelectionRange 选中。找不到就停在编辑区顶部。 */
export function focusResumeOriginalField(resume: GeneratedResume, original: string): void {
  if (typeof document === 'undefined') return
  const hit = findResumeOriginalField(resume, original)
  const el = hit ? document.querySelector(`[data-entry-field="${hit.fieldId}"]`) : null
  const needle = original.trim()
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    scrollResumeEditorToTop()
    return
  }
  const start = el.value.indexOf(needle)
  if (start < 0) {
    scrollResumeEditorToTop()
    return
  }
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  el.focus()
  el.setSelectionRange(start, start + needle.length)
}
