export type ConsolePageItem = number | 'ellipsis'

/**
 * 页码从 1 起。不超过 7 页全部列出。
 * 当前页靠近开头或结尾时连续给出 5 个页码，中间则是「1 … c-1 c c+1 … N」。
 */
export function buildPageList(current: number, total: number): ConsolePageItem[] {
  if (total <= 7) {
    return Array.from({ length: Math.max(total, 0) }, (_, index) => index + 1)
  }
  if (current <= 4) return [1, 2, 3, 4, 5, 'ellipsis', total]
  if (current >= total - 3) return [1, 'ellipsis', total - 4, total - 3, total - 2, total - 1, total]
  return [1, 'ellipsis', current - 1, current, current + 1, 'ellipsis', total]
}
