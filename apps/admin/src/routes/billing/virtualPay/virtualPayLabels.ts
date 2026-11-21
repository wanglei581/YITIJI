import type { VirtualPayServiceKind } from '../../../services/api/adminVirtualPay'

export const VPAY_SERVICE_KINDS: readonly VirtualPayServiceKind[] = ['resume_optimize', 'mock_interview']

export const VPAY_SERVICE_LABELS: Record<string, string> = {
  resume_optimize: 'AI 简历优化',
  mock_interview: 'AI 模拟面试',
}

export function vpayServiceLabel(kind: string): string {
  return VPAY_SERVICE_LABELS[kind] ?? '其他服务'
}

export const VPAY_ORDER_STATUS_OPTIONS = [
  ['', '全部订单状态'],
  ['pending', '待支付'],
  ['paid', '已支付'],
  ['refunding', '退款中'],
  ['refunded', '已退款'],
  ['refund_failed', '退款失败'],
  ['closed', '已关闭'],
  ['manual_review', '需人工核查'],
] as const

export const VPAY_ORDER_STATUS_META: Record<
  string,
  { label: string; tone: 'default' | 'success' | 'warning' | 'error' | 'info' }
> = {
  pending: { label: '待支付', tone: 'info' },
  paid: { label: '已支付', tone: 'success' },
  refunding: { label: '退款中', tone: 'warning' },
  refunded: { label: '已退款', tone: 'default' },
  refund_failed: { label: '退款失败', tone: 'error' },
  closed: { label: '已关闭', tone: 'default' },
  manual_review: { label: '需人工核查', tone: 'error' },
}

export function vpayOrderStatusMeta(status: string) {
  return VPAY_ORDER_STATUS_META[status] ?? { label: '状态待核查', tone: 'default' as const }
}

export const VPAY_CREDIT_STATUS_META: Record<
  string,
  { label: string; tone: 'default' | 'success' | 'warning' | 'error' | 'info' }
> = {
  available: { label: '可用', tone: 'success' },
  consumed: { label: '已核销', tone: 'info' },
  refunding: { label: '退款中', tone: 'warning' },
  refunded: { label: '已退回', tone: 'default' },
}

export function vpayCreditStatusMeta(status: string | null | undefined) {
  if (!status) return { label: '未生成权益', tone: 'default' as const }
  return VPAY_CREDIT_STATUS_META[status] ?? { label: '权益待核查', tone: 'default' as const }
}

export function vpayEnvLabel(env: number | null | undefined): string {
  if (env === 0) return '现网环境'
  if (env === 1) return '沙箱环境'
  return '未配置'
}

export function vpayRuntimeLabel(runtime?: {
  ready: boolean
  block: 'env_missing' | 'env_invalid' | 'sandbox_in_production' | null
  env: 0 | 1 | null
}): { ready: boolean; text: string } {
  if (!runtime) return { ready: false, text: '尚未读取到服务端环境状态' }
  if (runtime.ready) {
    return { ready: true, text: `服务端参数已就绪（${vpayEnvLabel(runtime.env)}）` }
  }
  if (runtime.block === 'sandbox_in_production') {
    return { ready: false, text: '生产环境禁止使用沙箱参数，当前无法下单' }
  }
  if (runtime.block === 'env_invalid') {
    return { ready: false, text: '服务端环境参数填写有误，当前无法下单' }
  }
  return { ready: false, text: '服务端环境变量尚未配齐，当前默认不可下单，不影响其他功能' }
}

const DIAGNOSTIC_LABELS: Record<string, string> = {
  refund_in_progress_268490014: '微信侧退款处理中，请稍后同步查单确认',
  refund_consumed_forbidden_268490013: '微信侧回报该单已核销，无法发起原路退款',
  refund_request_failed: '向微信提交退款请求失败，请先同步查单核实真实状态',
  refund_openid_missing: '对应会员已注销或缺少微信标识，无法向微信查单或退款',
  refund_query_failed: '向微信查询退款结果失败，请稍后重试',
  query_manual_review: '连续查单失败或超时未收敛，请人工核查',
  non_grantable_order_status: '微信侧订单处于不可发货状态，请人工核查',
  notify_provide_goods_failed: '权益已记账，但回通知微信已发货失败',
  order_closed: '微信侧订单已关闭',
  refunded_before_grant: '发放权益前已在微信侧退款',
  app_key_missing: '缺少对应环境的微信虚拟支付密钥配置',
  env_mismatch: '微信订单环境与本地记录不一致',
  amount_mismatch: '微信订单金额与本地记录不一致',
}

export function vpayDiagnosticLabel(reason: string | null | undefined): string {
  if (!reason) return '—'
  if (DIAGNOSTIC_LABELS[reason]) return DIAGNOSTIC_LABELS[reason]
  if (reason.startsWith('refund_notify_failed_')) return '微信退款结果通知回报失败，请同步查单核实'
  if (reason.startsWith('refund_query_failed_status_')) return '微信查单回报退款失败，请核对后决定是否重发'
  if (reason.startsWith('refund_wechat_err_')) return '微信退款接口返回拒绝，请先同步查单核实'
  return '存在异常诊断记录，请查看详情或同步查单'
}

const REFUND_BLOCK_LABELS: Record<string, string> = {
  credit_consumed: '权益已核销，不可退款',
  refunding: '退款处理中',
  already_refunded: '已退款',
  open_id_missing: '会员已注销，无微信标识',
  window_expired: '已超 365 天退款期限',
  status_not_paid: '当前订单状态不可退',
  credit_missing: '未生成权益',
  credit_not_available: '权益当前不可退',
}

export function vpayRefundBlockLabel(reason: string | null | undefined): string {
  if (!reason) return '不可退款'
  return REFUND_BLOCK_LABELS[reason] ?? '当前不可退款'
}

export const VPAY_IOS_REFUND_NOTICE =
  'iOS 订单苹果不支持开发者主动退款，需由用户向 App Store 申请。仅可对非 iOS 且权益未核销的订单发起微信原路退款。'
