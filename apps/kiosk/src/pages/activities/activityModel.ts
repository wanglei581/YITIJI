import type { BenefitActivityListItem, BenefitActivitySourceType, BenefitActivityType } from '@ai-job-print/shared'
import { formatTime } from '../profile/assets/format'

export const SOURCE_LABEL: Record<BenefitActivitySourceType, string> = {
  platform: '平台活动',
  campus: '校园活动',
  gov: '政策提示',
  fair: '招聘会服务活动',
  partner: '合作机构活动',
}

export const TYPE_LABEL: Record<BenefitActivityType, string> = {
  coupon: '优惠券',
  free_quota: '免费次数',
  package_entitlement: '服务额度',
  ai_quota: 'AI 次数',
  subsidy_eligibility_hint: '政策资格提示',
}

/** 列表与详情都要能对上的五种状态。低库存对外写「名额有限」，原话留在 data-stock-label。 */
export type ActivityPhase = '可领取' | '即将领完' | '已领完' | '已结束' | '已领取'

export function activityPhase(item: BenefitActivityListItem): ActivityPhase {
  if (item.claimed) return '已领取'
  if (item.ended) return '已结束'
  if (item.soldOut) return '已领完'
  if (item.stockRemaining !== null && item.stockRemaining <= 5) return '即将领完'
  return '可领取'
}

export function quotaTag(phase: ActivityPhase): string | null {
  if (phase === '即将领完') return '名额有限'
  if (phase === '已领完') return '已领完'
  if (phase === '已结束') return '已结束'
  if (phase === '已领取') return '已领取'
  return null
}

export function rowMuted(item: BenefitActivityListItem): boolean {
  return Boolean(item.ended || item.soldOut)
}

export function validity(item: BenefitActivityListItem): string {
  if (item.validFrom && item.validUntil) return `${formatTime(item.validFrom)} 至 ${formatTime(item.validUntil)}`
  if (item.validUntil) return `有效期至 ${formatTime(item.validUntil)}`
  if (item.validFrom) return `自 ${formatTime(item.validFrom)} 起`
  return '以活动规则为准'
}

export function quantityText(item: BenefitActivityListItem): string {
  if (item.benefitType === 'subsidy_eligibility_hint') return '仅提供政策资格和官方入口指引'
  if (item.quantityTotal === null) return '一次性权益'
  return `${item.quantityTotal} 次 / 份服务额度`
}

export function parseRules(rulesText: string | null): string[] {
  if (!rulesText) return []
  return rulesText
    .split(/[；;。\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
}

export function participation(item: BenefitActivityListItem): string {
  const limit = item.claimLimitPerUser
  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) return `在本页领取，每人 ${limit} 次。`
  return '在本页领取。是否还能领，以系统返回为准。'
}

export const AI_DRAFT = '这个活动的规则我没看懂，能帮我解释一下吗？'

export const PILL_DEFAULT = '权益以你账号里的实际记录为准'

export const LIST_COMPLIANCE = '权益活动只用于本终端服务与打印辅助。政策资格提示只提供官方入口和材料指引；招聘会相关活动不生成报名、签到或投递凭证。'

export const FAIR_NOTE = '仅展示招聘会相关服务权益，不代表报名、签到或投递结果'

export const DETAIL_COMPLIANCE = '权益仅用于本终端服务与打印辅助，不代表招聘会报名、签到、投递结果、面试或录用承诺。'

export const SUBSIDY_COMPLIANCE = '本活动仅提供政策资格提示、材料说明和官方入口指引，具体申请、审核和结果以官方渠道为准。'

export const FEE_LINE = '是否收费、收多少，以活动说明为准；本机服务另按现场公示与系统报价结算。'

export const USE_LINE = '领取后记入「我的权益」；抵扣功能尚未开放，开放后可在下单时选择使用。'

export function countLine(total: number, shown: number): string {
  if (total > shown) return `共 ${total} 条，这里显示最近 ${shown} 条`
  return `共 ${total} 条`
}
