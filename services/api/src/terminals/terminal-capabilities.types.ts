/**
 * 打印扫描能力开关契约本地副本。
 *
 * **契约源**:packages/shared/src/types/printScanCapability.ts
 *
 * 为什么不直接 import @ai-job-print/shared:services/api 走 commonjs + node
 * moduleResolution,packages/shared 的 exports 直指 .ts,互操作复杂 —— 见
 * files/file.types.ts 的同款决定。
 *
 * 任何字段变更必须同时改两处:
 *   1. packages/shared/src/types/printScanCapability.ts(前端 SSOT)
 *   2. 本文件(后端副本)
 * 改完搜 git diff 确认两边一致。
 */

export type PrintScanCapabilityKey =
  | 'document_print'
  | 'phone_upload'
  | 'cloud_upload'
  | 'usb_import'
  | 'material_pack'
  | 'scan'
  | 'copy'
  | 'id_photo'
  | 'format_convert'
  | 'signature_stamp'

export type PrintScanCapabilityStatus =
  | 'available'
  | 'testing'
  | 'maintenance'
  | 'unsupported'
  | 'not_verified'

export const PRINT_SCAN_CAPABILITY_KEYS: readonly PrintScanCapabilityKey[] = [
  'document_print',
  'phone_upload',
  'cloud_upload',
  'usb_import',
  'material_pack',
  'scan',
  'copy',
  'id_photo',
  'format_convert',
  'signature_stamp',
] as const

export const PRINT_SCAN_CAPABILITY_STATUSES: readonly PrintScanCapabilityStatus[] = [
  'available',
  'testing',
  'maintenance',
  'unsupported',
  'not_verified',
] as const

export type PrintScanTaskType =
  | 'print'
  | 'scan'
  | 'copy'
  | 'photo'
  | 'material_pack'
  | 'format_conversion'
  | 'signature_stamp'
  | 'document_process'

/** 已有真实数据模型、聚合端点会返回真实行的任务类型。 */
export const IMPLEMENTED_PRINT_SCAN_TASK_TYPES: readonly PrintScanTaskType[] = [
  'print',
  'scan',
  'document_process',
] as const

export const canCreateFormalPrintScanTask = (status: PrintScanCapabilityStatus): boolean => status === 'available'

export interface TerminalCapabilityView {
  capabilityKey: PrintScanCapabilityKey
  status: PrintScanCapabilityStatus
  note: string | null
  /** false = 该终端该能力从未被管理员配置过（Kiosk 端按各自的保守默认处理）。 */
  configured: boolean
  updatedAt: string | null
}
