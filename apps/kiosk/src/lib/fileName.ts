// ============================================================
// 文件名中段截断 —— 保住扩展名与尾部区分信息
//
// 背景（2026-08-18 打印域走查）：打印上传页的文件名全部用 Tailwind `truncate`
// （= overflow:hidden + text-overflow:ellipsis + white-space:nowrap），只截**尾部**。
// 「我的简历_张三_2026版_最终.pdf」会显示成「我的简历_张三_2026版_最终...」——
// 扩展名和最能区分文件的尾部信息一起丢掉。
//
// 打印场景里用户经常要在几份高度相似的文件里挑一个（同一份简历的多个版本、
// 同名不同格式的 PDF/DOCX），尾部恰恰是唯一的区分位。截尾直接影响他选对没有。
//
// 规则：超出预算时保留「头部 + 省略号 + 尾部」，尾部长度自动放大到足以覆盖扩展名，
// 因此扩展名一定在结果里。按 Unicode 码点切分，中文文件名不会被切出半个字。
// ============================================================

const ELLIPSIS = '…'

/** 扩展名最长按 10 个码点认（含点）。超过则不当扩展名，避免「.」后跟长串时吃光预算。 */
const MAX_EXTENSION_LENGTH = 10

/** 尾部在扩展名之外额外保留的区分位（版本号 / 日期 / 「最终」这类后缀）。 */
const TAIL_DISTINGUISHING_CHARS = 4

/**
 * 与容器宽度对应的字符预算。一体机固定 1080×1920 竖屏，宽度可预期，
 * 因此用固定码点预算而不是运行时测量：结果稳定、可被 verify 脚本按行为验。
 * 预算刻意取在 CSS `truncate` 实际触发宽度之下，所以 CSS 只作兜底、正常不触发。
 */
/** 与状态文案共用一行的紧凑行（如「最近文件」列表）。 */
export const FILE_NAME_BUDGET_COMPACT = 24
/** 独占一行的文件卡片 / U 盘文件按钮。 */
export const FILE_NAME_BUDGET_CARD = 36

export interface TruncateFileNameOptions {
  /** 允许显示的最大码点数（含省略号）。 */
  maxLength?: number
  /** 尾部至少保留的码点数；实际尾部会自动放大到覆盖扩展名。 */
  minTailLength?: number
}

/**
 * 中段截断文件名。
 *
 * - 不超预算时原样返回（不做任何处理）。
 * - 超预算时返回 `头部 + … + 尾部`，尾部保证包含扩展名。
 *
 * @example
 * truncateFileNameMiddle('我的简历_张三_2026版_最终定稿_v3.pdf', { maxLength: 20 })
 * // → '我的简历_张三…稿_v3.pdf'
 */
export function truncateFileNameMiddle(
  fileName: string,
  { maxLength = FILE_NAME_BUDGET_CARD, minTailLength = 8 }: TruncateFileNameOptions = {},
): string {
  const name = typeof fileName === 'string' ? fileName : ''
  const chars = Array.from(name)
  if (maxLength < 6 || chars.length <= maxLength) return name

  // 扩展名 = 最后一个点及其之后（点不在首位才算）。
  const dotIndex = name.lastIndexOf('.')
  const rawExtensionLength = dotIndex > 0 ? Array.from(name.slice(dotIndex)).length : 0
  const extensionLength =
    rawExtensionLength > 0 && rawExtensionLength <= MAX_EXTENSION_LENGTH ? rawExtensionLength : 0

  const budget = maxLength - 1 // 省略号占 1 个码点
  // 尾部至少覆盖「扩展名 + 若干区分位」，同时给头部留至少 1 位。
  const tailLength = Math.min(
    Math.max(minTailLength, extensionLength + TAIL_DISTINGUISHING_CHARS),
    budget - 1,
  )
  const headLength = budget - tailLength

  return (
    chars.slice(0, headLength).join('') + ELLIPSIS + chars.slice(chars.length - tailLength).join('')
  )
}
