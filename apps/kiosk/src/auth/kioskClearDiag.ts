// 清场原因码。只进控制台，方便下次现场看是闲置、旧历史、隐私截止还是本人结束。
// 不写简历正文、令牌、文件名。整页重载后控制台要勾「保留日志」才看得到。
import type { KioskClearDiagReason, KioskClearReason } from './kioskEndUse'

export function kioskClearDiagCode(
  reason: KioskClearReason,
  diag?: KioskClearDiagReason,
): KioskClearDiagReason {
  if (diag) return diag
  if (reason === 'idle_timeout' || reason === 'print_done_timeout') return 'idle_timeout'
  if (reason === 'privacy_fallback') return 'history_fallback'
  return 'explicit_end'
}

/** 清场已经抢到执行权之后再记。抢不到（已经在清）不记，避免把没发生的清场写成发生了。 */
export function noteKioskClear(reason: KioskClearReason, diag?: KioskClearDiagReason): void {
  const code = kioskClearDiagCode(reason, diag)
  console.warn(`[kiosk-clear] reason=${code} at=${new Date().toISOString()}`)
}
