// 打印单价常量（**仅开发 seed 源**）。
//
// 运行期价目真相源是数据库 `PriceConfig`；Kiosk 展示/确认价走 `POST /orders/quote`。
// 本常量只供 `price-config.seed` 写入本地 / 临时库的开发默认价，非正式对外价。
// 生产写入见 `docs/operations/price-config-production.md`。

type ColorMode = 'black_white' | 'color'

/** 每「面」开发默认单价，单位为分。黑白 0.20 元 = 20 分;彩色 0.50 元 = 50 分。 */
export const PRINT_UNIT_PRICE_CENTS: Record<ColorMode, number> = {
  black_white: 20,
  color: 50,
}
