import { suppressAggregateCount } from './console-screen.metric'

/** 连续整数域的小型动态规划；补充隐藏格可吸收任意非负残差，没有上界。 */
function lowCellsAreAmbiguous(lowCount: number, residual: number, hasSupplement: boolean): boolean {
  let otherSums = new Set([0])
  for (let i = 1; i < lowCount; i += 1) {
    const next = new Set<number>()
    for (const sum of otherSums) for (let value = 1; value <= 4; value += 1) next.add(sum + value)
    otherSums = next
  }
  let possibilities = 0
  for (let value = 1; value <= 4; value += 1) {
    if ([...otherSums].some((sum) => hasSupplement ? sum + value <= residual : sum + value === residual)) possibilities += 1
  }
  return possibilities > 1
}

/**
 * 按公开合计保护真实1–4格，假设攻击者知道零值；未来null不参与。
 * 低频格先按1–4穷举，不安全则逐格隐藏最小可见正值（并列取最早）。
 * 补充隐藏类别不对外标记；没有可见格时，所有非零空格均可能是无上界的补充隐藏。
 * shown 可保留终端列的0及出纸组已隐藏格；热力图默认0与1–4同档。
 */
export function suppressResidualRow(
  counts: readonly (number | null)[],
  hasUnknownOutside: boolean,
  initiallyShown?: readonly (number | null)[],
): Array<number | null> {
  const shown = initiallyShown ? [...initiallyShown] : counts.map((count) => {
    if (count === null) return null
    const value = suppressAggregateCount(count)
    return value === 0 ? null : value
  })
  const total = counts.reduce<number>((sum, count) => sum + (count ?? 0), 0)
  const lowCount = counts.filter((count) => count !== null && suppressAggregateCount(count) === null).length
  // 非公开的小样本合计本身只有1–4这个范围；窗口之外另有未知量则不能精确相减。
  if (hasUnknownOutside || suppressAggregateCount(total) === null || lowCount === 0) return shown
  while (true) {
    let residual = 0
    let hasSupplement = false
    let smallest = -1
    counts.forEach((count, index) => {
      if (count === null || count === 0) return
      if (shown[index] === null) {
        residual += count
        if (suppressAggregateCount(count) !== null) hasSupplement = true
      } else if (smallest < 0 || count < counts[smallest]!) smallest = index
    })
    if (lowCellsAreAmbiguous(lowCount, residual, hasSupplement) || smallest < 0) return shown
    shown[smallest] = null
  }
}
