// ============================================================
// 打印单价常量 —— Sprint 1 / Task 1 预留的「未来计费唯一真相源」。
//
// 与 Kiosk 前端展示价对齐（apps/kiosk PrintConfirmPage：黑白 ¥0.2/面、彩色 ¥0.5/面）。
// 这里用整数「分」存储，绝不用浮点，避免金额累加误差。
//
// ⚠️ 本阶段（Sprint 1）**不接真实支付，也不计算订单总价**：
//   - 后端在「不改 Kiosk 前端调用方式」的前提下拿不到可靠页数(pageCount)，
//     绝不用 pageCount=1 之类的 fallback 伪造误导性金额。
//   - 因此创建订单时 amountCents 恒为 0（'未计费'），payStatus='unpaid'。
//   - 本常量仅作为未来真实计费 / 报价流程接通后的单价真相源预留，当前不被调用计算总价。
//
// TODO: calculate amountCents after reliable page count / quote flow is connected.
//   届时按「每面单价 × 总面数」计算：
//     facesPerCopy = ceil(pageCount / pagesPerSheet)
//     totalFaces   = facesPerCopy * copies
//     amountCents  = totalFaces * PRINT_UNIT_PRICE_CENTS[colorMode]
//   单面/双面只影响用纸张数，不影响计费面数。
// ============================================================

// 与 packages/shared 的 PrintJobParams['colorMode'] 取值对齐（后端不直接依赖 shared 包）。
type ColorMode = 'black_white' | 'color'

/** 每「面」单价（单位：分 cent）。黑白 0.20 元 = 20 分；彩色 0.50 元 = 50 分。 */
export const PRINT_UNIT_PRICE_CENTS: Record<ColorMode, number> = {
  black_white: 20,
  color: 50,
}
