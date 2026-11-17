import { ORG_TYPE_SCENE_TEMPLATE, type PartnerType } from './partner'

/** 五个可按机器设价的服务。没有价目行 = 0。政策不在这里，永远免费。 */
export const TERMINAL_CHARGE_SERVICE_KEYS = [
  'resume_optimize',
  'mock_interview',
  'print_bw_page',
  'print_color_page',
  'scan',
] as const

export type TerminalChargeServiceKey = (typeof TERMINAL_CHARGE_SERVICE_KEYS)[number]

export const TERMINAL_USER_CHARGE_MODES = ['org_pays', 'user_pays'] as const

export type TerminalUserChargeMode = (typeof TERMINAL_USER_CHARGE_MODES)[number]

/** 屏上与后台用的名称，带计价单位。 */
export const TERMINAL_CHARGE_SERVICE_LABELS: Record<TerminalChargeServiceKey, string> = {
  resume_optimize: 'AI 简历优化（每次）',
  mock_interview: 'AI 模拟面试（每次）',
  print_bw_page: '黑白打印（每页）',
  print_color_page: '彩色打印（每页）',
  scan: '扫描（每次）',
}

export const TERMINAL_USER_CHARGE_MODE_LABELS: Record<TerminalUserChargeMode, string> = {
  org_pays: '机构或我方承担（用户免费）',
  user_pays: '向用户收费',
}

/** 只有字符串 "true" 算打开。没有这一行、其他值都算关。 */
export const PERSONAL_CHARGE_SETTING_KEY = 'charge.personalCharge.enabled'

/** 单价上限（分）。再高视为填错，不写入。 */
export const TERMINAL_CHARGE_MAX_UNIT_CENTS = 100_000

/**
 * 公共就业点位。从机构类型 → 场景模板那张表里推出映射到 public_employment 的类型，
 * 不另抄一份名单。这三类永远不向求职者收费。
 */
export const PUBLIC_EMPLOYMENT_ORG_TYPES: readonly PartnerType[] = (
  Object.keys(ORG_TYPE_SCENE_TEMPLATE) as PartnerType[]
).filter((type) => ORG_TYPE_SCENE_TEMPLATE[type] === 'public_employment')

export function isPublicEmploymentOrgType(type: string | null | undefined): boolean {
  return type != null && (PUBLIC_EMPLOYMENT_ORG_TYPES as readonly string[]).includes(type)
}

export type EffectivePriceReason =
  | 'public_site'
  | 'personal_charge_off'
  | 'org_pays'
  | 'user_pays'
  | 'no_terminal'

export interface EffectiveServicePrice {
  configuredCents: number
  effectiveCents: number
  reason: EffectivePriceReason
}

export interface EffectiveUserPrices {
  userChargeMode: TerminalUserChargeMode
  personalChargeEnabled: boolean
  isPublicSite: boolean
  prices: Record<TerminalChargeServiceKey, EffectiveServicePrice>
}

/** 一体机配置里下发的本机价。只含生效价，不含配置底稿。 */
export interface TerminalPricingView {
  personalChargeEnabled: boolean
  userChargeMode: TerminalUserChargeMode
  isPublicSite: boolean
  effective: Record<TerminalChargeServiceKey, number>
}

/** 机构后台只读。不含终端内部 id。 */
export interface PartnerTerminalChargeView {
  userChargeMode: TerminalUserChargeMode
  isPublicSite: boolean
  effective: Record<TerminalChargeServiceKey, number>
}
