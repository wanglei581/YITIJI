import type { GeneratedResume, ResumeGenerateInput, ResumeOptimizeModule } from '@ai-job-print/shared'
import { findFactAdditions } from './factAdditionsRule'

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

/**
 * 「待本人确认」那一行下面对人说的话（走查 I-21：「待本人确认：负责、1500、0.5%」普通人读不懂）。
 * 这几处是 AI 整理时新写进去的数和职责词，本机无从判断真假，只有本人知道，所以要本人核对。预览页、导出前核对弹层、
 * 优化页编辑屏三处共用这一句。
 */
export const UNCONFIRMED_WHY = 'AI 整理时新写进了这几处，你原来的内容里没有。请核对是不是你的实际情况；不是，就改掉或删掉再导出。'

/** 逐条对照共用的机械规则：after 有、before 无的数字与职责词。返回给人看的片段。 */
export function detectUnconfirmedTextAdditions(afterText: string, beforeText: string): string[] {
  const hits: string[] = []
  for (const item of findFactAdditions(afterText, beforeText)) {
    if (!hits.includes(item.text)) hits.push(item.text)
  }
  return hits
}

function collectBeforeText(
  modules: ResumeOptimizeModule[] | undefined,
  originalInput: ResumeGenerateInput | undefined,
): string {
  if (modules && modules.length > 0) return modules.map((m) => m.before).join('\n')
  if (!originalInput) return ''
  return JSON.stringify(originalInput)
}

function factFieldTexts(resume: GeneratedResume): string[] {
  return [
    resume.summary,
    ...resume.education.map((item) => item.description ?? ''),
    ...resume.experience.map((item) => item.description),
    ...resume.projects.map((item) => item.description),
    ...resume.skills,
  ]
}

/** 机械对照：after 里有、before/原文里没有的数字与职责词。技能栏里新写的数也要本人确认。 */
export function detectUnconfirmedAdditions(
  resume: GeneratedResume,
  modules?: ResumeOptimizeModule[],
  originalInput?: ResumeGenerateInput,
): string[] {
  const beforeText = collectBeforeText(modules, originalInput)
  const hits: string[] = []
  for (const text of factFieldTexts(resume)) {
    for (const addition of detectUnconfirmedTextAdditions(text, beforeText)) {
      if (!hits.includes(addition)) hits.push(addition)
    }
  }
  return hits
}

function keysIn(texts: string[], beforeText: string): Set<string> {
  const keys = new Set<string>()
  for (const text of texts) {
    for (const item of findFactAdditions(text, beforeText)) keys.add(item.key)
  }
  return keys
}

/**
 * 仍留在当前稿里、且生成稿里就有的新增事实。
 * 是不是同一处，按 key 比：本人只改了数字旁边的字，片段会变，数字本身还是要确认。
 * 本人后来自己写进去的数，用当时记下的片段还原 key，不再算成 AI 新增。
 */
export function detectGeneratedUnconfirmedAdditions(
  resume: GeneratedResume,
  generated: GeneratedResume,
  input?: ResumeGenerateInput,
  userAdditions: string[] = [],
): string[] {
  const beforeText = collectBeforeText(undefined, input)
  const generatedKeys = keysIn(factFieldTexts(generated), beforeText)
  const userKeys = keysIn(userAdditions, '')
  const hits: string[] = []
  for (const text of factFieldTexts(resume)) {
    for (const item of findFactAdditions(text, beforeText)) {
      if (!generatedKeys.has(item.key) || userKeys.has(item.key)) continue
      if (!hits.includes(item.text)) hits.push(item.text)
    }
  }
  return hits
}

/** 记录预览中每个描述字段由本人新增的事实。和上一稿比的是 key，返回的仍是片段。 */
export function detectUserResumeEdits(before: GeneratedResume, after: GeneratedResume): string[] {
  const texts = (resume: GeneratedResume) => [resume.summary,
    ...resume.education.map((item) => item.description ?? ''),
    ...resume.experience.map((item) => item.description),
    ...resume.projects.map((item) => item.description)]
  const oldTexts = texts(before)
  return texts(after).flatMap((text, index) => detectUnconfirmedTextAdditions(text, oldTexts[index] ?? ''))
}
