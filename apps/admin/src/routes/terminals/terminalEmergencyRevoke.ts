import type { TerminalLifecycleStatus } from '../../services/api/devices'

/** 身份处置里的「吊销」打开现有紧急吊销对话框，不另写一套提交。 */
export const REQUEST_EMERGENCY_REVOKE = 'admin-terminal-request-emergency-revoke'

export function requestEmergencyRevoke(terminalId: string): void {
  window.dispatchEvent(new CustomEvent(REQUEST_EMERGENCY_REVOKE, { detail: { terminalId } }))
}

/** 与 TerminalLifecycleActions 一致：待安装、已退役没有紧急吊销入口。 */
export function canRequestEmergencyRevoke(status: TerminalLifecycleStatus): boolean {
  return status !== 'planned' && status !== 'retired'
}
