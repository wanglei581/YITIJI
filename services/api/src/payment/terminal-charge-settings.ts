import {
  PERSONAL_CHARGE_SETTING_KEY,
  TERMINAL_CHARGE_MAX_UNIT_CENTS,
  TERMINAL_CHARGE_SERVICE_KEYS,
  isPublicEmploymentOrgType,
  type EffectiveUserPrices,
  type TerminalChargeServiceKey,
  type TerminalUserChargeMode,
} from './terminal-charge.contract'
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import type { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service'
import { getEffectiveUserPrices, normalizeUserChargeMode } from './effective-user-prices'

export const TERMINAL_CHARGE_SETTINGS_AUDIT_ACTION = 'terminal.charge_settings.update'
export const TERMINAL_CHARGE_RESET_ON_REBIND_AUDIT_ACTION = 'terminal.charge_settings.reset_on_rebind'
export const PERSONAL_CHARGE_ENABLE_AUDIT_ACTION = 'billing.personal_charge.enable'
export const PERSONAL_CHARGE_DISABLE_AUDIT_ACTION = 'billing.personal_charge.disable'

type ChargeReadDb = Pick<PrismaTransactionClient, 'terminal' | 'platformSetting'>

export interface TerminalChargeSettingsView extends EffectiveUserPrices {
  terminalCode: string
  /** 绑了机构才为真。界面用来提示：机构买的机器不该用我方账户向用户收钱。 */
  orgBound: boolean
}

export interface PersonalChargeTerminalRow {
  terminalCode: string
  displayName: string | null
  locationLabel: string | null
  prices: Record<TerminalChargeServiceKey, number>
}

export interface PersonalChargeOverview {
  enabled: boolean
  /** 打开总开关后会开始向用户收费的机器：user_pays、非公共、至少一个价大于 0。 */
  terminals: PersonalChargeTerminalRow[]
}

function configuredFrom(prices: EffectiveUserPrices): Record<TerminalChargeServiceKey, number> {
  const out = {} as Record<TerminalChargeServiceKey, number>
  for (const key of TERMINAL_CHARGE_SERVICE_KEYS) out[key] = prices.prices[key].configuredCents
  return out
}

export async function getTerminalChargeSettings(
  db: ChargeReadDb,
  terminalId: string,
): Promise<TerminalChargeSettingsView> {
  const terminal = await db.terminal.findUnique({
    where: { id: terminalId },
    select: { id: true, terminalCode: true, orgId: true },
  })
  if (!terminal) {
    throw new NotFoundException({ error: { code: 'TERMINAL_NOT_FOUND', message: '终端不存在' } })
  }
  const prices = await getEffectiveUserPrices(db, terminal.id)
  return { ...prices, terminalCode: terminal.terminalCode, orgBound: terminal.orgId != null }
}

function parsePrices(raw: unknown): Record<TerminalChargeServiceKey, number> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BadRequestException({ error: { code: 'VALIDATION_FAILED', message: '五个价格必须一起提交' } })
  }
  const body = raw as Record<string, unknown>
  const keys = Object.keys(body)
  if (keys.length !== TERMINAL_CHARGE_SERVICE_KEYS.length || TERMINAL_CHARGE_SERVICE_KEYS.some((key) => !keys.includes(key))) {
    throw new BadRequestException({ error: { code: 'VALIDATION_FAILED', message: '必须正好提交五个服务的价格' } })
  }
  const prices = {} as Record<TerminalChargeServiceKey, number>
  for (const key of TERMINAL_CHARGE_SERVICE_KEYS) {
    const value = body[key]
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > TERMINAL_CHARGE_MAX_UNIT_CENTS) {
      throw new BadRequestException({
        error: { code: 'VALIDATION_FAILED', message: '价格必须是 0 到 100000 分之间的整数' },
      })
    }
    prices[key] = value
  }
  return prices
}

export function parseChargeSettingsBody(raw: { userChargeMode?: unknown; prices?: unknown }): {
  userChargeMode: TerminalUserChargeMode
  prices: Record<TerminalChargeServiceKey, number>
} {
  if (raw.userChargeMode !== 'org_pays' && raw.userChargeMode !== 'user_pays') {
    throw new BadRequestException({ error: { code: 'VALIDATION_FAILED', message: '谁付钱只许是机构承担或向用户收费' } })
  }
  return { userChargeMode: raw.userChargeMode, prices: parsePrices(raw.prices) }
}

export type ChargeSettingsAuditWriter = (
  tx: PrismaTransactionClient,
  saved: { previous: TerminalChargeSettingsView; next: TerminalChargeSettingsView },
) => Promise<unknown>

export async function saveTerminalChargeSettings(
  db: PrismaService,
  terminalId: string,
  raw: { userChargeMode?: unknown; prices?: unknown },
  adminId: string,
  writeAudit?: ChargeSettingsAuditWriter,
): Promise<{ previous: TerminalChargeSettingsView; next: TerminalChargeSettingsView }> {
  const input = parseChargeSettingsBody(raw)
  return db.$transaction(async (tx) => {
    const existing = await tx.terminal.findUnique({
      where: { id: terminalId },
      select: { id: true, org: { select: { type: true } } },
    })
    if (!existing) {
      throw new NotFoundException({ error: { code: 'TERMINAL_NOT_FOUND', message: '终端不存在' } })
    }
    const charging = input.userChargeMode === 'user_pays' || TERMINAL_CHARGE_SERVICE_KEYS.some((key) => input.prices[key] > 0)
    if (isPublicEmploymentOrgType(existing.org?.type) && charging) {
      throw new ConflictException({
        error: { code: 'PUBLIC_SITE_ALWAYS_FREE', message: '公共就业点位永远不向求职者收费' },
      })
    }
    const previous = await getTerminalChargeSettings(tx, terminalId)
    await tx.terminal.update({ where: { id: terminalId }, data: { userChargeMode: input.userChargeMode } })
    for (const key of TERMINAL_CHARGE_SERVICE_KEYS) {
      await tx.terminalServicePrice.upsert({
        where: { terminalId_serviceKey: { terminalId, serviceKey: key } },
        create: { terminalId, serviceKey: key, unitCents: input.prices[key], updatedByAdminId: adminId },
        update: { unitCents: input.prices[key], updatedByAdminId: adminId },
      })
    }
    const next = await getTerminalChargeSettings(tx, terminalId)
    if (writeAudit) await writeAudit(tx, { previous, next })
    return { previous, next }
  })
}

export function chargeAuditSnapshot(view: TerminalChargeSettingsView): {
  userChargeMode: TerminalUserChargeMode
  prices: Record<TerminalChargeServiceKey, number>
} {
  return { userChargeMode: normalizeUserChargeMode(view.userChargeMode), prices: configuredFrom(view) }
}

export async function listPersonalChargeOverview(db: PrismaService): Promise<PersonalChargeOverview> {
  const setting = await db.platformSetting.findUnique({ where: { key: PERSONAL_CHARGE_SETTING_KEY } })
  const enabled = setting?.value === 'true'
  const rows = await db.terminal.findMany({
    where: { userChargeMode: 'user_pays' },
    orderBy: { terminalCode: 'asc' },
    select: {
      terminalCode: true,
      displayName: true,
      locationLabel: true,
      org: { select: { type: true } },
      servicePrices: { select: { serviceKey: true, unitCents: true } },
    },
  })
  const terminals: PersonalChargeTerminalRow[] = []
  for (const row of rows) {
    if (isPublicEmploymentOrgType(row.org?.type)) continue
    const prices = configuredFrom({
      userChargeMode: 'user_pays',
      personalChargeEnabled: enabled,
      isPublicSite: false,
      prices: Object.fromEntries(TERMINAL_CHARGE_SERVICE_KEYS.map((key) => {
        const stored = row.servicePrices.find((item) => item.serviceKey === key)
        const configuredCents = stored?.unitCents ?? 0
        return [key, { configuredCents, effectiveCents: configuredCents, reason: 'user_pays' as const }]
      })) as EffectiveUserPrices['prices'],
    })
    if (!TERMINAL_CHARGE_SERVICE_KEYS.some((key) => prices[key] > 0)) continue
    terminals.push({
      terminalCode: row.terminalCode,
      displayName: row.displayName,
      locationLabel: row.locationLabel,
      prices,
    })
  }
  return { enabled, terminals }
}

export type PersonalChargeAuditWriter = (
  tx: PrismaTransactionClient,
  saved: { previous: boolean; next: boolean },
) => Promise<unknown>

export async function writePersonalChargeEnabled(
  db: PrismaService,
  enabled: boolean,
  confirm: boolean | undefined,
  operatorId: string,
  writeAudit?: PersonalChargeAuditWriter,
): Promise<{ previous: boolean; next: boolean }> {
  if (enabled && confirm !== true) {
    throw new BadRequestException({
      error: { code: 'PERSONAL_CHARGE_CONFIRM_REQUIRED', message: '打开向个人收费必须确认' },
    })
  }
  return db.$transaction(async (tx) => {
    const previousRow = await tx.platformSetting.findUnique({ where: { key: PERSONAL_CHARGE_SETTING_KEY } })
    const previous = previousRow?.value === 'true'
    const saved = { previous, next: enabled }
    await tx.platformSetting.upsert({
      where: { key: PERSONAL_CHARGE_SETTING_KEY },
      create: { key: PERSONAL_CHARGE_SETTING_KEY, value: enabled ? 'true' : 'false', updatedBy: operatorId },
      update: { value: enabled ? 'true' : 'false', updatedBy: operatorId },
    })
    if (writeAudit) await writeAudit(tx, saved)
    return saved
  })
}
