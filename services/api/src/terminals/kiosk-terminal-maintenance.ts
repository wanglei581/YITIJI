/**
 * 一体机统一配置里的「本机不接新单」提示。
 *
 * 只看 enabled 与 lifecycleStatus。心跳超时不在这里：那是网络或 Agent 的问题。
 * 文案是固定的三句，不读取、不拼接管理员备注。
 * 未验明本机身份时固定返回 false / null，避免把别的终端状态说出去。
 */

export const KIOSK_TERMINAL_MAINTENANCE_MESSAGE =
  '这台机器正在维护，暂时不能打印和扫描，请稍后再来'
export const KIOSK_TERMINAL_PAUSED_MESSAGE = '这台机器暂停服务，请稍后再来'
export const KIOSK_TERMINAL_NOT_STARTED_MESSAGE = '这台机器还没有开始服务'

export interface KioskTerminalMaintenanceNotice {
  maintenance: boolean
  maintenanceMessage: string | null
}

export function kioskTerminalMaintenanceNotice(input: {
  identityVerified: boolean
  enabled: boolean
  lifecycleStatus: string
}): KioskTerminalMaintenanceNotice {
  if (!input.identityVerified) {
    return { maintenance: false, maintenanceMessage: null }
  }
  const status = input.lifecycleStatus
  if (status === 'maintenance') {
    return { maintenance: true, maintenanceMessage: KIOSK_TERMINAL_MAINTENANCE_MESSAGE }
  }
  if (status === 'suspended') {
    return { maintenance: true, maintenanceMessage: KIOSK_TERMINAL_PAUSED_MESSAGE }
  }
  if (status === 'planned' || status === 'commissioning' || status === 'retired') {
    return { maintenance: true, maintenanceMessage: KIOSK_TERMINAL_NOT_STARTED_MESSAGE }
  }
  if (!input.enabled) {
    return { maintenance: true, maintenanceMessage: KIOSK_TERMINAL_PAUSED_MESSAGE }
  }
  return { maintenance: false, maintenanceMessage: null }
}
