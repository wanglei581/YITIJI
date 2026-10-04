import type {
  AdminAiQuotaService,
  AdminBenefitGrantItem,
  AdminBenefitSourceType,
  AdminBenefitType,
  GrantBenefitInput,
} from '../../services/api/memberBenefitsAdmin'

/**
 * 中文名对齐现有界面：AI 简历（后台大屏 metricLabels）、
 * AI 顾问（一体机顾问页标题）、模拟面试（后台模型位与大屏）。
 * 扣减顺序见服务端 AiQuotaService.reserve：先占当日免费次数，占不到再扣赠送次数。
 */
export const AI_QUOTA_SERVICES: readonly { value: AdminAiQuotaService; label: string }[] = [
  { value: 'ai_resume', label: 'AI 简历' },
  { value: 'ai_assistant', label: 'AI 顾问' },
  { value: 'ai_interview', label: '模拟面试' },
]

export const AI_QUOTA_COUNT_MIN = 1
export const AI_QUOTA_COUNT_MAX = 9999

export const AI_QUOTA_GRANT_NOTE = '赠送给该会员的额外 AI 使用次数，先用每天的免费次数，用完再扣这里。'

export const BENEFIT_TYPES: { value: AdminBenefitType; label: string; desc: string }[] = [
  { value: 'coupon', label: '优惠券', desc: '用于打印或服务优惠' },
  { value: 'free_quota', label: '免费次数', desc: '用于免费打印/服务次数' },
  { value: 'package_entitlement', label: '服务额度', desc: '仅代表工具服务额度' },
  { value: 'ai_quota', label: 'AI 额度', desc: '赠送额外的 AI 使用次数' },
  { value: 'subsidy_eligibility_hint', label: '政策资格提示', desc: '仅作官方入口与材料指引' },
]

const GRANT_ERROR_TEXT: Readonly<Record<string, string>> = {
  BENEFIT_SERVICE_KEY_REQUIRED: '请选择这项额度用于哪项 AI 服务。',
  BENEFIT_QUANTITY_INVALID: '次数须为 1–9999 的整数。',
  BENEFIT_SERVICE_KEY_FORBIDDEN: '这项权益不能指定 AI 服务。',
  BENEFIT_COPY_FORBIDDEN: '权益文案含有不合规承诺，请改成说明文字。',
  BENEFIT_QUANTITY_FORBIDDEN: '政策资格提示不能设置次数。',
  BENEFIT_TITLE_REQUIRED: '权益名称不能为空。',
  BENEFIT_DATE_INVALID: '有效期不正确，请重新选择。',
  BENEFIT_TYPE_INVALID: '权益类型不支持。',
  BENEFIT_SOURCE_INVALID: '权益来源不支持。',
  BENEFIT_END_USER_DISABLED: '该用户已停用，不能发放权益。',
  BENEFIT_END_USER_NOT_FOUND: '会员不存在。',
  VALIDATION_FAILED: '提交内容未通过校验，请检查后重试。',
}

const KEY_LEAK = /ai_quota|ai_resume|ai_assistant|ai_interview|serviceKey/

export interface GrantDraft {
  endUserId: string
  benefitType: AdminBenefitType
  sourceType: AdminBenefitSourceType
  title: string
  description: string
  quantityTotal: string
  validUntil: string | null
  serviceKey: string
  aiCount: string
}

export function defaultBenefitTitle(type: AdminBenefitType): string {
  if (type === 'free_quota') return '免费打印次数'
  if (type === 'package_entitlement') return '求职服务额度'
  if (type === 'subsidy_eligibility_hint') return '政策资格提示'
  // 标题会进服务端文案校验，不能写入「面试」；服务种类单独提交。
  if (type === 'ai_quota') return 'AI 使用次数'
  return '打印服务优惠券'
}

export function isAiQuotaService(value: string): value is AdminAiQuotaService {
  return AI_QUOTA_SERVICES.some((item) => item.value === value)
}

export function parseAiQuotaCount(raw: string): { ok: true; value: number } | { ok: false } {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return { ok: false }
  const value = Number(trimmed)
  if (!Number.isInteger(value) || value < AI_QUOTA_COUNT_MIN || value > AI_QUOTA_COUNT_MAX) return { ok: false }
  return { ok: true, value }
}

export function aiQuotaFieldErrors(
  service: string,
  countRaw: string,
  opts: { showService: boolean; showEmptyCount: boolean },
): { service: string | null; count: string | null } {
  const serviceError = isAiQuotaService(service) ? null : '请选择这项额度用于哪项 AI 服务。'
  const empty = countRaw.trim() === ''
  const countError = empty
    ? '请填写次数。'
    : parseAiQuotaCount(countRaw).ok
      ? null
      : '次数须为 1–9999 的整数。'
  return {
    service: opts.showService ? serviceError : null,
    count: empty ? (opts.showEmptyCount ? countError : null) : countError,
  }
}

export function buildGrantInput(draft: GrantDraft): GrantBenefitInput | null {
  const common = {
    endUserId: draft.endUserId,
    benefitType: draft.benefitType,
    sourceType: draft.sourceType,
    title: draft.title.trim() || defaultBenefitTitle(draft.benefitType),
    description: draft.description.trim() || null,
    validFrom: null,
    validUntil: draft.validUntil,
  }
  if (draft.benefitType === 'ai_quota') {
    if (!isAiQuotaService(draft.serviceKey)) return null
    const count = parseAiQuotaCount(draft.aiCount)
    if (!count.ok) return null
    return { ...common, serviceKey: draft.serviceKey, quantityTotal: count.value }
  }
  if (draft.benefitType === 'subsidy_eligibility_hint') {
    return { ...common, quantityTotal: null }
  }
  return { ...common, quantityTotal: Number(draft.quantityTotal || 1) }
}

export function benefitKindLine(item: { benefitType: string; serviceKey?: string | null }): string | null {
  if (item.benefitType !== 'ai_quota') return null
  const service = AI_QUOTA_SERVICES.find((entry) => entry.value === item.serviceKey)
  return `AI 额度 · ${service?.label ?? '未登记的服务'}`
}

export function quantityLine(item: Pick<AdminBenefitGrantItem, 'benefitType' | 'quantityTotal' | 'quantityRemaining'>): string {
  if (item.benefitType === 'ai_quota') {
    return `总次数 ${countText(item.quantityTotal)} · 剩余次数 ${countText(item.quantityRemaining)}`
  }
  return `额度 ${countText(item.quantityRemaining)} / ${countText(item.quantityTotal)}`
}

export function grantErrorMessage(error: unknown, fallback = '发放失败，请重试。'): string {
  const http = readHttpError(error)
  if (!http) return fallback
  const mapped = GRANT_ERROR_TEXT[http.code]
  if (mapped) return mapped
  const msg = http.message.trim()
  if (
    msg
    && /[\u4e00-\u9fff]/.test(msg)
    && !KEY_LEAK.test(msg)
    && !/\[object Object\]/.test(msg)
    && !/^HTTP[_\s]?\d+/i.test(msg)
  ) {
    return msg
  }
  return fallback
}

function countText(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '—'
}

function readHttpError(error: unknown): { code: string; message: string } | null {
  if (!error || typeof error !== 'object') return null
  const record = error as { name?: unknown; code?: unknown; message?: unknown }
  if (record.name !== 'ApiHttpError') return null
  if (typeof record.code !== 'string' || typeof record.message !== 'string') return null
  return { code: record.code, message: record.message }
}
