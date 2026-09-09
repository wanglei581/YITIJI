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
