import {
  PERSONAL_CHARGE_SETTING_KEY,
  TERMINAL_CHARGE_MAX_UNIT_CENTS,
  TERMINAL_CHARGE_SERVICE_KEYS,
  isPublicEmploymentOrgType,
  type EffectivePriceReason,
  type EffectiveServicePrice,
  type EffectiveUserPrices,
  type PartnerTerminalChargeView,
  type TerminalChargeServiceKey,
  type TerminalPricingView,
  type TerminalUserChargeMode,
} from './terminal-charge.contract'
import type { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service'

/**
 * 用户实付的唯一算法。打印、复印、一体机配置、两个后台都调这里，不再各算一遍。
 *
 * 顺序（先命中的生效，后面的不看）：
 * 1. 没传终端或终端不存在 → 全部 0，reason = no_terminal
 * 2. 绑定机构属于公共就业三类 → 全部 0，reason = public_site（库里写了什么都不看）
 * 3. 总开关不是字符串 "true" → 全部 0，reason = personal_charge_off
 * 4. 模式不是 user_pays → 全部 0，reason = org_pays
 * 5. 否则 effectiveCents = 配置价，reason = user_pays。没有价目行 = 0。
 */
export interface ChargeTerminalRow {
  id: string
  userChargeMode: string
  org: { type: string } | null
  servicePrices: Array<{ serviceKey: string; unitCents: number }>
}

export function normalizeUserChargeMode(value: string | null | undefined): TerminalUserChargeMode {
  return value === 'user_pays' ? 'user_pays' : 'org_pays'
}

export function emptyConfiguredCents(): Record<TerminalChargeServiceKey, number> {
  return {
    resume_optimize: 0,
    mock_interview: 0,
    print_bw_page: 0,
    print_color_page: 0,
    scan: 0,
  }
}

export function decideEffectiveUserPrices(input: {
  terminalFound: boolean
  orgType: string | null
  userChargeMode: string | null
  personalChargeEnabled: boolean
  configuredCents: Partial<Record<TerminalChargeServiceKey, number>>
}): EffectiveUserPrices {
  const userChargeMode = input.terminalFound ? normalizeUserChargeMode(input.userChargeMode) : 'org_pays'
  const isPublicSite = input.terminalFound && isPublicEmploymentOrgType(input.orgType)
  let reason: EffectivePriceReason = 'user_pays'
  if (!input.terminalFound) reason = 'no_terminal'
  else if (isPublicSite) reason = 'public_site'
  else if (!input.personalChargeEnabled) reason = 'personal_charge_off'
  else if (userChargeMode !== 'user_pays') reason = 'org_pays'

  const prices = {} as Record<TerminalChargeServiceKey, EffectiveServicePrice>
  for (const key of TERMINAL_CHARGE_SERVICE_KEYS) {
    const stored = input.configuredCents[key]
    const configuredCents = stored === undefined ? 0 : stored
    prices[key] = {
      configuredCents,
      effectiveCents: reason === 'user_pays' ? configuredCents : 0,
      reason,
    }
  }
  return {
    userChargeMode,
    personalChargeEnabled: input.personalChargeEnabled,
    isPublicSite,
    prices,
  }
}

export function toPricingView(prices: EffectiveUserPrices): TerminalPricingView {
  const effective = emptyConfiguredCents()
  for (const key of TERMINAL_CHARGE_SERVICE_KEYS) effective[key] = prices.prices[key].effectiveCents
  return {
    personalChargeEnabled: prices.personalChargeEnabled,
    userChargeMode: prices.userChargeMode,
    isPublicSite: prices.isPublicSite,
    effective,
  }
}

export function toPartnerChargeView(prices: EffectiveUserPrices): PartnerTerminalChargeView {
  const view = toPricingView(prices)
  return {
    userChargeMode: view.userChargeMode,
    isPublicSite: view.isPublicSite,
    effective: view.effective,
  }
}

type ChargeReadDb = Pick<PrismaTransactionClient, 'terminal' | 'platformSetting'>

export async function readPersonalChargeEnabled(db: Pick<PrismaService, 'platformSetting'>): Promise<boolean> {
  const row = await db.platformSetting.findUnique({ where: { key: PERSONAL_CHARGE_SETTING_KEY } })
  return row?.value === 'true'
}

export async function getEffectiveUserPrices(
  db: ChargeReadDb,
  terminalId: string | null | undefined,
): Promise<EffectiveUserPrices> {
  const personalChargeEnabled = await readPersonalChargeEnabled(db)
  const ref = terminalId?.trim()
  if (!ref) {
    return decideEffectiveUserPrices({
      terminalFound: false,
      orgType: null,
      userChargeMode: null,
      personalChargeEnabled,
      configuredCents: {},
    })
  }
  const include = { org: { select: { type: true } }, servicePrices: true } as const
  const byId = await db.terminal.findUnique({ where: { id: ref }, include })
  const terminal = byId ?? await db.terminal.findUnique({ where: { terminalCode: ref }, include })
  if (!terminal) {
    return decideEffectiveUserPrices({
      terminalFound: false,
      orgType: null,
      userChargeMode: null,
      personalChargeEnabled,
      configuredCents: {},
    })
  }
  const configuredCents: Partial<Record<TerminalChargeServiceKey, number>> = {}
  for (const row of terminal.servicePrices) {
    if ((TERMINAL_CHARGE_SERVICE_KEYS as readonly string[]).includes(row.serviceKey)) {
      configuredCents[row.serviceKey as TerminalChargeServiceKey] = row.unitCents
    }
  }
  return decideEffectiveUserPrices({
    terminalFound: true,
    orgType: terminal.org?.type ?? null,
    userChargeMode: terminal.userChargeMode,
    personalChargeEnabled,
    configuredCents,
  })
}

/** 向用户收费时，配置价必须是 0 到上限之间的整数。其他原因生效价已被压成 0，不在这里拦。 */
export function assertUserPaysUnit(row: EffectiveServicePrice): void {
  if (row.reason !== 'user_pays') return
  if (!Number.isInteger(row.configuredCents) || row.configuredCents < 0 || row.configuredCents > TERMINAL_CHARGE_MAX_UNIT_CENTS) {
    throw new Error('PRICE_CONFIG_INVALID')
  }
}
