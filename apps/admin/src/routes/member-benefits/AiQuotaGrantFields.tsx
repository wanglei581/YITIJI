export const AI_QUOTA_PURPOSES = [
  { value: 'ai_resume', label: '简历类' },
  { value: 'ai_assistant', label: '小青' },
  { value: 'ai_interview', label: '模拟面试' },
] as const

export type AiQuotaPurpose = (typeof AI_QUOTA_PURPOSES)[number]['value']

const BENEFIT_TYPE_LABEL: Record<string, string> = {
  coupon: '优惠券',
  free_quota: '免费次数',
  package_entitlement: '服务额度',
  ai_quota: 'AI 次数',
  subsidy_eligibility_hint: '政策资格提示',
}

export function benefitTypeLabel(benefitType: string): string {
  return BENEFIT_TYPE_LABEL[benefitType] ?? '其他权益'
}

export function aiQuotaPurposeLabel(serviceKey: string | null | undefined): string | null {
  return AI_QUOTA_PURPOSES.find((item) => item.value === serviceKey)?.label ?? null
}

/** 用途必选其一，数量为 1–9999 的整数。空字符串表示还没填。 */
export function validateAiQuotaGrant(serviceKey: string, quantity: string): string | null {
  if (!AI_QUOTA_PURPOSES.some((item) => item.value === serviceKey)) return '请选择 AI 次数的用途'
  const text = quantity.trim()
  if (!/^\d+$/.test(text)) return 'AI 次数必须为 1–9999 的整数'
  const value = Number(text)
  if (!Number.isInteger(value) || value < 1 || value > 9999) return 'AI 次数必须为 1–9999 的整数'
  return null
}

export function aiQuotaGrantExtra(serviceKey: string, quantity: string): { serviceKey: AiQuotaPurpose; quantityTotal: number } {
  const problem = validateAiQuotaGrant(serviceKey, quantity)
  if (problem) throw new Error(problem)
  return { serviceKey: serviceKey as AiQuotaPurpose, quantityTotal: Number(quantity.trim()) }
}

export function AiQuotaGrantFields({
  serviceKey,
  quantity,
  onServiceKey,
  onQuantity,
}: {
  serviceKey: string
  quantity: string
  onServiceKey: (value: AiQuotaPurpose) => void
  onQuantity: (value: string) => void
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-medium text-neutral-500" htmlFor="ai-quota-purpose">用途</label>
        <select
          id="ai-quota-purpose"
          value={serviceKey}
          onChange={(event) => onServiceKey(event.target.value as AiQuotaPurpose)}
          className="mt-1 h-10 w-full rounded-lg border border-neutral-200 px-3 text-sm"
          required
        >
          <option value="">请选择用途</option>
          {AI_QUOTA_PURPOSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </div>
      <div>
        <label className="text-xs font-medium text-neutral-500" htmlFor="ai-quota-quantity">数量</label>
        <input
          id="ai-quota-quantity"
          value={quantity}
          onChange={(event) => onQuantity(event.target.value)}
          type="number"
          min={1}
          max={9999}
          step={1}
          required
          inputMode="numeric"
          className="mt-1 h-10 w-full rounded-lg border border-neutral-200 px-3 text-sm"
        />
      </div>
    </div>
  )
}
