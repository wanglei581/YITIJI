/** 云端白名单，与 packages/shared/src/types/scanDeletionAudit.ts 同步。
 * 面板与 SCAN_DEVICE_* 兼容既有终端；COPY_* 预留给后续终端实现，当前不要求终端发送。
 * DTO 与服务端校验共用本常量，verify-scan-deletion-audit-reporting 逐码验证上报。
 */
export const SCAN_DELETION_REASON_CODES = [
  'UNCLAIMED_TTL_EXPIRED',
  'SCAN_DEVICE_DELIVERED',
  'SCAN_DEVICE_FAILED',
  'SCAN_DEVICE_ABORTED',
  'SCAN_DEVICE_SWITCHED_TO_PANEL',
  'SCAN_DEVICE_SESSION_CLEARED',
  'SCAN_DEVICE_STARTUP_RESIDUE',
  'COPY_PRINT_TERMINAL',
  'COPY_RESCAN',
  'COPY_USER_CANCEL',
  'COPY_SESSION_CLEAR',
  'COPY_EXPIRED',
  'COPY_SCAN_FAILED',
  'COPY_STARTUP_RESIDUE',
] as const

export type ScanDeletionReasonCode = (typeof SCAN_DELETION_REASON_CODES)[number]
