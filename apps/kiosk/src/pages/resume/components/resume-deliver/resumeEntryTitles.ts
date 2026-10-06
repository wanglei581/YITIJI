import type { GeneratedResume } from '@ai-job-print/shared'

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
