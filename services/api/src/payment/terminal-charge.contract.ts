/**
 * 终端收费契约的服务端副本。
 *
 * 契约源：packages/shared/src/types/terminalCharge.ts
 *
 * 不从服务端源码直接 import @ai-job-print/shared：本包是 commonjs + node
 * moduleResolution，shared 的 exports 指向 .ts，编译后的 `node dist/main.js`
 * 加载不了。键、上限、总开关键与共享包必须一致，由
 * verify:terminal-charge-settings 核对。
 *
 * 公共就业三类不在这里抄名单。服务端权威是 `ORG_TYPE_MATRIX`（与共享包
 * `ORG_TYPE_SCENE_TEMPLATE` 同一张对应关系），sceneTemplate 为
 * public_employment 的类型一律锁 0。
 */
import { ORG_TYPE_MATRIX } from '../orgs/admin-orgs.service'

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

export const PERSONAL_CHARGE_SETTING_KEY = 'charge.personalCharge.enabled'

export const TERMINAL_CHARGE_MAX_UNIT_CENTS = 100_000

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

export interface TerminalPricingView {
  personalChargeEnabled: boolean
  userChargeMode: TerminalUserChargeMode
  isPublicSite: boolean
  effective: Record<TerminalChargeServiceKey, number>
}

export interface PartnerTerminalChargeView {
  userChargeMode: TerminalUserChargeMode
  isPublicSite: boolean
  effective: Record<TerminalChargeServiceKey, number>
}

export function isPublicEmploymentOrgType(type: string | null | undefined): boolean {
  if (type == null || type === '') return false
  return ORG_TYPE_MATRIX[type]?.sceneTemplate === 'public_employment'
}
