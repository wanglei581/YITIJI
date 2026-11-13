// 管理员演示数据里的终端收费。示例价是整数 1 元，不是真实价格。
// 总开关默认关。公共点位写向用户收费或大于 0 会拒绝，不改内存里的底稿。

import {
  TERMINAL_CHARGE_SERVICE_KEYS,
  type EffectivePriceReason,
  type EffectiveUserPrices,
  type TerminalChargeServiceKey,
  type TerminalUserChargeMode,
} from '@ai-job-print/shared'
import { ApiHttpError } from './client'

export interface DemoChargeSettings extends EffectiveUserPrices {
  terminalCode: string
  orgBound: boolean
}

interface DemoRow {
  id: string
  terminalCode: string
  displayName: string | null
  locationLabel: string | null
  userChargeMode: TerminalUserChargeMode
  configured: Record<TerminalChargeServiceKey, number>
  isPublicSite: boolean
  orgBound: boolean
}

/** 示例，不是真实价格。1 元 = 100 分。 */
const EXAMPLE_CENTS = 100

let personalChargeEnabled = false
const rows = new Map<string, DemoRow>()

function zeros(): Record<TerminalChargeServiceKey, number> {
  return {
    resume_optimize: 0,
    mock_interview: 0,
    print_bw_page: 0,
    print_color_page: 0,
    scan: 0,
  }
}

function examplePrices(): Record<TerminalChargeServiceKey, number> {
  return {
    resume_optimize: EXAMPLE_CENTS,
    mock_interview: EXAMPLE_CENTS,
    print_bw_page: EXAMPLE_CENTS,
    print_color_page: EXAMPLE_CENTS,
    scan: EXAMPLE_CENTS,
  }
}

function reasonFor(row: DemoRow): EffectivePriceReason {
  if (row.isPublicSite) return 'public_site'
  if (!personalChargeEnabled) return 'personal_charge_off'
  if (row.userChargeMode !== 'user_pays') return 'org_pays'
  return 'user_pays'
}

function toView(row: DemoRow): DemoChargeSettings {
  const reason = reasonFor(row)
  const prices = {} as EffectiveUserPrices['prices']
  for (const key of TERMINAL_CHARGE_SERVICE_KEYS) {
    const configuredCents = row.configured[key] ?? 0
    prices[key] = {
      configuredCents,
      effectiveCents: reason === 'user_pays' ? configuredCents : 0,
      reason,
    }
  }
  return {
    terminalCode: row.terminalCode,
    userChargeMode: row.userChargeMode,
    personalChargeEnabled,
    isPublicSite: row.isPublicSite,
    orgBound: row.orgBound,
    prices,
  }
}

export function rememberDemoTerminal(input: {
  id: string
  terminalCode: string
  displayName: string | null
  locationLabel: string | null
  orgBound: boolean
  isPublicSite?: boolean
  userChargeMode?: TerminalUserChargeMode
  configured?: Record<TerminalChargeServiceKey, number>
}): void {
  if (rows.has(input.id)) {
    const row = rows.get(input.id)!
    row.displayName = input.displayName
    row.locationLabel = input.locationLabel
    row.terminalCode = input.terminalCode
    return
  }
  rows.set(input.id, {
    id: input.id,
    terminalCode: input.terminalCode,
    displayName: input.displayName,
    locationLabel: input.locationLabel,
    userChargeMode: input.userChargeMode ?? 'org_pays',
    configured: input.configured ?? zeros(),
    isPublicSite: input.isPublicSite === true,
    orgBound: input.orgBound,
  })
}

export function demoChargeSummary(id: string): EffectiveUserPrices {
  const row = rows.get(id)
  if (!row) {
    return toView({
      id,
      terminalCode: id,
      displayName: null,
      locationLabel: null,
      userChargeMode: 'org_pays',
      configured: zeros(),
      isPublicSite: false,
      orgBound: false,
    })
  }
  const view = toView(row)
  return {
    userChargeMode: view.userChargeMode,
    personalChargeEnabled: view.personalChargeEnabled,
    isPublicSite: view.isPublicSite,
    prices: view.prices,
  }
}

export interface DemoChargeTerminalRecord {
  id: string
  terminalCode: string
  displayName: string
  locationLabel: string
  orgId: string | null
  orgName: string | null
  orgType: string | null
}

/** 自营、高校、零工之家各一台。名称和点位用青岛的区。 */
export function demoChargeTerminals(): DemoChargeTerminalRecord[] {
  return [
    {
      id: 'demo-charge-self',
      terminalCode: 'QD-SN-SELF',
      displayName: '市南自营',
      locationLabel: '青岛市市南区香港中路',
      orgId: null,
      orgName: null,
      orgType: null,
    },
    {
      id: 'demo-charge-school',
      terminalCode: 'QD-LS-CAMPUS',
      displayName: '青岛大学就业中心',
      locationLabel: '青岛市崂山区松岭路',
      orgId: 'demo-org-qdu',
      orgName: '青岛大学',
      orgType: 'school',
    },
    {
      id: 'demo-charge-gig',
      terminalCode: 'QD-SB-GIG',
      displayName: '市北区零工之家',
      locationLabel: '青岛市市北区辽宁路',
      orgId: 'demo-org-gig',
      orgName: '市北区零工之家',
      orgType: 'gig_worker_home',
    },
  ]
}

export function seedDemoChargeTerminals(): void {
  rememberDemoTerminal({
    id: 'demo-charge-self',
    terminalCode: 'QD-SN-SELF',
    displayName: '市南自营',
    locationLabel: '青岛市市南区香港中路',
    orgBound: false,
    isPublicSite: false,
    userChargeMode: 'user_pays',
    configured: examplePrices(),
  })
  rememberDemoTerminal({
    id: 'demo-charge-school',
    terminalCode: 'QD-LS-CAMPUS',
    displayName: '青岛大学就业中心',
    locationLabel: '青岛市崂山区松岭路',
    orgBound: true,
    isPublicSite: false,
    userChargeMode: 'org_pays',
    configured: zeros(),
  })
  rememberDemoTerminal({
    id: 'demo-charge-gig',
    terminalCode: 'QD-SB-GIG',
    displayName: '市北区零工之家',
    locationLabel: '青岛市市北区辽宁路',
    orgBound: true,
    isPublicSite: true,
    userChargeMode: 'org_pays',
    configured: zeros(),
  })
}

function requireRow(terminalId: string): DemoRow {
  const row = rows.get(terminalId)
  if (!row) throw new ApiHttpError('TERMINAL_NOT_FOUND', '终端不存在', 404)
  return row
}

export async function demoGetChargeSettings(terminalId: string): Promise<DemoChargeSettings> {
  return toView(requireRow(terminalId))
}

export async function demoSaveChargeSettings(
  terminalId: string,
  body: { userChargeMode: TerminalUserChargeMode; prices: Record<TerminalChargeServiceKey, number> },
): Promise<DemoChargeSettings> {
  const row = requireRow(terminalId)
  const charging = body.userChargeMode === 'user_pays' || TERMINAL_CHARGE_SERVICE_KEYS.some((key) => body.prices[key] > 0)
  if (row.isPublicSite && charging) {
    throw new ApiHttpError('PUBLIC_SITE_ALWAYS_FREE', '公共就业点位永远不向求职者收费', 409)
  }
  row.userChargeMode = body.userChargeMode
  row.configured = { ...body.prices }
  return toView(row)
}

export interface DemoPersonalChargeOverview {
  enabled: boolean
  terminals: Array<{
    terminalCode: string
    displayName: string | null
    locationLabel: string | null
    prices: Record<TerminalChargeServiceKey, number>
  }>
}

function overview(): DemoPersonalChargeOverview {
  const terminals = [...rows.values()]
    .filter((row) => row.userChargeMode === 'user_pays' && !row.isPublicSite)
    .filter((row) => TERMINAL_CHARGE_SERVICE_KEYS.some((key) => (row.configured[key] ?? 0) > 0))
    .sort((a, b) => a.terminalCode.localeCompare(b.terminalCode))
    .map((row) => ({
      terminalCode: row.terminalCode,
      displayName: row.displayName,
      locationLabel: row.locationLabel,
      prices: { ...row.configured },
    }))
  return { enabled: personalChargeEnabled, terminals }
}

export async function demoGetPersonalCharge(): Promise<DemoPersonalChargeOverview> {
  seedDemoChargeTerminals()
  return overview()
}

export async function demoSetPersonalCharge(
  enabled: boolean,
  confirm: boolean | undefined,
): Promise<DemoPersonalChargeOverview & { previous: boolean }> {
  if (enabled && confirm !== true) {
    throw new ApiHttpError('PERSONAL_CHARGE_CONFIRM_REQUIRED', '打开向个人收费必须确认', 400)
  }
  const previous = personalChargeEnabled
  personalChargeEnabled = enabled
  return { ...overview(), previous }
}
