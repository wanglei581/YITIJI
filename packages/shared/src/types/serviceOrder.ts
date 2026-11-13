/** 一体机按次付款的三项。打印仍走原来的打印订单，不进这张服务单。 */
export const SERVICE_ORDER_KEYS = ['resume_optimize', 'mock_interview', 'scan'] as const

export type ServiceOrderKey = (typeof SERVICE_ORDER_KEYS)[number]

export const SERVICE_ORDER_NAMES: Record<ServiceOrderKey, string> = {
  resume_optimize: 'AI 简历优化',
  mock_interview: 'AI 模拟面试',
  scan: '扫描',
}

export const SERVICE_ORDER_STATUSES = ['pending', 'paid', 'consumed', 'refunding', 'refunded', 'closed'] as const

export type ServiceOrderStatus = (typeof SERVICE_ORDER_STATUSES)[number]
