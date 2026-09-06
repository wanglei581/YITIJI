import type { GeneratedResume, ResumeGenerateInput, ResumeOptimizeModule } from '@ai-job-print/shared'

export type FactKind = 'school' | 'company' | 'period' | 'certificate' | 'phone'

export interface ConfirmableFact {
  id: string
  kind: FactKind
  label: string
  value: string
}

export function extractConfirmableFacts(resume: GeneratedResume): ConfirmableFact[] {
  const facts: ConfirmableFact[] = []
  resume.education.forEach((item, i) => {
    if (item.school.trim()) facts.push({ id: `school-${i}`, kind: 'school', label: '学校', value: item.school })
    if (item.period?.trim()) facts.push({ id: `edu-period-${i}`, kind: 'period', label: '教育时间段', value: item.period })
  })
  resume.experience.forEach((item, i) => {
    if (item.company.trim()) facts.push({ id: `company-${i}`, kind: 'company', label: '公司', value: item.company })
    if (item.period?.trim()) facts.push({ id: `exp-period-${i}`, kind: 'period', label: '工作时间段', value: item.period })
  })
  resume.certificates.forEach((item, i) => {
    if (item.trim()) facts.push({ id: `cert-${i}`, kind: 'certificate', label: '证书', value: item })
  })
  if (resume.basic.phone?.trim()) {
    facts.push({ id: 'phone', kind: 'phone', label: '电话', value: resume.basic.phone })
  }
  return facts
}

const DIGIT_RE = /\d+(?:\.\d+)?%?/g
const DUTY_WORDS = ['主导', '负责', '带领', '季度之星'] as const

function collectBeforeText(
  modules: ResumeOptimizeModule[] | undefined,
  originalInput: ResumeGenerateInput | undefined,
): string {
  if (modules && modules.length > 0) return modules.map((m) => m.before).join('\n')
  if (!originalInput) return ''
  return [
    originalInput.selfIntro ?? '',
    ...originalInput.education.map((item) => item.description ?? ''),
    ...originalInput.experience.map((item) => item.description),
    ...originalInput.projects.map((item) => item.description),
  ].join('\n')
}

/** 机械对照：after 里有、before/原文里没有的数字与职责词。不是「已校验」。 */
export function detectUnconfirmedAdditions(
  resume: GeneratedResume,
  modules?: ResumeOptimizeModule[],
  originalInput?: ResumeGenerateInput,
): string[] {
  const beforeText = collectBeforeText(modules, originalInput)
  const afterParts = [
    resume.summary,
    ...resume.education.map((item) => item.description ?? ''),
    ...resume.experience.map((item) => item.description),
    ...resume.projects.map((item) => item.description),
  ]
  const hits: string[] = []
  for (const text of afterParts) {
    for (const token of text.match(DIGIT_RE) ?? []) {
      if (token && !beforeText.includes(token) && !hits.includes(token)) hits.push(token)
    }
    for (const word of DUTY_WORDS) {
      if (text.includes(word) && !beforeText.includes(word) && !hits.includes(word)) hits.push(word)
    }
  }
  return hits
}
