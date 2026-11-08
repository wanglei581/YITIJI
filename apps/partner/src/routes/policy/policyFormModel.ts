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
  whoCanApply: string
  requiredMaterials: string
  whereToApply: string
}

export const EMPTY_FORM: PolicyFormState = {
  kind: 'notice', title: '', summary: '', content: '', audience: 'general', category: 'notice',
  externalUrl: '', externalId: '', publishedDate: '', whoCanApply: '', requiredMaterials: '', whereToApply: '',
}

export const HANDLING_FIELDS = [
  ['whoCanApply', '谁可以申请'],
  ['requiredMaterials', '要准备的材料'],
  ['whereToApply', '去哪办'],
] as const

export function policyFormBlockReason(form: PolicyFormState): string | null {
  if (form.kind === 'policy_guide') {
    const missing = HANDLING_FIELDS.filter(([key]) => !form[key].trim()).map(([, label]) => label)
    if (missing.length) return `请填齐：${missing.join('、')}，才能提交审核`
    if (HANDLING_FIELDS.some(([key]) => form[key].length > 2000)) return '谁可以申请、要准备的材料、去哪办每栏不能超过 2000 字'
    if (!form.externalUrl.trim()) return '请填写原文链接，才能提交审核'
  }
  if (!form.title.trim()) return '请填写标题'
  if (form.title.length > 200) return '标题不能超过 200 字'
  if (form.externalUrl.trim() && (!isAbsoluteHttpUrl(form.externalUrl) || new URL(form.externalUrl.trim()).protocol !== 'https:')) {
    return '请填写以 https:// 开头的有效原文链接'
  }
  return null
}

export function policyFormPayload(form: PolicyFormState, editing: boolean): SavePolicyInput {
  const optional: SavePolicyInput = { kind: form.kind, title: form.title.trim() }
  for (const key of ['summary', 'content', 'externalUrl', 'externalId', 'publishedDate', 'whoCanApply', 'requiredMaterials', 'whereToApply'] as const) {
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
