// ============================================================
// 会员「我的打印订单」— 只读列表类型（Phase C-2C 后续小步）
//
// 合规约束（CLAUDE.md §10/§11/§12/§18）：
// - 只返回**归属于请求方本人**（endUserId）的打印任务；跨用户、匿名一律拒绝
//   （后端 EndUserAuthGuard）。匿名 Kiosk 打印（endUserId 为空）天然不会出现在任何会员名下。
// - 只返回**安全元数据**：绝不返回文件原文 / fileUrl(签名链接) / fileMd5(SHA-256) /
//   paramsJson 原文 / accessTokenHash / 内部错误堆栈等敏感字段。
// - 不含支付字段：当前 PrintTask 无 amount / paidStatus 等真实列，绝不伪造。
// - 不含页数 / 设备名：PrintTask 无 pages 列；会员 Kiosk 任务 terminalId 为空且
//   Terminal 无人类可读名称，故不返回 pages / deviceName，避免编造。
// - 空列表返回 []，不伪造订单数量。
// ============================================================

import type { ColorMode, PrintTaskStatus } from './print'
import type { BillingPageSource, OrderPayStatus, PaymentSource } from './payment'

/** 我的打印订单：会员名下一条打印任务（仅安全元数据）。 */
export interface MemberPrintOrderItem {
  /** PrintTask id */
  id: string
  /** 任务状态：pending / claimed / printing / completed / failed / cancelled */
  status: PrintTaskStatus
  /** 原始文件名（落在 paramsJson 内；未提供时为 null，不编造） */
  fileName: string | null
  createdAt: string
  /** 完成时间；未完成为 null */
  completedAt: string | null
  /** 打印份数（来自 paramsJson，1–99）；缺省 / 非法为 null */
  copies: number | null
  /** 黑白 / 彩色（来自 paramsJson）；缺省 / 非法为 null */
  colorMode: ColorMode | null
  /** 纸张幅面（来自 paramsJson，当前机型固定 A4）；缺省为 null */
  paperSize: string | null
  // ── 支付字段（P0a 支付域，无 live 网关；可选以保持向后兼容）：关联 Order 才有值；历史无 Order 一律 null ──
  /** 金额（分）；无 Order 为 null。 */
  amountCents?: number | null
  /** 支付状态；无 Order 为 null。 */
  payStatus?: OrderPayStatus | null
  /** 支付来源（offline/free/manual_confirmed）；未支付/无 Order 为 null。**绝不为微信/支付宝**（未接 live 网关）。 */
  paymentSource?: PaymentSource | null
  /** 后端识别的计费页数；无 Order 为 null。 */
  billablePages?: number | null
  /** 计费页数来源；无 Order 为 null。 */
  billingPageSource?: BillingPageSource | null
  /** 取件凭证码；仅 paid 且未退款、任务未进入完成/取消/失败终态时返回，否则 null。 */
  pickupCode?: string | null
}
