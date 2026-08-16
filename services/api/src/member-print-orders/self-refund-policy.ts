/**
 * 会员自助退款准入策略（A3-S3）—— **纯数据 + 纯查表**，无 DB、无副作用、无 if 堆。
 *
 * 本文件不退款。退款的唯一实现仍是 `payment/refund.service.ts` 的 `RefundService.refund()`
 * （refundNo 幂等键 / CAS / provider 三分法 / 收敛 / 同号重试）。本文件只回答一个问题：
 * **这一单允不允许由用户自己按下退款**。它是 RefundService 前面的一层门禁，绝不是平行实现。
 *
 * 三道相互独立的闸（顺序在 service 里固定，错误码互不覆盖）：
 *   1. 资金通道闸 `SELF_REFUND_ALLOWED_PAYMENT_SOURCES`
 *      —— 只放行「退款会自动原路回到付款人」的通道。线下现金 / 人工确认 / 免费 / 券
 *      走这条路会产生一条「已退款」记录但**没有任何钱回到用户手里**，那是伪造能力
 *      （CLAUDE.md §9），必须由服务台人工处理。
 *   2. 金额闸（在 service 里按 `amountCents - discountCents` 判）
 *      —— 实付为 0 的单没有可退金额，绝不建 0 元退款记录污染退款账本。
 *   3. 状态组合闸 `SELF_REFUND_STATE_MATRIX`
 *      —— `payStatus × taskStatus` 全枚举查表，未列出的取值一律 fail-closed。
 *
 * **契约源**：`packages/shared/src/types/payment.ts`（`SelfRefundReasonCode` /
 * `SELF_REFUND_REASON_CODES`）。为什么不直接 import @ai-job-print/shared：services/api 走
 * commonjs + node moduleResolution，见 `payment/payment.types.ts` 顶部说明。
 * 任何取值变更须同时改两处，`verify:refund-user-facing` 会断言两份清单逐字相等。
 */
import type { OrderPayStatus, PaymentSource } from '../payment/payment.types'

// ── 原因码白名单 ────────────────────────────────────────────────────────────

/**
 * 用户可选的退款原因码。**封闭词表**，全部从现有订单/任务状态机推出，不是新造语义：
 * - `print_failed`        `Order.taskStatus='failed'`（Agent 回传失败 / 任务过期被判失败）
 * - `print_not_started`   已 paid 但任务始终没进 claimed（排队中、终端离线、未释放出纸）
 * - `device_unrecovered`  现场按提示处理过卡纸/缺纸，仍然没出纸（原型 P41 s6「还是没好」）
 * - `pickup_expired`      到机码过期未取件（`taskStatus='expired'`）
 * - `duplicate_charge`    同一份文件重复下单/重复扣费，退掉多付的那一单
 * - `no_longer_needed`    未出纸前不再需要
 *
 * 硬约束：原因码**只做分类与审计**，不参与准入判定 —— 能不能退完全由通道/金额/状态三闸决定。
 * 用户填的自由文本同理：只进审计 payload，绝不影响判定（否则等于让请求方自证可退）。
 */
export const SELF_REFUND_REASON_CODES = [
  'print_failed',
  'print_not_started',
  'device_unrecovered',
  'pickup_expired',
  'duplicate_charge',
  'no_longer_needed',
] as const

export type SelfRefundReasonCode = (typeof SELF_REFUND_REASON_CODES)[number]

export function isSelfRefundReasonCode(value: unknown): value is SelfRefundReasonCode {
  return typeof value === 'string' && (SELF_REFUND_REASON_CODES as readonly string[]).includes(value)
}

/** 写进 `Refund.reason` / `Order.refundReason` 的机器可读串（Admin 一眼看出是自助退款 + 原因）。 */
export function selfRefundReasonText(code: SelfRefundReasonCode): string {
  return `member_self_refund:${code}`
}

// ── 闸 1：资金通道白名单 ────────────────────────────────────────────────────

/**
 * 只有这三个 `paymentSource` 允许用户自助退款 —— 判据是「退款是否会自动把钱送回付款人」：
 * - `wechat` / `alipay`：`RefundService` 调渠道原路退回，钱真的回到用户账户。
 * - `sandbox`：测试通道，非真实资金；生产环境由 `resolvePaymentProviders` 启动门禁禁用，
 *   放行它只是为了本地/CI 能端到端验证这条路径。
 *
 * 明确排除（→ `SELF_REFUND_CHANNEL_UNSUPPORTED`，走服务台）：
 * - `offline` / `manual_confirmed`：线下收的现金，系统标「已退款」不等于钱退给了用户。
 * - `free`：本就没收钱（实付 0，另有金额闸兜底）。
 * - `voucher`：券/权益全额核销单，退款**不恢复** BenefitGrant 额度
 *   （见 refund.service.ts 文件头），自助退等于券作废且没打印，只会更糟。
 */
export const SELF_REFUND_ALLOWED_PAYMENT_SOURCES: readonly PaymentSource[] = ['wechat', 'alipay', 'sandbox'] as const

export function isSelfRefundableChannel(paymentSource: string | null | undefined): boolean {
  return (SELF_REFUND_ALLOWED_PAYMENT_SOURCES as readonly string[]).includes(paymentSource ?? '')
}

// ── 闸 3：payStatus × taskStatus 组合表 ─────────────────────────────────────

/**
 * `Order.taskStatus` 已知全集（schema 注释 + 全仓写入点实测）：
 * `pending`（建单默认 / release 后待领取）、`pending_release`（M2 小程序云打印待到机）、
 * `awaiting_payment`（到机码已认领待付款）、`claimed` / `printing`（Agent 租约中）、
 * `completed` / `failed`、`expired`（到机码过期）、`cancelled`（用户取消 / Admin 处置）。
 */
export const SELF_REFUND_TASK_STATUSES = [
  'pending',
  'pending_release',
  'awaiting_payment',
  'claimed',
  'printing',
  'completed',
  'failed',
  'expired',
  'cancelled',
] as const
export type SelfRefundTaskStatus = (typeof SELF_REFUND_TASK_STATUSES)[number]

/** `Order.payStatus` 全集（与 `OrderPayStatus` 同源，此处只是可枚举副本供建表/穷举测试用）。 */
export const SELF_REFUND_PAY_STATUSES = [
  'unpaid',
  'paying',
  'paid',
  'refunding',
  'partial_refunded',
  'refunded',
  'failed',
  'closed',
] as const

export type SelfRefundDenyCode =
  /** 没有已支付的钱可退（unpaid / paying / failed / closed）。 */
  | 'SELF_REFUND_ORDER_NOT_PAID'
  /** 已有一笔退款在处理中（payStatus=refunding）。 */
  | 'SELF_REFUND_IN_PROGRESS'
  /** 已退过（refunded / partial_refunded）—— 绝不允许第二次出款。 */
  | 'SELF_REFUND_ALREADY_REFUNDED'
  /** Agent 已领取或正在出纸，纸可能已经出来了，不能自助退。 */
  | 'SELF_REFUND_TASK_IN_PROGRESS'
  /** 已打印完成，争议走服务台。 */
  | 'SELF_REFUND_TASK_COMPLETED'
  /** 订单已取消，不走退款流程。 */
  | 'SELF_REFUND_ORDER_CANCELLED'
  /** 出现了本表未覆盖的状态取值 —— fail-closed，绝不放行未知态。 */
  | 'SELF_REFUND_STATE_UNSUPPORTED'

export type SelfRefundStateDecision = { allowed: true } | { allowed: false; code: SelfRefundDenyCode }

const ALLOW: SelfRefundStateDecision = Object.freeze({ allowed: true as const })
const deny = (code: SelfRefundDenyCode): SelfRefundStateDecision => Object.freeze({ allowed: false as const, code })

/**
 * 非 paid 的 payStatus 一票否决（与 taskStatus 无关）。
 * `Record` 的键类型排除了 'paid'，少写一个取值 TypeScript 直接报错 —— 不会漏。
 */
const PAY_STATUS_DENIALS: Record<Exclude<OrderPayStatus, 'paid'>, SelfRefundDenyCode> = {
  unpaid: 'SELF_REFUND_ORDER_NOT_PAID',
  paying: 'SELF_REFUND_ORDER_NOT_PAID',
  failed: 'SELF_REFUND_ORDER_NOT_PAID',
  closed: 'SELF_REFUND_ORDER_NOT_PAID',
  refunding: 'SELF_REFUND_IN_PROGRESS',
  refunded: 'SELF_REFUND_ALREADY_REFUNDED',
  partial_refunded: 'SELF_REFUND_ALREADY_REFUNDED',
}

/**
 * payStatus='paid' 时按 taskStatus 逐值定音。**全枚举，无 default 分支。**
 *
 * 放行的四类都满足同一个客观条件：**这一单不可能已经出过纸**。
 * - `pending` / `pending_release` / `awaiting_payment`：Agent 尚未领取。退款把订单推进
 *   `refunding`，`terminals-agent.service.ts` 的 claim CAS 要求 `payStatus='paid'`
 *   （或 notIn refund 三态），因此退款一旦落库该单再也领不走；两侧 CAS 条件互斥，
 *   并发下只可能一方成功（另一方分别拿到 SELF_REFUND_TASK_IN_PROGRESS / claim 落空）。
 * - `expired`：到机码过期，`printTaskId` 为 null，钱收了纸没出。
 * - `failed`：出纸失败终态。
 *
 * 拒绝的四类：
 * - `claimed` / `printing`：Agent 租约中，纸可能正在出 —— `RefundService` 自身的 CAS
 *   也拒（ORDER_TASK_IN_PROGRESS），这里提前拒是为了给用户明确文案而不是撞内层。
 * - `completed`：已出纸，是否重打/补偿由服务台判断。
 * - `cancelled`：用户自己取消过的单不再进退款流程（付费单取消后 payStatus 已是 closed，
 *   能同时是 paid+cancelled 的只有免费单，本就无款可退）。
 */
const PAID_TASK_DECISIONS: Record<SelfRefundTaskStatus, SelfRefundStateDecision> = {
  pending: ALLOW,
  pending_release: ALLOW,
  awaiting_payment: ALLOW,
  expired: ALLOW,
  failed: ALLOW,
  claimed: deny('SELF_REFUND_TASK_IN_PROGRESS'),
  printing: deny('SELF_REFUND_TASK_IN_PROGRESS'),
  completed: deny('SELF_REFUND_TASK_COMPLETED'),
  cancelled: deny('SELF_REFUND_ORDER_CANCELLED'),
}

/**
 * 完整的 8×9 = 72 格组合表（由上面两张全枚举表机械展开，运行时冻结）。
 * 导出它是为了让门禁脚本能**穷举**每一格，也让文档/前端能直接读到唯一口径，
 * 而不是各自再写一遍 if。
 */
export const SELF_REFUND_STATE_MATRIX: Readonly<
  Record<string, Readonly<Record<string, SelfRefundStateDecision>>>
> = Object.freeze(
  Object.fromEntries(
    SELF_REFUND_PAY_STATUSES.map((pay) => [
      pay,
      Object.freeze(
        Object.fromEntries(
          SELF_REFUND_TASK_STATUSES.map((task) => [
            task,
            pay === 'paid' ? PAID_TASK_DECISIONS[task] : deny(PAY_STATUS_DENIALS[pay]),
          ]),
        ),
      ),
    ]),
  ),
)

/**
 * 状态组合判定 = 一次查表。表里没有的取值（脏数据、未来新增态）一律
 * `SELF_REFUND_STATE_UNSUPPORTED` —— fail-closed，绝不因为「没匹配到拒绝规则」就放行。
 */
export function decideSelfRefundState(payStatus: string, taskStatus: string): SelfRefundStateDecision {
  return SELF_REFUND_STATE_MATRIX[payStatus]?.[taskStatus] ?? deny('SELF_REFUND_STATE_UNSUPPORTED')
}

// ── 限流阈值 ────────────────────────────────────────────────────────────────

/**
 * 按会员计的落库限流（跨实例、跨重启一致）。**不新造幂等键**：同一订单的重复提交由
 * `RefundService` 既有的 `refundNo = RFD-<orderNo>`（一单一退）兜住，
 * 加上状态闸在第一次成功后立刻把该单打成 refunding/refunded，第二次必然被拒。
 * 这里挡的是「换着订单连续刷」的那一类。
 *
 * 阈值取值理由：一次真实的设备故障最多牵连用户手上的两三单；
 * 3 次 / 10 分钟容得下连着几单都没出纸的倒霉用户，20 次 / 24 小时给持续滥用一个硬顶。
 */
export const SELF_REFUND_RATE_LIMITS = [
  { windowMs: 10 * 60_000, max: 3 },
  { windowMs: 24 * 60 * 60_000, max: 20 },
] as const

/** `Refund.operatorId` 的自助退款前缀 —— 既是审计归属，也是按会员限流的计数依据。 */
export const SELF_REFUND_OPERATOR_PREFIX = 'member_self:'

export function selfRefundOperatorId(endUserId: string): string {
  return `${SELF_REFUND_OPERATOR_PREFIX}${endUserId}`
}
