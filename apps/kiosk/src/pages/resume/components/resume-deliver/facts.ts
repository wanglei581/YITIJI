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

/** 路径与后端 additions.path 一致：summary、experience[0].description、skills[2]。 */
function factFields(resume: GeneratedResume): Array<{ path: string; text: string }> {
  const fields: Array<{ path: string; text: string }> = [
    { path: 'summary', text: resume.summary ?? '' },
  ]
  resume.education.forEach((item, index) => {
    fields.push({ path: `education[${index}].description`, text: item.description ?? '' })
  })
  resume.experience.forEach((item, index) => {
    fields.push({ path: `experience[${index}].description`, text: item.description ?? '' })
  })
  resume.projects.forEach((item, index) => {
    fields.push({ path: `projects[${index}].description`, text: item.description ?? '' })
  })
  resume.skills.forEach((item, index) => {
    fields.push({ path: `skills[${index}]`, text: item ?? '' })
  })
  return fields
}

function factFieldTexts(resume: GeneratedResume): string[] {
  return factFields(resume).map((field) => field.text)
}

/** 编辑发生时记下的本人新增：field:路径 + tab + key。页面原样累积这串字，比较时不再从片段反解。 */
function userEditToken(path: string, key: string): string {
  return `field:${path}\t${key}`
}

function parseUserEditToken(token: string): { path: string; key: string } | null {
  if (!token.startsWith('field:')) return null
  const tab = token.indexOf('\t')
  if (tab <= 'field:'.length) return null
  const path = token.slice('field:'.length, tab)
  const key = token.slice(tab + 1)
  if (!path || !key) return null
  return { path, key }
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

function keysInField(text: string, beforeText: string): Set<string> {
  const keys = new Set<string>()
  for (const item of findFactAdditions(text, beforeText)) keys.add(item.key)
  return keys
}

/**
 * 仍留在当前稿里、且生成稿同一字段里就有的新增事实。
 * 是不是同一处，按「字段路径 + key」比：只在同一字段里豁免。
 * 本人后来自己写进去的数，用编辑当时记下的 key，不再从片段反解。
 * 返回给人看的片段，同一片段只留一行。
 */
export function detectGeneratedUnconfirmedAdditions(
  resume: GeneratedResume,
  generated: GeneratedResume,
  input?: ResumeGenerateInput,
  userAdditions: string[] = [],
): string[] {
  const beforeText = collectBeforeText(undefined, input)
  const generatedKeys = new Map<string, Set<string>>()
  for (const field of factFields(generated)) {
    generatedKeys.set(field.path, keysInField(field.text, beforeText))
  }
  const userKeys = new Map<string, Set<string>>()
  for (const token of userAdditions) {
    const parsed = parseUserEditToken(token)
    if (!parsed) continue
    const set = userKeys.get(parsed.path) ?? new Set<string>()
    set.add(parsed.key)
    userKeys.set(parsed.path, set)
  }
  const hits: string[] = []
  for (const field of factFields(resume)) {
    const fromGenerated = generatedKeys.get(field.path) ?? new Set<string>()
    const fromUser = userKeys.get(field.path) ?? new Set<string>()
    for (const item of findFactAdditions(field.text, beforeText)) {
      if (!fromGenerated.has(item.key) || fromUser.has(item.key)) continue
      if (!hits.includes(item.text)) hits.push(item.text)
    }
  }
  return hits
}

/** 记录预览中每个字段由本人新增的事实。编辑发生时就记下路径和 key，技能也算。 */
export function detectUserResumeEdits(before: GeneratedResume, after: GeneratedResume): string[] {
  const oldByPath = new Map(factFields(before).map((field) => [field.path, field.text]))
  const tokens: string[] = []
  const seen = new Set<string>()
  for (const field of factFields(after)) {
    const old = oldByPath.get(field.path) ?? ''
    for (const item of findFactAdditions(field.text, old)) {
      const token = userEditToken(field.path, item.key)
      if (seen.has(token)) continue
      seen.add(token)
      tokens.push(token)
    }
  }
  return tokens
}
