// 图片按 A4 打印时的有效分辨率估算（体检「清晰度」判定的唯一依据）。
//
// 口径：打印参数里「缩放方式」默认是**适合页面**（PrintPreviewPage 的 scale='fit'），
// 即**等比缩放**填满 A4 的一个方向，另一方向留白；页面方向为**自动**，取能把图印得更大的
// 那个方向。等比缩放下横竖两轴 DPI 相同，由「先顶到边」的那一轴决定：
//
//   printedWidthIn = min(pageWIn, pageHIn × w/h)
//   dpi            = w / printedWidthIn = max(w / pageWIn, h / pageHIn)
//
// 所以每个方向内取 **max**（谁先顶到边谁决定 DPI），两个方向之间取 **min**
// （自动方向会选印得更大的那个，印得越大 DPI 越低，取低者才是用户真正拿到的清晰度）。
//
// —— 2026-08-17 真实文件走查修正 ——
// 原实现是 `max(min(w/8.27, h/11.69), min(w/11.69, h/8.27))`，两层取反了：
// 每轴用 min 等于假设图片被**拉伸铺满**整页（两轴分别映射到整页宽高），而产品里根本没有
// 「拉伸铺满」这个选项。只有当图片比例恰好等于 A4 时两种算法才巧合一致，其余一律偏低：
//   3000×200 极宽图  报 24 DPI（实际 257）→ 误报「清晰度可能不足」
//   200×3000 极高图  报 24 DPI（实际 257）→ 误报
//   1920×1080 普通照 报 131 DPI（实际 164）→ 跨过 150 阈值，误报
//   800×800  正方形  报 68 DPI（实际 97）
// 即：越偏离 A4 比例的图，低估越严重，误报越离谱。

/** A4 可打印区按整页计（英寸）：210mm × 297mm。 */
const A4_WIDTH_IN = 8.27
const A4_HEIGHT_IN = 11.69

/** 低于此 DPI 提示清晰度可能不足。 */
export const MIN_RECOMMENDED_DPI = 150

/**
 * 等比「适合页面」+ 自动方向下，图片按 A4 打印的有效 DPI。
 *
 * @param widthPx  图片像素宽
 * @param heightPx 图片像素高
 * @returns 取整后的 DPI（最小 1）；入参非正数时返回 1。
 */
export function estimateA4Dpi(widthPx: number, heightPx: number): number {
  if (!(widthPx > 0) || !(heightPx > 0)) return 1
  // 纵向纸：谁先顶到边谁决定 DPI
  const portraitDpi = Math.max(widthPx / A4_WIDTH_IN, heightPx / A4_HEIGHT_IN)
  // 横向纸：同理
  const landscapeDpi = Math.max(widthPx / A4_HEIGHT_IN, heightPx / A4_WIDTH_IN)
  // 自动方向取印得更大的那张 → DPI 更低的那个
  return Math.max(1, Math.round(Math.min(portraitDpi, landscapeDpi)))
}

/** DPI 是否达到 A4 打印推荐清晰度。 */
export function isA4PrintResolutionOk(dpi: number): boolean {
  return dpi >= MIN_RECOMMENDED_DPI
}

/** 页码列表折叠成连续区间前，最多逐个列出多少页；超过则改用区间表述。 */
const MAX_LISTED_BLANK_PAGES = 6

/**
 * 疑似空白页提示文案。
 *
 * 两个约束（2026-08-17 走查）：
 *   1. 页码多时不能逐个罗列 —— 实测 30 页 PDF 报出「第 1、2、3、…、20 页可能为空白页」，
 *      一屏文字用户根本读不完。折叠成连续区间。
 *   2. 空白页检查只扫前 N 页，文案必须交代扫描范围，否则用户会以为整份都查过了。
 *
 * @param blankPages 1-based 页码升序列表（非空）
 * @param totalPages 已识别的总页数；null 表示页数未识别
 * @param scannedPages 实际扫描到第几页
 */
export function describeBlankPages(
  blankPages: number[],
  totalPages: number | null,
  scannedPages: number = blankPages[blankPages.length - 1] ?? 0,
): string {
  const scope =
    totalPages !== null && totalPages > scannedPages
      ? `（本次仅检查前 ${scannedPages} 页，共 ${totalPages} 页）`
      : ''
  return `第 ${formatPageRanges(blankPages)} 页可能为空白页，如非有意留白请检查原文件${scope}`
}

/** [1,2,3,5,7,8] → "1-3、5、7-8"；短列表保持逐个列出。 */
export function formatPageRanges(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b)
  if (sorted.length <= MAX_LISTED_BLANK_PAGES) return sorted.join('、')
  const parts: string[] = []
  let start = sorted[0]!
  let prev = start
  for (const page of sorted.slice(1)) {
    if (page === prev + 1) {
      prev = page
      continue
    }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`)
    start = page
    prev = page
  }
  parts.push(start === prev ? `${start}` : `${start}-${prev}`)
  return parts.join('、')
}
