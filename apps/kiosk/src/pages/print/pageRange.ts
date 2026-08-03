/**
 * 页码范围 → 预估计费页数（与 services/api page-range.util 口径对齐）。
 * 仅用于参数页用量/估价展示；实付以确认页 POST /orders/quote 为准。
 */
const MAX_SEGMENTS = 64

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
    if (!Number.isInteger(start) || !Number.isInteger(end)) return null
    if (start < 1 || end < start) return null
    if (start > documentPages) continue
    ranges.push([start, Math.min(end, documentPages)])
  }

  if (ranges.length === 0) return null

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
