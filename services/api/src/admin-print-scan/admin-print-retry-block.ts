/**
 * 管理员列表、详情和重试动作共用的独有拒绝原因。
 * 共享资格仍由 paidReprintBlockReason 计算，错误码是 PRINT_RETRY_*。
 * 这里只补管理员动作还会拒绝、而会员资格函数不管的两项：
 * 终端已退役或不在运行状态，以及有订单时 Order.taskStatus 不是 failed。
 * 人话必须与 admin-print-scan.service.ts 抛出的 message 逐字相同。
 * 管理员独有检查的错误码用 PRINT_SCAN_RETRY_*（终端退役 / 不在运行状态 / 文件链接解析失败）。
 */

export const ADMIN_RETRY_TERMINAL_RETIRED_MESSAGE = '终端已永久退役，不能重新排队'
export const ADMIN_RETRY_TERMINAL_NOT_ACTIVE_MESSAGE = '终端当前不在运行状态，不能重新排队'
export const ADMIN_RETRY_STATE_CHANGED_MESSAGE = '任务状态已变更，请刷新后重试'

export function adminRetryBlockedReason(input: {
  sharedReason: string | null
  terminalId: string | null
  terminal: { enabled: boolean; lifecycleStatus: string } | null
  hasOrder: boolean
  orderTaskStatus: string | null
}): string | null {
  if (input.sharedReason != null) return input.sharedReason
  if (input.terminalId) {
    if (input.terminal?.lifecycleStatus === 'retired') return ADMIN_RETRY_TERMINAL_RETIRED_MESSAGE
    if (!input.terminal || input.terminal.enabled !== true || input.terminal.lifecycleStatus !== 'active') {
      return ADMIN_RETRY_TERMINAL_NOT_ACTIVE_MESSAGE
    }
  }
  if (input.hasOrder && input.orderTaskStatus !== 'failed') return ADMIN_RETRY_STATE_CHANGED_MESSAGE
  return null
}
