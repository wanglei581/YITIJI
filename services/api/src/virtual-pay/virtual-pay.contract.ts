/**
 * 小程序微信虚拟支付契约。
 *
 * 只卖两种 AI 单次服务，不卖次数包。价格和道具 ID 不进仓库：
 * 这里只有键名、字符集和已有的金额上限。真实道具与价格只存在 PlatformSetting。
 */
import { TERMINAL_CHARGE_MAX_UNIT_CENTS } from '../payment/terminal-charge.contract'

export const MINIAPP_VIRTUAL_PAY_ENABLED_KEY = 'charge.miniappVirtualPay.enabled'

/** 一体机用小程序已购虚拟支付权益抵扣后落入 ServiceOrder 的 provider 标识。 */
export const MINIAPP_CREDIT_PROVIDER = 'miniapp_credit'

/** 微信虚拟支付官方退款有效期（核对表 5.1）：支付后 365 天内。 */
export const VIRTUAL_PAY_REFUND_WINDOW_DAYS = 365
export const VIRTUAL_PAY_REFUND_WINDOW_MS = VIRTUAL_PAY_REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000

/** 微信 /xpay/refund_order 的 req_from（字符串）：1 = 人工客服/后台退款，2 = 用户自行发起，3 = 其他。 */
export const VIRTUAL_PAY_REFUND_REQ_FROM_MERCHANT = '1' as const

/**
 * 微信 /xpay/query_order 官方订单状态：
 * - 2/3/4：已支付（待发货 / 发货中 / 已发货）
 * - 5：商户侧扣款完成（退款进行中，不可凭 left_fee=0 提前判成功）
 * - 6：订单关闭（绝非退款成功）
 * - 7：退款失败
 * - 8：用户侧收款完成（渠道退款完成事实）
 */
export const WECHAT_VPAY_STATUS_REFUND_DEDUCTED = 5
export const WECHAT_VPAY_STATUS_CLOSED = 6
export const WECHAT_VPAY_STATUS_REFUND_FAILED = 7
export const WECHAT_VPAY_STATUS_REFUND_SUCCEEDED = 8

/** 微信 /xpay/refund_order 的 refund_reason（字符串 '0'–'5'）。核对表 3.11、补充规则 18。 */
export const VIRTUAL_PAY_REFUND_REASONS = ['0', '1', '2', '3', '4', '5'] as const
export type VirtualPayRefundReasonCode = (typeof VIRTUAL_PAY_REFUND_REASONS)[number]

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
