// 远程命令的显示口径（纯函数，单测直接执行）。状态与结果码来自服务端 terminal-commands.service.ts。

export type CommandBadge = 'success' | 'warning' | 'error' | 'default' | 'info'

export interface CommandLike {
  type: string
  status: string
  completedVerified: boolean | null
  resultCode: string | null
  remainingJobs: number | null
}

const TYPE_LABELS: Readonly<Record<string, string>> = {
  restart_agent: '重启终端程序',
  clear_print_queue: '清空打印队列',
}

/** 重启后终端在时限内没有带新启动时间的心跳回来。 */
export const NO_HEARTBEAT_AFTER_RESTART = 'no_heartbeat_after_restart'

export function commandTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? '其他远程命令'
}

export function isOpenCommand(command: Pick<CommandLike, 'status'>): boolean {
  return command.status === 'pending' || command.status === 'accepted'
}

export function commandStatusView(command: CommandLike): { label: string; badge: CommandBadge } {
  switch (command.status) {
    case 'pending':
      return { label: '待执行', badge: 'info' }
    case 'accepted':
      return { label: '已接受', badge: 'info' }
    case 'completed':
      return command.completedVerified === false
        ? { label: '已完成（未核实是否重启）', badge: 'warning' }
        : { label: '已完成', badge: 'success' }
    case 'done':
      return { label: '已清空', badge: 'success' }
    case 'failed':
      if (command.resultCode === NO_HEARTBEAT_AFTER_RESTART) return { label: '失败，重启后终端没有回来', badge: 'error' }
      if (command.type === 'clear_print_queue' && typeof command.remainingJobs === 'number') {
        return { label: `失败，还剩 ${command.remainingJobs} 个作业`, badge: 'error' }
      }
      return { label: '失败', badge: 'error' }
    case 'rejected_busy':
      return { label: '终端忙，稍后再试', badge: 'warning' }
    case 'expired':
      return { label: '已过期', badge: 'default' }
    default:
      return { label: '状态未知', badge: 'default' }
  }
}

/** 下发按钮是否可用；不可用时给出原因。判据对齐服务端：启用且生命周期为运行中，且没有未结束的命令。 */
export function remoteCommandBlockReason(
  terminal: { enabled: boolean; lifecycleStatus: string },
  commands: ReadonlyArray<Pick<CommandLike, 'status'>>,
): string | null {
  if (!terminal.enabled || terminal.lifecycleStatus !== 'active') return '终端不在运营中，不能下发'
  if (commands.some(isOpenCommand)) return '上一条命令还没结束'
  return null
}

/** 审计详情里命令相关字段的取值中文。只认这些值，别的原样交给通用规则。 */
export const COMMAND_AUDIT_VALUE_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  type: TYPE_LABELS,
  result: { accepted: '已接受', done: '已清空', rejected_busy: '终端忙', completed: '已完成' },
  resultCode: { [NO_HEARTBEAT_AFTER_RESTART]: '重启后终端没有回来', expired: '已过期' },
}
