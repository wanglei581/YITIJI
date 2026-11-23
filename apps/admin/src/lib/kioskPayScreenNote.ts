/** AI 简历优化、AI 模拟面试、扫描在一体机上已接入独立服务单收银屏（已购小程序服务次数的用户可直接抵扣）。 */
export const KIOSK_PAY_SCREEN_NOTE =
  'AI 与扫描服务在一体机收银屏按次收费（已购小程序服务次数的用户可直接抵扣）。'

const PRINT_CHARGE_KEYS = ['print_bw_page', 'print_color_page'] as const
const SERVICE_CHARGE_KEYS = ['resume_optimize', 'mock_interview', 'scan'] as const

/** 打印价大于 0 归「打印在收费」（含同时设了 AI 或扫描）。只有 AI/扫描三项大于 0 时单独列在「AI / 扫描服务在收费」。 */
export function chargeListKind(prices: Partial<Record<string, number>>): 'print' | 'service_only' | 'none' {
  const print = PRINT_CHARGE_KEYS.some((key) => (prices[key] ?? 0) > 0)
  if (print) return 'print'
  const serviceOnly = SERVICE_CHARGE_KEYS.some((key) => (prices[key] ?? 0) > 0)
  return serviceOnly ? 'service_only' : 'none'
}
