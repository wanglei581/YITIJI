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

export const SERVICE_ORDER_STATUSES = ['pending', 'paid', 'consumed', 'refunding', 'refunded', 'refund_failed', 'closed'] as const

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

/** 受理中再查时的退避：2、5、15、30 分钟。超过最后一档仍受理中就告警，并保持最后一档。 */
export const SERVICE_REFUND_BACKOFF_MS = [2, 5, 15, 30].map((minutes) => minutes * 60 * 1000)

/** 向渠道发退款前先占 60 秒。占不到就不再发，避免自动和手动各退一笔。 */
export const SERVICE_REFUND_LEASE_MS = 60 * 1000

/**
 * 清扫每批多少张。低于列表截断门禁的 50。
 * 扫描每一拍只取占用最早的这一批；做成的写下结案时间后离开，下一拍继续。
 */
export const SERVICE_SWEEP_BATCH = 30

/** 扫描占单后至少等这么久再判有没有出文件，给文件落地留时间。 */
export const SERVICE_SCAN_JUDGE_AFTER_MS = 15 * 1000

/** 一直挂着 pending、或任务找不到，超过这个时间按没出文件。 */
export const SERVICE_SCAN_PENDING_LIMIT_MS = 2 * 60 * 1000

/**
 * 简历、面试占单后，锁是 120 秒。再留 5 分钟才复核。
 * 有结果算做成；没有就按没做成。避免请求中断后单永远停在 consumed。
 */
export const SERVICE_CONSUMED_REVIEW_AFTER_MS = 120_000 + 5 * 60 * 1000

/** 过期未付、再试窗口、退款重试、扫描有没有出文件，都在这一拍里看。 */
export const SERVICE_SWEEP_INTERVAL_MS = 30 * 1000

export type ServiceTripEvent =
  | 'optimize_completed'
  | 'optimize_failed'
  | 'interview_opened'
  | 'interview_not_opened'
  | 'interview_followup_failed'
  | 'interview_report_completed'
  | 'interview_report_failed'
  | 'scan_file_produced'
  | 'scan_no_file'
  | 'layout_failed'

/** 模拟面试已开场后，报告阶段的附加状态：retry 可免费再试出报告；done 报告已做成，不再退。 */
export const SERVICE_REPORT_STATES = ['retry', 'done'] as const
export type ServiceReportState = (typeof SERVICE_REPORT_STATES)[number]

/** made：做成了，不退。not_made：没做成，走再试或退款。layout_only：成品之后的排版失败，不退。 */
export type ServiceOutcome = 'made' | 'not_made' | 'layout_only'

export function isServiceOrderKey(value: string): value is ServiceOrderKey {
  return (SERVICE_ORDER_KEYS as readonly string[]).includes(value)
}

/**
 * 这一趟算不算做成。对不上的事件按没做成，避免把说不清的失败留成已消费不退。
 * 面试追问失败仍算做成：场已经开起来了；请求出报告因系统原因没生成则算没做成（先免费再试一次，再不成或离开或过期自动退）。
 */
export function classifyServiceOutcome(serviceKey: ServiceOrderKey, event: ServiceTripEvent): ServiceOutcome {
  if (event === 'layout_failed') return 'layout_only'
  if (event === 'interview_followup_failed') return 'made'
  if (serviceKey === 'resume_optimize' && event === 'optimize_completed') return 'made'
  if (serviceKey === 'resume_optimize' && event === 'optimize_failed') return 'not_made'
  if (serviceKey === 'mock_interview' && event === 'interview_opened') return 'made'
  if (serviceKey === 'mock_interview' && event === 'interview_not_opened') return 'not_made'
  if (serviceKey === 'mock_interview' && event === 'interview_report_completed') return 'made'
  if (serviceKey === 'mock_interview' && event === 'interview_report_failed') return 'not_made'
  if (serviceKey === 'scan' && event === 'scan_file_produced') return 'made'
  if (serviceKey === 'scan' && event === 'scan_no_file') return 'not_made'
  return 'not_made'
}

export function failureReasonFor(event: ServiceTripEvent): string {
  if (event === 'optimize_failed') return '优化稿没做出来'
  if (event === 'interview_not_opened') return '面试没开起来'
  if (event === 'interview_report_failed') return '报告没生成'
  if (event === 'scan_no_file') return '扫描没出文件'
  return '这一次没做成'
}

export type InterviewReportFailureAction = 'enter_retry' | 'refund_failed' | 'refund_left' | 'ignore'

/**
 * 已开场的模拟面试，出报告因系统原因失败时的下一步决定。
 * 首次且会话未结束 → 进 10 分钟免费再试（单留在 consumed，不可被新面试认领）；
 * 首次但会话已结束 → 按离开退；已在再试中再次失败 → 按报告没生成退；已做成或非 consumed → 忽略。
 */
export function decideInterviewReportFailure(input: {
  serviceKey: string
  status: string
  settledAt: Date | null
  reportState: string | null
  sessionEnded: boolean
}): InterviewReportFailureAction {
  if (input.serviceKey !== 'mock_interview' || input.status !== 'consumed' || !input.settledAt) return 'ignore'
  if (classifyServiceOutcome('mock_interview', 'interview_report_failed') !== 'not_made') return 'ignore'
  if (input.reportState === 'done') return 'ignore'
  if (input.reportState === 'retry') return 'refund_failed'
  if (input.sessionEnded) return 'refund_left'
  return 'enter_retry'
}

export type InterviewReportAdmission = 'allow' | 'retry_expired' | 'refunded'

/**
 * 收费面试场次调模型出报告前的准入判定：
 * - 服务单已进退款中/已退款/退款失败 → 拒绝，不再调模型或落报告；
 * - 服务单在免费再试中但窗口已过期（清扫尚未跑）→ 按过期走退款收口并拒绝，绝不翻回做成；
 * - 其余（首次出报告、窗口内再试、已做成幂等重读）→ 放行。
 */
export function decideInterviewReportAdmission(input: {
  serviceKey: string
  status: string
  reportState: string | null
  retryUntil: Date | null
  now: Date
}): InterviewReportAdmission {
  if (input.serviceKey !== 'mock_interview') return 'allow'
  if (input.status === 'refunding' || input.status === 'refunded' || input.status === 'refund_failed') {
    return 'refunded'
  }
  if (input.status === 'consumed' && input.reportState === 'retry') {
    if (!input.retryUntil || input.retryUntil.getTime() <= input.now.getTime()) {
      return 'retry_expired'
    }
  }
  return 'allow'
}

export const SERVICE_ERROR_RETRY_EXPIRED_MESSAGE = '免费再试时间已过，这一次的费用会自动退回原付款账户'
export const SERVICE_ERROR_ORDER_REFUNDED_MESSAGE = '这一次已进入退款流程，不再继续生成练习报告'

export const SERVICE_REFUND_REASON_LEFT = '人已离开，这一次还没用'
export const SERVICE_REFUND_REASON_RETRY_EXPIRED = '免费再试已过期'
export const SERVICE_REFUND_REASON_REPORT_FAILED = '报告没生成'
export const SERVICE_REFUND_REASON_REPORT_LEFT = '人已离开，报告没生成'
export const SERVICE_REFUND_REASON_USER_CANCELLED = '用户取消，这一次还没用'
export const SERVICE_REFUND_REASON_LATE_PAYMENT = '付款时这一单已经关闭'
export const SERVICE_REFUND_REASON_NOW_FREE = '这台机器已改为免费'
export const SERVICE_REFUND_REASON_PRICE_CHANGED = '这一项的价格已经变了'
export const SERVICE_REFUND_REASON_DISPLACED = '这一趟已经算在另一张单上'
export const SERVICE_REFUND_REASON_ADMIN = '管理员原路退款'
