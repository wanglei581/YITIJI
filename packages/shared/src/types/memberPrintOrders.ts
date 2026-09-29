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

import type { ColorMode, DuplexMode, PrintTaskStatus } from './print'
import type { BillingPageSource, OrderPayStatus, PaymentSource } from './payment'

/** 我的打印订单：会员名下一条打印任务（仅安全元数据）。 */
export interface MemberPrintOrderItem {
  /** PrintTask id */
  id: string
  /**
   * 运营订单号（ORD-…）。列表接口还没带回时缺省。
   * 前端只显示 ORD- 号，不用任务 id 代替。
   */
  orderNo?: string | null
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
  /**
   * 单双面（来自 paramsJson）；缺省 / 非法为 null。
   *
   * 补于 2026-09-02：下单侧一直采集并按终端能力计价、落进
   * `Order.printParamsJson` / `PrintTask.paramsJson`，但对外契约漏了它，
   * 用户付了双面的钱却在「我的 → 打印订单」看不到，补打/申诉时无法复现参数。
   *
   * **必须容错 null**：paramsJson 是无 schema 的 JSON 字符串列，
   * 本字段补充之前建的历史任务不含 duplex 键。null = 来源未记录，
   * 前端只能显示「未记录」，**不得默认显示成「单面」**（CLAUDE.md §9 不伪造能力）。
   */
  duplex: DuplexMode | null
  /** 纸张幅面（来自 paramsJson，当前机型固定 A4）；缺省为 null */
  paperSize: string | null
  /**
   * 页范围（来自 paramsJson）。省略或空串为 null。
   * `'all'`、空值在一体机详单上显示「全部页」；写明了范围就原样显示。
   */
  pageRange: string | null
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
  // ── C5-4 只读退款/核销字段（会员只读展示；无任何操作入口）：无 Order 一律 null ──
  /** 已退金额累计（分）；未退款为 0，无 Order 为 null。 */
  refundedAmountCents?: number | null
  /** 券/权益核销抵扣额（分）；无抵扣为 0，无 Order 为 null。券=平台 credit，非资金。 */
  discountCents?: number | null
  /**
   * 已付款未出纸的待退款信号（API-20）。服务端由 `Order.refundReason` 派生，不新建列。
   * true = 本单已确认未出纸、退款由工作人员处理；false = 有 Order 但无该信号；无 Order 为 null。
   * 前端不得把内部原因码展示给顾客，也不得据此自行计算金额。
   */
  refundRequired?: boolean | null
  /** 这一行对应的订单号（手机单核销后派发的任务有；一体机现场单为 null）。2026-09-29 小程序对账契约。 */
  orderId?: string | null
  /** 出纸 / 领取的那台机器；取不到为 null。与时间线接口的 terminal 同形。 */
  terminal?: { id: string; displayName: string | null; locationLabel: string | null } | null
}

// ============================================================
// 跨端订单时间线：GET /api/v1/me/print-orders/timeline（2026-09-29）
//
// 一体机「我的打印订单」只读旧接口时，看不到手机下单还没到机的单和材料包；
// 这里把三路来源（一体机现场任务 / 手机单件未到机 / 材料包）按时间归并成一条时间线。
// 后端副本：services/api/src/member-print-orders/member-print-orders.types.ts（改一处必须同改两处）。
//
// 公共屏约束：**不含到机码明文**，只给 hasArrivalCode / arrivalCodeExpiresAt；
// 用户要看码请回手机。pickupCode 是付款后的取件凭证码，门控与旧列表一致。
// ============================================================

/** 来源：一体机现场打印任务 / 手机下单单件（未到机）/ 材料包。 */
export type MemberOrderTimelineKind = 'kiosk_task' | 'cloud_single' | 'package'

/**
 * 服务端统一派生的展示状态（前端不要自己拼）：
 * - awaiting_arrival：手机下了单，等本人到机器前领取
 * - awaiting_payment：已在机器前领取，等付款
 * - queued：已付款，排队等打印机
 * - printing：打印机正在处理
 * - completed / failed / cancelled / expired：已结束（退款中或已退款的未出纸单归 cancelled）
 */
export type MemberOrderTimelineDisplayStatus =
  | 'awaiting_arrival'
  | 'awaiting_payment'
  | 'queued'
  | 'printing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired'

/** status 查询参数：waiting = 待到机 + 待付款；printing = 排队 + 打印中；done = 四个结束态。 */
export type MemberOrderTimelineStatusFilter = 'all' | 'waiting' | 'printing' | 'done'
export type MemberOrderTimelineKindFilter = 'all' | MemberOrderTimelineKind

export interface MemberOrderTimelineTerminal {
  id: string
  displayName: string | null
  locationLabel: string | null
}

export interface MemberOrderTimelineItem {
  kind: MemberOrderTimelineKind
  /** kiosk_task 为 PrintTask id；cloud_single / package 为 Order id。 */
  id: string
  orderId: string | null
  orderNo: string | null
  printTaskId: string | null
  /** 单件取文件名；材料包为 null（前端拼「材料包 · N 个文件」）。 */
  title: string | null
  itemCount: number
  createdAt: string
  completedAt: string | null
  copies: number | null
  colorMode: ColorMode | null
  duplex: DuplexMode | null
  paperSize: string | null
  pageRange: string | null
  amountCents: number | null
  billablePages: number | null
  payStatus: OrderPayStatus | null
  paymentSource: PaymentSource | null
  refundedAmountCents: number | null
  discountCents: number | null
  refundRequired: boolean | null
  /** kiosk_task 为 PrintTask.status；其余为 Order.taskStatus。 */
  taskStatus: string
  /** Order.pickupStatus；无 Order 的历史任务为 null。 */
  pickupStatus: string | null
  displayStatus: MemberOrderTimelineDisplayStatus
  /** 到机码截止（只有手机下单的单才有）；明文不下发。 */
  arrivalCodeExpiresAt: string | null
  /** 本单当前有一枚可用的到机码（码本身只在本人手机上看）。 */
  hasArrivalCode: boolean
  /** 取件凭证码；仅 paid 且未退款、任务未进入完成/取消/失败终态时返回，否则 null。 */
  pickupCode: string | null
  terminal: MemberOrderTimelineTerminal | null
  /** 当前这台一体机（已验明身份）可以直接领取本单。 */
  claimableHere: boolean
}

export interface MemberOrderTimelinePage {
  items: MemberOrderTimelineItem[]
  /** 不透明游标，原样回传；null 表示没有下一页。 */
  nextCursor: string | null
  /** 与当前 status / kind 过滤一致的总数。 */
  total: number
}

/**
 * POST /api/v1/me/print-orders/:orderId/claim-here 的响应（与 POST /print/jobs/claim-pickup 同形，
 * 不包 ApiResponse 信封）。released=false 时去付款；released=true 时已派发打印。
 */
export type MemberOrderClaimHereResult =
  | {
      released: false
      orderId: string
      orderNo: string
      terminalId: string
      amountCents: number
      priceLines: unknown[]
      fileName: string | null
      paymentSessionToken: string
    }
  | {
      released: true
      taskId: string | null
      orderId: string
      orderNo: string
      terminalId: string | null
      taskStatus: string
      printTaskStatus: string
      fileName: string | null
      billablePages: number | null
      paymentSessionToken: string
    }
