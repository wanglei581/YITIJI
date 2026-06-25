// 打印单价常量。
//
// 当前订单底座不计算总价、不接真实支付;amountCents 暂保持 0。
// 这里仅作为后续报价/支付流程的单价真相源,与 Kiosk 预览页展示价保持一致。

type ColorMode = 'black_white' | 'color'

/** 每「面」单价,单位为分。黑白 0.20 元 = 20 分;彩色 0.50 元 = 50 分。 */
export const PRINT_UNIT_PRICE_CENTS: Record<ColorMode, number> = {
  black_white: 20,
  color: 50,
}
