/**
 * 扫描文件删除审计上报（POST /terminals/:terminalId/scan-deletion-audits）认的原因码。
 *
 * 为什么单独放一个常量文件：DTO 的 @IsIn 与类型都从这里来，门禁按这张表逐个收、逐个拒，
 * 不再各写各的字面量。终端程序（apps/terminal-agent）本地删除账本里写的就是这几个码：
 *   UNCLAIMED_TTL_EXPIRED            面板扫描：watcher 目录里无人认领的文件过期被删（原有）
 *   SCAN_DEVICE_DELIVERED            屏上扫描：投递成功后删本机临时页
 *   SCAN_DEVICE_FAILED               屏上扫描：失败（卡纸、超时、页数超限等）后删临时页
 *   SCAN_DEVICE_ABORTED              屏上扫描：用户停止或终端程序中止后删临时页
 *   SCAN_DEVICE_SWITCHED_TO_PANEL    屏上扫描：用户改用面板扫描后删临时页
 *   SCAN_DEVICE_SESSION_CLEARED      屏上扫描：清场（隐私空闲、会话取消、180 秒清场）时删临时页
 *   SCAN_DEVICE_STARTUP_RESIDUE      屏上扫描：服务启动时清掉上次遗留的临时页
 *
 * 逐字与终端程序一侧的 ScanDeviceDeletionReason 一致（apps/terminal-agent/src/agent/scan-device/scan-temp-dir.ts）。
 * 终端程序的上报通道要等后端认这些码之后才能放开：现在 scan-deletion-audit-reporter.ts 的
 * buildPayload 仍写死 UNCLAIMED_TTL_EXPIRED，改用 event.reasonCode 放在屏上扫描接线那一批（A2）。
 *
 * 加码要同时：改这里、改终端程序的 ScanDeviceDeletionReason、改
 * verify-scan-deletion-audit-reporting 里的规格表。库里 reasonCode 是 String 列，不需要迁移。
 */
export const SCAN_DELETION_REASON_CODES = [
  'UNCLAIMED_TTL_EXPIRED',
  'SCAN_DEVICE_DELIVERED',
  'SCAN_DEVICE_FAILED',
  'SCAN_DEVICE_ABORTED',
  'SCAN_DEVICE_SWITCHED_TO_PANEL',
  'SCAN_DEVICE_SESSION_CLEARED',
  'SCAN_DEVICE_STARTUP_RESIDUE',
] as const

export type ScanDeletionReasonCode = (typeof SCAN_DELETION_REASON_CODES)[number]
