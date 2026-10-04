import { suppressAggregateCount } from './console-screen.metric'

/**
 * 一行的残差保护。输入 null 仅指尚未发生的时段，不参与 m/r。
 * 0 与 1–4 同样不写数字；必要时再隐藏最小的可见格（并列取最早）。
 * 有窗口之外的未知部分时，合计不能唯一约束本行，不补充隐藏。
 */
export function suppressResidualRow(
  counts: readonly (number | null)[],
  hasUnknownOutside: boolean,
): Array<number | null> {
  const shown = counts.map((count) => {
    if (count === null) return null
    const value = suppressAggregateCount(count)
    return value === 0 ? null : value
  })
  let m = 0
  let r = 0
  let smallest = -1
  counts.forEach((count, index) => {
    if (count === null) return
    if (shown[index] === null) {
      m += 1
      r += count
    } else if (smallest < 0 || count < counts[smallest]!) {
      smallest = index
    }
  })
  const uniqueResidual = (m === 1 && r >= 1 && r <= 4) || (r > 0 && r === 4 * m)
  if (!hasUnknownOutside && uniqueResidual && smallest >= 0) shown[smallest] = null
  return shown
}
