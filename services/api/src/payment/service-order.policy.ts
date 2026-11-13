/**
 * 收费这一趟的判据只放这里。产品负责人改主意时只改本文件。
 *
 * ① 没做成才退。排版、导出失败不算没做成。
 * ② 付一次管这一趟。子调用不再收，收费机器上也不扣每人每日次数。
 * ③ 诊断免费。简历只在开始改写（出优化稿）之前收。
 * ④ 没做成可以免费再试一次（10 分钟、同一会话）。再失败、窗口过了、或人离开，才退。
 *
 * 生效价不在这里算，一律走 getEffectiveUserPrices。
 */

export const SERVICE_ORDER_KEYS = ['resume_optimize', 'mock_interview', 'scan'] as const

export type ServiceOrderKey = (typeof SERVICE_ORDER_KEYS)[number]

export const SERVICE_ORDER_NAMES: Record<ServiceOrderKey, string> = {
  resume_optimize: 'AI 简历优化',
  mock_interview: 'AI 模拟面试',
  scan: '扫描',
}

export const SERVICE_ORDER_STATUSES = ['pending', 'paid', 'consumed', 'refunding', 'refunded', 'closed'] as const

export type ServiceOrderStatus = (typeof SERVICE_ORDER_STATUSES)[number]

/** 未付款的二维码多久失效。 */
export const SERVICE_PAY_TTL_MS = 5 * 60 * 1000

/** 第一次没做成之后，同一会话可以免费再试的窗口。 */
export const SERVICE_RETRY_WINDOW_MS = 10 * 60 * 1000

/**
 * 自动退款失败后最多再试几次（含第一次失败）。
 * 到顶后停，后台仍可手动再试一次，所以手动上限是这个数再加一。
 */
export const SERVICE_REFUND_RETRY_CAP = 8

/** 两次自动退款尝试之间至少隔这么久，避免连打渠道。 */
export const SERVICE_REFUND_RETRY_INTERVAL_MS = 2 * 60 * 1000

/** 过期未付、再试窗口、退款重试、扫描有没有出文件，都在这一拍里看。 */
export const SERVICE_SWEEP_INTERVAL_MS = 30 * 1000

export type ServiceTripEvent =
  | 'optimize_completed'
  | 'optimize_failed'
  | 'interview_opened'
  | 'interview_not_opened'
  | 'interview_followup_failed'
  | 'scan_file_produced'
  | 'scan_no_file'
  | 'layout_failed'

/** made：做成了，不退。not_made：没做成，走再试或退款。layout_only：成品之后的排版失败，不退。 */
export type ServiceOutcome = 'made' | 'not_made' | 'layout_only'

export function isServiceOrderKey(value: string): value is ServiceOrderKey {
  return (SERVICE_ORDER_KEYS as readonly string[]).includes(value)
}

/**
 * 这一趟算不算做成。对不上的事件按没做成，避免把说不清的失败留成已消费不退。
 * 面试追问失败仍算做成：场已经开起来了。
 */
export function classifyServiceOutcome(serviceKey: ServiceOrderKey, event: ServiceTripEvent): ServiceOutcome {
  if (event === 'layout_failed') return 'layout_only'
  if (event === 'interview_followup_failed') return 'made'
  if (serviceKey === 'resume_optimize' && event === 'optimize_completed') return 'made'
  if (serviceKey === 'resume_optimize' && event === 'optimize_failed') return 'not_made'
  if (serviceKey === 'mock_interview' && event === 'interview_opened') return 'made'
  if (serviceKey === 'mock_interview' && event === 'interview_not_opened') return 'not_made'
  if (serviceKey === 'scan' && event === 'scan_file_produced') return 'made'
  if (serviceKey === 'scan' && event === 'scan_no_file') return 'not_made'
  return 'not_made'
}

export function failureReasonFor(event: ServiceTripEvent): string {
  if (event === 'optimize_failed') return '优化稿没做出来'
  if (event === 'interview_not_opened') return '面试没开起来'
  if (event === 'scan_no_file') return '扫描没出文件'
  return '这一次没做成'
}

export const SERVICE_REFUND_REASON_LEFT = '人已离开，这一次还没用'
export const SERVICE_REFUND_REASON_RETRY_EXPIRED = '免费再试已过期'
export const SERVICE_REFUND_REASON_USER_CANCELLED = '用户取消，这一次还没用'
export const SERVICE_REFUND_REASON_LATE_PAYMENT = '付款时这一单已经关闭'
