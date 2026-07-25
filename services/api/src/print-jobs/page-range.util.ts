/**
 * 页码范围 → 实际计费页数（P0-1 超收修复）。
 *
 * 背景：Windows Terminal Agent 只打印 `pageRange` 选中页
 * （`apps/terminal-agent/src/printer/print-with-pdf-to-printer.ts` 的 `opts.pages`），
 * 而 `PrintPageCountService.resolveBillablePages()` 只识别整份文件页数。两者不对齐时
 * 「打 50 页 PDF 的第 1-2 页」会按 50 页收费。计费必须与实际出纸页数一致。
 *
 * 约定：
 * - 页码 1-indexed；`undefined` / `'all'` / 空串 = 全部页面。
 * - 超出文档末页的部分按打印机行为截断（`1-100` 打 5 页文档 = 5 页）。
 * - 重叠区间按去重后的**实际出纸页数**计（`1-3,2-4` = 4 页，不是 7 页），宁可少收不可多收。
 * - 非法输入（页码 0、逆序区间、整段落在文档外）返回 null，由调用方 fail-closed 拒绝建单，
 *   **绝不回退成整份文件页数**——那正是本函数要消除的超收路径。
 */

/** 区间上限，与 CreatePrintJobDto 的 `@MaxLength(100)` 对应，防御性截断异常长输入。 */
const MAX_SEGMENTS = 64

/**
 * 计算 `pageRange` 在 `documentPages` 页文档内实际选中的去重页数。
 *
 * @returns 实际计费页数；输入非法或未选中任何有效页时返回 `null`。
 */
export function countPagesInRange(
  pageRange: string | null | undefined,
  documentPages: number,
): number | null {
  if (!Number.isInteger(documentPages) || documentPages <= 0) return null

  const raw = (pageRange ?? '').trim()
  if (raw === '' || raw.toLowerCase() === 'all') return documentPages

  const segments = raw.split(',')
  if (segments.length > MAX_SEGMENTS) return null

  const ranges: Array<[number, number]> = []
  for (const segment of segments) {
    const matched = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(segment)
    if (!matched) return null

    const start = Number(matched[1])
    const end = matched[2] === undefined ? start : Number(matched[2])
    // 页码从 1 起；逆序区间（5-3）视为非法输入而非空选择，避免静默按 0 页放行。
    if (!Number.isInteger(start) || !Number.isInteger(end)) return null
    if (start < 1 || end < start) return null

    // 整段落在文档之后（如 5 页文档写 50-60）：该段不产生出纸，跳过但不判非法，
    // 与打印机「忽略不存在的页」行为一致；若所有段都如此则下方总数为 0 → null。
    if (start > documentPages) continue
    ranges.push([start, Math.min(end, documentPages)])
  }

  if (ranges.length === 0) return null

  // 合并重叠 / 相接区间后求和，得到去重页数（不用 Set，避免超大文档的内存放大）。
  ranges.sort((a, b) => a[0] - b[0])
  let total = 0
  let [currentStart, currentEnd] = ranges[0]!
  for (let i = 1; i < ranges.length; i += 1) {
    const [start, end] = ranges[i]!
    if (start <= currentEnd + 1) {
      if (end > currentEnd) currentEnd = end
    } else {
      total += currentEnd - currentStart + 1
      currentStart = start
      currentEnd = end
    }
  }
  total += currentEnd - currentStart + 1

  return total > 0 ? total : null
}
