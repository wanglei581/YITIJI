/**
 * 小程序微信虚拟支付契约。
 *
 * 只卖两种 AI 单次服务，不卖次数包。价格和道具 ID 不进仓库：
 * 这里只有键名、字符集和已有的金额上限。真实道具与价格只存在 PlatformSetting。
 */
import { TERMINAL_CHARGE_MAX_UNIT_CENTS } from '../payment/terminal-charge.contract'

export const MINIAPP_VIRTUAL_PAY_ENABLED_KEY = 'charge.miniappVirtualPay.enabled'

export const MINIAPP_VIRTUAL_PAY_SERVICE_KINDS = ['resume_optimize', 'mock_interview'] as const

export type MiniappVirtualPayServiceKind = (typeof MINIAPP_VIRTUAL_PAY_SERVICE_KINDS)[number]

/** 官方道具 ID：长度 1–20，字母、数字、下划线、连字符。中文不收，避免和「一个汉字算一个字符」的口径打架。 */
const PRODUCT_ID_PATTERN = /^[A-Za-z0-9_-]{1,20}$/

export interface VirtualPayGoods {
  productId: string
  priceCents: number
}

export function isMiniappVirtualPayServiceKind(value: string): value is MiniappVirtualPayServiceKind {
  return (MINIAPP_VIRTUAL_PAY_SERVICE_KINDS as readonly string[]).includes(value)
}

export function goodsSettingKey(kind: MiniappVirtualPayServiceKind): string {
  return `charge.miniappVirtualPay.goods.${kind}`
}

export function parseVirtualPayGoodsValue(raw: string | null | undefined): VirtualPayGoods | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const productId = (parsed as { productId?: unknown }).productId
  const priceCents = (parsed as { priceCents?: unknown }).priceCents
  if (!isVirtualPayProductId(productId)) return null
  if (!isVirtualPayPriceCents(priceCents)) return null
  return { productId, priceCents }
}

export function isVirtualPayProductId(value: unknown): value is string {
  return typeof value === 'string' && PRODUCT_ID_PATTERN.test(value)
}

export function isVirtualPayPriceCents(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 1
    && value <= TERMINAL_CHARGE_MAX_UNIT_CENTS
}
