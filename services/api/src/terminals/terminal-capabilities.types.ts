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

/**
 * 词汇债治理（2026-07-12 D4 拍板，见 docs/reviews/2026-07-12-cloud-print-decision.md §六）：
 * cloud_upload 与 phone_upload 语义完全相同，cloud_upload 视为已弃用别名。
 * key = 已弃用旧键，value = 现役承接键。读取现役键状态时，若现役键本身未配置而旧键存在历史配置，
 * 按旧键状态兼容展示/生效，避免治理过程中无声丢弃历史管理员配置。
 * 仅只读兼容，不产生新写入；待确认生产无 cloud_upload 引用后由独立任务移除该键本身。
 */
export const DEPRECATED_CAPABILITY_ALIAS: Partial<Record<PrintScanCapabilityKey, PrintScanCapabilityKey>> = {
  cloud_upload: 'phone_upload',
}

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

export const canAccessTestingPrintScanCapability = (
  status: PrintScanCapabilityStatus,
  context: 'ordinary_user' | 'tester' | 'admin' | 'maintenance',
): boolean => status === 'testing' && context !== 'ordinary_user'

export interface TerminalCapabilityView {
  capabilityKey: PrintScanCapabilityKey
  status: PrintScanCapabilityStatus
  note: string | null
  /** false = 该终端该能力从未被管理员配置过（Kiosk 端按各自的保守默认处理）。 */
  configured: boolean
  updatedAt: string | null
}
