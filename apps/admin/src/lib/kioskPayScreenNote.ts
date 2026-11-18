/** 一体机还没有服务单付款屏。设了这三项价，用户会在一体机上被拦住。 */
export const KIOSK_PAY_SCREEN_NOTE =
  '一体机付款屏还没上线。这几项设了价，用户在一体机上会用不了，现在请保持 0。'

const PRINT_CHARGE_KEYS = ['print_bw_page', 'print_color_page'] as const
const KIOSK_GAP_KEYS = ['resume_optimize', 'mock_interview', 'scan'] as const

/** 打印价大于 0 归「打印在收费」（含同时设了 AI 或扫描）。只有后三项大于 0 才单独标出。 */
export function chargeListKind(prices: Partial<Record<string, number>>): 'print' | 'kiosk_gap' | 'none' {
  const print = PRINT_CHARGE_KEYS.some((key) => (prices[key] ?? 0) > 0)
  if (print) return 'print'
  const gap = KIOSK_GAP_KEYS.some((key) => (prices[key] ?? 0) > 0)
  return gap ? 'kiosk_gap' : 'none'
}
