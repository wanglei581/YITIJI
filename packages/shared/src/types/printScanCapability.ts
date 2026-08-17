// ── 打印扫描首期：能力开关与任务类型共享契约（计划 Task 2 Step 1-3 子集） ────
// 见 docs/superpowers/plans/2026-06-30-print-scan-first-release-full-scope.md。
// 能力状态是 fail-closed 语义：管理员配置过的能力，只有显式 'available' 才允许
// 普通用户创建正式任务（服务端 TerminalCapabilitiesService.assertUserTaskAllowed
// 在任务创建边界强制执行，Kiosk UI 只是体验层）；'testing' 仅测试/运维语境可见；
// 其余状态一律不可用。未配置行 = 管理员未接管，服务端放行既有已验证闭环。
//
// 例外见下方 DEFAULT_DENY_CAPABILITY_KEYS：color_print / duplex_print 未配置 = 拒绝。

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
  | 'color_print'
  | 'duplex_print'

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
  'color_print',
  'duplex_print',
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
 * cloud_upload 与 phone_upload 语义完全相同（云上传范围已收窄声明），cloud_upload 视为已弃用别名。
 * key = 已弃用旧键，value = 现役承接键。读取现役键状态时，若现役键本身未配置而旧键存在历史配置，
 * 按旧键状态兼容展示/生效，避免治理过程中无声丢弃历史管理员配置。
 * 仅只读兼容，不产生新写入；待确认生产无 cloud_upload 引用后由独立任务移除该键本身。
 */
export const DEPRECATED_CAPABILITY_ALIAS: Partial<Record<PrintScanCapabilityKey, PrintScanCapabilityKey>> = {
  cloud_upload: 'phone_upload',
}

/**
 * 默认拒绝（fail-closed）的能力键：对这些键，**未配置 ≠ 放行**。
 *
 * 为什么要和既有键相反：
 *   既有键的「未配置 = 放行」是**向后兼容**语义 —— 那些闭环在能力开关引入之前
 *   就已完成 Windows 真机验收，未配置只代表「管理员还没来接管」。
 *   彩色 / 自动双面**从未在任何一台真机上验证过驱动映射**（CLAUDE.md §3：硬件支持
 *   彩色不等于驱动控制已验证）。这里没有可兼容的既有闭环，所以「未配置」的真实
 *   含义是「这台机器没验过」，必须拒绝。
 *
 * 后果不对称，所以默认必须偏向拒绝：
 *   误拒 = 用户少一个选项；误放 = 用户按彩色付费却拿到黑白纸（资损 + 信任双输）。
 *
 * 该默认**不受 PRINT_SCAN_CAPABILITY_MODE 影响**：managed 模式放行的是既有闭环，
 * 不含这两个键。放行只有一条路径 —— 管理员在真机验过后显式配成 available。
 */
export const DEFAULT_DENY_CAPABILITY_KEYS: readonly PrintScanCapabilityKey[] = [
  'color_print',
  'duplex_print',
] as const

/**
 * 一次打印请求需要哪些 fail-closed 能力键。
 *
 * 只映射「会改变出纸物理结果、且未经真机验证」的两项。黑白 / 单面是基线组合，
 * 不需要任何额外能力键。调用方（DTO 之后的服务端门禁、Kiosk 控件禁用态）共用本函数，
 * 避免两边各写一套 if 而漂移。
 */
export function requiredPrintCapabilityKeys(params: {
  colorMode?: string | null
  duplex?: string | null
}): PrintScanCapabilityKey[] {
  const keys: PrintScanCapabilityKey[] = []
  if (params.colorMode === 'color') keys.push('color_print')
  if (params.duplex === 'duplex_long_edge' || params.duplex === 'duplex_short_edge') {
    keys.push('duplex_print')
  }
  return keys
}

/** 能力键 → 用户可读的拒绝理由。必须说清是「本机未验证」而不是「不支持」。 */
export const CAPABILITY_DENIAL_REASON: Partial<Record<PrintScanCapabilityKey, string>> = {
  color_print: '本机彩色打印尚未通过真机验证，暂不能按彩色下单',
  duplex_print: '本机自动双面尚未通过真机验证，暂不能按双面下单',
}

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
