import type { PolicyAudience, PolicyCategory, PolicyKind, SavePolicyInput } from '../../services/api/policies'
import { isAbsoluteHttpUrl } from '../../lib/httpUrl'

export interface PolicyFormState {
  kind: PolicyKind
  title: string
  summary: string
  content: string
  audience: PolicyAudience
  category: PolicyCategory
  externalUrl: string
  externalId: string
  publishedDate: string
  validThrough: string
  whoCanApply: string
  requiredMaterials: string
  whereToApply: string
}

export const CHECKLIST_OVERFLOW_HINT = '清单上印不下，超出的部分要扫码看原文'

export const EMPTY_FORM: PolicyFormState = {
  kind: 'policy_guide', title: '', summary: '', content: '', audience: 'general', category: 'notice',
  externalUrl: '', externalId: '', publishedDate: '', validThrough: '', whoCanApply: '', requiredMaterials: '', whereToApply: '',
}

/** 与服务端同一套北京时间自然日。截止日期当天仍有效，过了这一天才算已到期。 */
export function beijingCalendarDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function nextBeijingCalendarDate(now: Date = new Date()): string {
  const [year, month, day] = beijingCalendarDate(now).split('-').map(Number)
  const next = new Date(Date.UTC(year!, (month ?? 1) - 1, day ?? 1))
  next.setUTCDate(next.getUTCDate() + 1)
  return next.toISOString().slice(0, 10)
}

/** 没填截止日期不算到期。只认 YYYY-MM-DD，并且早于北京时间的今天。 */
export function isPolicyDeadlinePast(validThrough: string | undefined, now: Date = new Date()): boolean {
  const text = validThrough?.trim().slice(0, 10) ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  return text < beijingCalendarDate(now)
}

export const HANDLING_FIELDS = [
  ['whoCanApply', '谁可以申请'],
  ['requiredMaterials', '要准备的材料'],
  ['whereToApply', '去哪办'],
] as const

export interface PolicyFormChecks {
  publishWarning: string | null
  linkChecked: boolean
  overflow: Partial<Record<(typeof HANDLING_FIELDS)[number][0], boolean>>
}

export function policyFormBlockReason(form: PolicyFormState): string | null {
  if (form.kind === 'policy_guide') {
    const missing = HANDLING_FIELDS.filter(([key]) => !form[key].trim()).map(([, label]) => label)
    if (missing.length) return `请填齐：${missing.join('、')}，才能提交审核`
    if (HANDLING_FIELDS.some(([key]) => form[key].length > 2000)) return '谁可以申请、要准备的材料、去哪办每栏不能超过 2000 字'
    if (!form.externalUrl.trim()) return '请填写原文链接，才能提交审核'
  }
  if (!form.title.trim()) return '请填写标题'
  if (form.title.length > 200) return '标题不能超过 200 字'
  // http 或域名不对都不拦保存。发布时仍会拒，原因由服务端按同一闸门写出来。
  if (form.externalUrl.trim() && !isAbsoluteHttpUrl(form.externalUrl)) {
    return '请填写以 https:// 开头的有效原文链接'
  }
  if (form.validThrough.trim()) {
    const text = form.validThrough.trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || text <= beijingCalendarDate()) {
      return '截止日期只能选今天以后的日期'
    }
  }
  return null
}

export function policyFormPayload(form: PolicyFormState, editing: boolean): SavePolicyInput {
  const optional: SavePolicyInput = { kind: form.kind, title: form.title.trim() }
  for (const key of ['summary', 'content', 'externalUrl', 'externalId', 'publishedDate', 'validThrough', 'whoCanApply', 'requiredMaterials', 'whereToApply'] as const) {
    const value = form[key].trim()
    // PATCH 的 null 才是清空；新建时真正省略空字段，不依赖 JSON 丢掉 undefined。
    if (value) optional[key] = value
    else if (editing) optional[key] = null
  }
  return {
    ...optional,
    ...(form.kind === 'policy_guide' ? { audience: form.audience } : { category: form.category }),
  }
}
