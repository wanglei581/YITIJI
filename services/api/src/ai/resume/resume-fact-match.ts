/**
 * 简历事实串匹配（从 llm-resume-optimize.service 抽出的纯函数）。
 *
 * 规则与优化防编造校验同一套：空白 / 中英文标点归一后做子串包含。
 * 事实核对墙只报告「能不能在原文里找到」，不替用户改字、不推断录用。
 */

export type ResumeFactKind = 'school' | 'company' | 'period' | 'certificate' | 'phone' | 'email'

export interface ResumeFactItem {
  kind: ResumeFactKind
  value: string
  path: string
}

export interface ResumeFactMatch extends ResumeFactItem {
  foundInOriginal: boolean
}

/** 与优化防编造校验同一归一：去空白与常见标点，再小写。 */
export function normalizeResumeFactText(text: string): string {
  return text.replace(/[\s\u3000,，.。;；:：、·\-—()（）]/g, '').toLowerCase()
}

/**
 * 优化器口径：空值视为「原文没有就不写」，算合法。
 * 非空则必须在归一后的原文中作为子串出现。
 */
export function factPresentInOriginal(value: string | undefined, originalText: string): boolean {
  if (!value || !value.trim()) return true
  const needle = normalizeResumeFactText(value)
  if (!needle) return true
  return normalizeResumeFactText(originalText).includes(needle)
}

export function makeFactMatcher(originalText: string): (value: string | undefined) => boolean {
  const haystack = normalizeResumeFactText(originalText)
  return (value: string | undefined): boolean => {
    if (!value || !value.trim()) return true
    const needle = normalizeResumeFactText(value)
    return needle.length > 0 && haystack.includes(needle)
  }
}

interface ResumeFactSource {
  basic?: { phone?: string; email?: string }
  education?: Array<{ school?: string; period?: string }>
  experience?: Array<{ company?: string; period?: string }>
  certificates?: string[]
}

function pushFact(items: ResumeFactItem[], kind: ResumeFactKind, value: string | undefined, path: string): void {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) return
  items.push({ kind, value: trimmed, path })
}

/** 从优化稿抽出学校 / 公司 / 时间段 / 证书 / 电话 / 邮箱。空值不上报。 */
export function collectResumeFactItems(resume: ResumeFactSource): ResumeFactItem[] {
  const items: ResumeFactItem[] = []
  pushFact(items, 'phone', resume.basic?.phone, 'basic.phone')
  pushFact(items, 'email', resume.basic?.email, 'basic.email')
  for (const [index, row] of (resume.education ?? []).entries()) {
    pushFact(items, 'school', row.school, `education[${index}].school`)
    pushFact(items, 'period', row.period, `education[${index}].period`)
  }
  for (const [index, row] of (resume.experience ?? []).entries()) {
    pushFact(items, 'company', row.company, `experience[${index}].company`)
    pushFact(items, 'period', row.period, `experience[${index}].period`)
  }
  for (const [index, cert] of (resume.certificates ?? []).entries()) {
    pushFact(items, 'certificate', cert, `certificates[${index}]`)
  }
  return items
}

/** 逐项对照原文。编造项 foundInOriginal=false；空值不会进入 items。 */
export function matchResumeFacts(resume: ResumeFactSource, originalText: string): ResumeFactMatch[] {
  const haystack = normalizeResumeFactText(originalText)
  return collectResumeFactItems(resume).map((item) => {
    const needle = normalizeResumeFactText(item.value)
    return {
      ...item,
      foundInOriginal: needle.length > 0 && haystack.includes(needle),
    }
  })
}
