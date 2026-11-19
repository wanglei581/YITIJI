import { BadRequestException } from '@nestjs/common'
import { readPersonalChargeEnabled } from '../payment/effective-user-prices'
import type { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service'
import {
  MINIAPP_VIRTUAL_PAY_ENABLED_KEY,
  MINIAPP_VIRTUAL_PAY_SERVICE_KINDS,
  goodsSettingKey,
  isMiniappVirtualPayServiceKind,
  isVirtualPayPriceCents,
  isVirtualPayProductId,
  parseVirtualPayGoodsValue,
  type MiniappVirtualPayServiceKind,
  type VirtualPayGoods,
} from './virtual-pay.contract'

export const MINIAPP_VIRTUAL_PAY_ENABLE_AUDIT_ACTION = 'billing.miniapp_virtual_pay.enable'
export const MINIAPP_VIRTUAL_PAY_DISABLE_AUDIT_ACTION = 'billing.miniapp_virtual_pay.disable'
export const MINIAPP_VIRTUAL_PAY_GOODS_AUDIT_ACTION = 'billing.miniapp_virtual_pay.goods_update'

export interface VirtualPayGoodsView {
  configured: boolean
  productId: string | null
  priceCents: number | null
}

export interface VirtualPaySettingsView {
  enabled: boolean
  personalChargeEnabled: boolean
  canSell: boolean
  goods: Record<MiniappVirtualPayServiceKind, VirtualPayGoodsView>
}

type SettingsDb = Pick<PrismaService, 'platformSetting' | '$transaction'>

export async function readMiniappVirtualPayEnabled(
  db: Pick<PrismaService, 'platformSetting'>,
): Promise<boolean> {
  const row = await db.platformSetting.findUnique({ where: { key: MINIAPP_VIRTUAL_PAY_ENABLED_KEY } })
  return row?.value === 'true'
}

export async function readConfiguredVirtualPayGoods(
  db: Pick<PrismaService, 'platformSetting'>,
  kind: MiniappVirtualPayServiceKind,
): Promise<VirtualPayGoods | null> {
  const row = await db.platformSetting.findUnique({ where: { key: goodsSettingKey(kind) } })
  return parseVirtualPayGoodsValue(row?.value)
}

export async function readVirtualPaySettings(db: Pick<PrismaService, 'platformSetting'>): Promise<VirtualPaySettingsView> {
  const enabled = await readMiniappVirtualPayEnabled(db)
  const personalChargeEnabled = await readPersonalChargeEnabled(db)
  const rows = await db.platformSetting.findMany({
    where: { key: { in: MINIAPP_VIRTUAL_PAY_SERVICE_KINDS.map((kind) => goodsSettingKey(kind)) } },
  })
  const goods = {} as Record<MiniappVirtualPayServiceKind, VirtualPayGoodsView>
  for (const kind of MINIAPP_VIRTUAL_PAY_SERVICE_KINDS) {
    const row = rows.find((item) => item.key === goodsSettingKey(kind))
    const parsed = parseVirtualPayGoodsValue(row?.value)
    goods[kind] = parsed
      ? { configured: true, productId: parsed.productId, priceCents: parsed.priceCents }
      : { configured: false, productId: null, priceCents: null }
  }
  return { enabled, personalChargeEnabled, canSell: enabled && personalChargeEnabled, goods }
}

export type VirtualPaySwitchAuditWriter = (
  tx: PrismaTransactionClient,
  saved: { previous: boolean; next: boolean },
) => Promise<unknown>

export async function writeMiniappVirtualPayEnabled(
  db: SettingsDb,
  enabled: boolean,
  confirm: boolean | undefined,
  operatorId: string,
  writeAudit?: VirtualPaySwitchAuditWriter,
): Promise<{ previous: boolean; next: boolean }> {
  if (enabled && confirm !== true) {
    throw new BadRequestException({
      error: { code: 'VPAY_CONFIRM_REQUIRED', message: '打开小程序虚拟支付必须确认' },
    })
  }
  return db.$transaction(async (tx) => {
    const previousRow = await tx.platformSetting.findUnique({ where: { key: MINIAPP_VIRTUAL_PAY_ENABLED_KEY } })
    const previous = previousRow?.value === 'true'
    const saved = { previous, next: enabled }
    await tx.platformSetting.upsert({
      where: { key: MINIAPP_VIRTUAL_PAY_ENABLED_KEY },
      create: { key: MINIAPP_VIRTUAL_PAY_ENABLED_KEY, value: enabled ? 'true' : 'false', updatedBy: operatorId },
      update: { value: enabled ? 'true' : 'false', updatedBy: operatorId },
    })
    if (writeAudit) await writeAudit(tx, saved)
    return saved
  })
}

export type VirtualPayGoodsAuditWriter = (
  tx: PrismaTransactionClient,
  saved: { serviceKind: MiniappVirtualPayServiceKind; productId: string; priceCents: number },
) => Promise<unknown>

export async function writeVirtualPayGoods(
  db: SettingsDb,
  serviceKind: string,
  productId: string,
  priceCents: number,
  confirm: boolean | undefined,
  operatorId: string,
  writeAudit?: VirtualPayGoodsAuditWriter,
): Promise<VirtualPayGoods & { serviceKind: MiniappVirtualPayServiceKind }> {
  if (!isMiniappVirtualPayServiceKind(serviceKind)) {
    throw new BadRequestException({
      error: { code: 'VPAY_SERVICE_KIND_INVALID', message: '只能配置简历优化或模拟面试' },
    })
  }
  if (confirm !== true) {
    throw new BadRequestException({
      error: { code: 'VPAY_GOODS_CONFIRM_REQUIRED', message: '写入虚拟支付道具必须确认' },
    })
  }
  if (!isVirtualPayProductId(productId)) {
    throw new BadRequestException({
      error: { code: 'VPAY_PRODUCT_ID_INVALID', message: '道具 ID 只允许 1 到 20 位字母、数字、下划线或连字符' },
    })
  }
  if (!isVirtualPayPriceCents(priceCents)) {
    throw new BadRequestException({
      error: { code: 'VPAY_PRICE_INVALID', message: '价格必须是大于 0 的整数分，且不超过已有上限' },
    })
  }
  const saved = { serviceKind, productId, priceCents }
  const key = goodsSettingKey(serviceKind)
  const value = JSON.stringify({ productId, priceCents })
  await db.$transaction(async (tx) => {
    await tx.platformSetting.upsert({
      where: { key },
      create: { key, value, updatedBy: operatorId },
      update: { value, updatedBy: operatorId },
    })
    if (writeAudit) await writeAudit(tx, saved)
  })
  return saved
}
