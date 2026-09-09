// ============================================================
// 价目描述与实际单价的一致性判据（写入闸门与公开视图共用一份实现）
//
// 为什么单独成文件：改价和改描述是两个字段，只改其中一个不会有任何提示，
// 于是「描述说 0 元、实际收 1 元」这种自相矛盾的行会长期留在库里。
// 2026-09-09 生产实测到的就是这一行：
//   print_color_page  unitCents=100  description='免费试运营：彩色打印 0 元/页'
//
// 两个使用方对同一判据要做**不同的事**，所以判据必须是同一份：
// - 管理端写入（PUT /admin/billing/price-config/:serviceKey）→ 直接拒绝，让人当场改对。
// - 公开只读视图（GET /print/price-config，匿名可读）→ 不拒绝、不改金额，
//   只把**自相矛盾的那句描述**摘掉。库里既有的坏行早于闸门存在，
//   公开接口不该把它继续播出去；金额始终照发，前端估价不受影响。
//
// 判据故意留松：描述里但凡有**一个** N 元与实际单价相等就算一致
// （允许「原价 2 元，现 1 元」这类写法）；一个都对不上才算矛盾。
// 描述里根本没写金额（如「黑白打印每页」）不受约束 —— 那不是在陈述价格。
// ============================================================

/** 抽出描述里所有「N 元」的 N（元，可含小数）。没写金额时返回空数组。 */
export function statedYuanIn(description: string | null | undefined): number[] {
  if (!description) return []
  return [...description.matchAll(/(\d+(?:\.\d+)?)\s*元/g)].map((m) => Number(m[1]))
}

/**
 * 描述是否与实际单价自相矛盾。
 * 没写金额 → false（不受约束）；写了金额且没有一个对得上 → true。
 */
export function descriptionContradictsAmount(
  description: string | null | undefined,
  unitCents: number
): boolean {
  const stated = statedYuanIn(description)
  if (stated.length === 0) return false
  const actualYuan = unitCents / 100
  return !stated.some((y) => Math.abs(y - actualYuan) < 1e-9)
}
