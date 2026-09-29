export type StandbyPhase = 'loading' | 'playing' | 'empty'

export function deriveStandbyPhase(args: {
  fetchSettled: boolean
  fetchFailed: boolean
  enabled: boolean
  itemCount: number
  mediaReady: boolean
}): StandbyPhase {
  if (!args.fetchSettled && !args.fetchFailed) return 'loading'
  if (args.fetchFailed || !args.enabled || args.itemCount === 0) return 'empty'
  if (!args.mediaReady) return 'loading'
  return 'playing'
}

/**
 * 轮播的下一条：跳过已加载失败的素材。全部失败时停在原处（页面据此显示「暂无宣传内容」）。
 * 只有一条且可播时仍返回它自己，与原来的 (i + 1) % n 一致。
 */
export function nextPlayableIndex(items: ReadonlyArray<{ id: string }>, from: number, failed: ReadonlySet<string>): number {
  if (items.length === 0) return 0
  for (let step = 1; step <= items.length; step += 1) {
    const next = (from + step) % items.length
    const item = items[next]
    if (item && !failed.has(item.id)) return next
  }
  return from
}

export function standbyShouldExitHome(phase: StandbyPhase): boolean {
  return phase === 'empty'
}

export function formatStandbyClock(now: Date): { date: string; time: string } {
  const week = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  return {
    date: `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 · ${week[now.getDay()]}`,
    time: `${hh}:${mm}`,
  }
}
