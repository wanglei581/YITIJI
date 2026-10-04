import type { GeneratedResume } from '@ai-job-print/shared'

/**
 * 优化页经历 / 教育标题的就地校验。
 * 字数对齐服务端简历稿 DTO（公司、学校 100，职务、专业 60）。
 * 公司、学校、职务在本页不能空：空着导出没有意义，也不能等到导出接口再拒绝。
 * 专业可以空。学历、时间段、项目标题不在这里校验。
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

function requiredText(value: string, emptyMessage: string, max: number, maxMessage: string): string | null {
  if (value.trim() === '') return emptyMessage
  if (value.length > max) return maxMessage
  return null
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
    const company = requiredText(item.company ?? '', '公司名不能空', limits.company, '公司名最多 100 字')
    if (company) issues.push({ id: `experience-${index}-company`, message: company })
    const role = requiredText(item.role ?? '', '职务不能空', limits.role, '职务最多 60 字')
    if (role) issues.push({ id: `experience-${index}-role`, message: role })
  })
  resume.education.forEach((item, index) => {
    const school = requiredText(item.school ?? '', '学校名不能空', limits.school, '学校名最多 100 字')
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
