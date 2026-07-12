// ── 打印扫描首期：能力开关与任务类型共享契约（计划 Task 2 Step 1-3 子集） ────
// 见 docs/superpowers/plans/2026-06-30-print-scan-first-release-full-scope.md。
// 能力状态是 fail-closed 语义：管理员配置过的能力，只有显式 'available' 才允许
// 普通用户创建正式任务（服务端 TerminalCapabilitiesService.assertUserTaskAllowed
// 在任务创建边界强制执行，Kiosk UI 只是体验层）；'testing' 仅测试/运维语境可见；
// 其余状态一律不可用。未配置行 = 管理员未接管，服务端放行既有已验证闭环。

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

/** 统一任务中心的任务类型判别值。photo/copy/material_pack/format_conversion/
 *  signature_stamp 当前没有数据模型（未上线），聚合端点对它们只能返回空集合，
 *  不得伪造行数据。document_process 是已存在的文档处理任务（材料检查等）。 */
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

/** 终端能力配置行（Admin 配置 / Kiosk 下发共用视图）。 */
export interface TerminalCapabilityView {
  capabilityKey: PrintScanCapabilityKey
  status: PrintScanCapabilityStatus
  note: string | null
  /** false = 该终端该能力从未被管理员配置过（Kiosk 端按各自的保守默认处理）。 */
  configured: boolean
  updatedAt: string | null
}
