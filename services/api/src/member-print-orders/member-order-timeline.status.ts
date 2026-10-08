/**
 * 跨端订单时间线的状态口径：展示状态派生（纯函数）+ 同一口径的查询条件 + 本机可领取判定。
 *
 * 为什么单独成文件：派生规则与 status 过滤的 Prisma where 必须一一对应，否则
 * 「按 waiting 筛出来的单，展示出来却是已完成」、total 与列表对不上。两者放在一起，
 * 由 verify:member-order-timeline 用真实数据核对「过滤桶 = 派生桶」，并对每个分支单测。
 * 放进 member-order-timeline.service.ts 会把查询编排和状态规则搅在一起，门禁也没法只测规则。
 *
 * 派生只看已落库的状态（列表查询前会先按既有逻辑把本人到期未取的单落成 expired），
 * 不在这里再按时间猜；「本机可领取」才按当前时间判断（与核销共用 isPickupClaimWindowClosed）。
 */
import { isPickupClaimWindowClosed } from '../print-jobs/pickup-order.service'
import type {
  MemberOrderTimelineDisplayStatus,
  MemberOrderTimelineStatusFilter,
} from './member-print-orders.types'

/** 付款仍在进行或已付（能继续履约）的支付态。其余（退款中/已退/关单/失败）都不会再出纸。 */
export const LIVE_PAY_STATUSES = ['unpaid', 'paying', 'paid'] as const
const REFUND_PAY_STATUSES = new Set(['refunding', 'partial_refunded', 'refunded'])
/** 打印任务已结束的状态。 */
const TASK_TERMINAL_STATUSES = ['completed', 'failed', 'cancelled', 'expired'] as const
/** 打印机已接手（Agent 认领或正在打印）。 */
const TASK_IN_DEVICE_STATUSES = ['claimed', 'printing'] as const
/** 一体机现场任务上由任务本身决定展示的状态（其余视为「还没被打印机接手」）。 */
const TASK_DECIDED_STATUSES = ['completed', 'failed', 'cancelled', 'claimed', 'printing'] as const

export type TimelineBucket = Exclude<MemberOrderTimelineStatusFilter, 'all'>

/** 展示状态 → status 过滤桶。waiting = 要本人动手；printing = 在打印机那边；done = 已结束。 */
export function timelineStatusBucket(status: MemberOrderTimelineDisplayStatus): TimelineBucket {
  switch (status) {
    case 'awaiting_arrival':
    case 'awaiting_payment':
      return 'waiting'
    case 'queued':
    case 'printing':
      return 'printing'
    default:
      return 'done'
  }
}

/** 支付已不在「能履约」范围时的展示：退款中/已退 → cancelled；关单/失败/未知 → expired。 */
function deadPayDisplay(payStatus: string): MemberOrderTimelineDisplayStatus {
  return REFUND_PAY_STATUSES.has(payStatus) ? 'cancelled' : 'expired'
}

/** 按打印任务状态（PrintTask.status 或 Order.taskStatus）给展示。未结束也未进机 → queued。 */
function fromTaskStatus(taskStatus: string): MemberOrderTimelineDisplayStatus {
  switch (taskStatus) {
    case 'completed':
    case 'failed':
    case 'cancelled':
    case 'expired':
      return taskStatus
    case 'claimed':
    case 'printing':
      return 'printing'
    default:
      return 'queued'
  }
}

/**
 * 一体机现场任务（PrintTask）。任务本身已结束或已进机时以任务为准；
 * 还在 pending 时看关联订单的钱：未付 → 待付款；已付或无订单（历史免费任务）→ 排队；
 * 退款中/已退 → 已取消；关单/失败 → 已过期。
 */
export function deriveTaskDisplayStatus(
  taskStatus: string,
  order: { payStatus: string } | null,
): MemberOrderTimelineDisplayStatus {
  if ((TASK_DECIDED_STATUSES as readonly string[]).includes(taskStatus)) return fromTaskStatus(taskStatus)
  if (!order || order.payStatus === 'paid') return 'queued'
  if (order.payStatus === 'unpaid' || order.payStatus === 'paying') return 'awaiting_payment'
  return deadPayDisplay(order.payStatus)
}

/**
 * 手机下的单（单件未到机 / 材料包）。顺序即优先级：
 * 1. 已派发（used）→ 按订单任务状态；
 * 2. 已取消 / 已过期 → 原样；
 * 3. 钱已不在能履约的状态 → 退款类 cancelled，其余 expired；
 * 4. pending → 待到机；claimed → 已付则排队（机器马上放行），未付则待付款；
 * 5. 其它取件态（none 等）→ 按任务状态。
 */
export function deriveOrderDisplayStatus(order: {
  pickupStatus: string
  payStatus: string
  taskStatus: string
}): MemberOrderTimelineDisplayStatus {
  if (order.pickupStatus === 'used') return fromTaskStatus(order.taskStatus)
  if (order.pickupStatus === 'cancelled') return 'cancelled'
  if (order.pickupStatus === 'expired') return 'expired'
  if (!(LIVE_PAY_STATUSES as readonly string[]).includes(order.payStatus)) return deadPayDisplay(order.payStatus)
  if (order.pickupStatus === 'pending') return 'awaiting_arrival'
  if (order.pickupStatus === 'claimed') return order.payStatus === 'paid' ? 'queued' : 'awaiting_payment'
  return fromTaskStatus(order.taskStatus)
}

// ── 与上面两个派生函数逐分支对应的查询条件 ─────────────────────────────────
// 改派生规则必须同改这里；门禁用三路真实数据核对 waiting ∪ printing ∪ done = all 且互不相交，
// 并逐条核对「过滤出来的每一条，派生结果都落在该桶」。

const TASK_UNDECIDED = { notIn: [...TASK_DECIDED_STATUSES] }

/** PrintTask 来源的 status 过滤条件（与 deriveTaskDisplayStatus 同口径）。 */
export function taskBucketWhere(bucket: TimelineBucket): Record<string, unknown> {
  if (bucket === 'done') {
    return {
      OR: [
        { status: { in: ['completed', 'failed', 'cancelled'] } },
        { status: TASK_UNDECIDED, order: { is: { payStatus: { notIn: [...LIVE_PAY_STATUSES] } } } },
      ],
    }
  }
  if (bucket === 'printing') {
    return {
      OR: [
        { status: { in: [...TASK_IN_DEVICE_STATUSES] } },
        { status: TASK_UNDECIDED, order: { is: null } },
        { status: TASK_UNDECIDED, order: { is: { payStatus: 'paid' } } },
      ],
    }
  }
  return { status: TASK_UNDECIDED, order: { is: { payStatus: { in: ['unpaid', 'paying'] } } } }
}

const SETTLED_PICKUP = ['used', 'cancelled', 'expired']
const OPEN_PICKUP = ['pending', 'claimed']

/** Order 来源（单件未到机 / 材料包）的 status 过滤条件（与 deriveOrderDisplayStatus 同口径）。 */
export function orderBucketWhere(bucket: TimelineBucket): Record<string, unknown> {
  const livePay = { in: [...LIVE_PAY_STATUSES] }
  const otherPickup = { notIn: [...SETTLED_PICKUP, ...OPEN_PICKUP] }
  if (bucket === 'done') {
    return {
      OR: [
        { pickupStatus: 'used', taskStatus: { in: [...TASK_TERMINAL_STATUSES] } },
        { pickupStatus: { in: ['cancelled', 'expired'] } },
        { pickupStatus: { notIn: SETTLED_PICKUP }, payStatus: { notIn: [...LIVE_PAY_STATUSES] } },
        { pickupStatus: otherPickup, payStatus: livePay, taskStatus: { in: [...TASK_TERMINAL_STATUSES] } },
      ],
    }
  }
  if (bucket === 'printing') {
    return {
      OR: [
        { pickupStatus: 'used', taskStatus: { notIn: [...TASK_TERMINAL_STATUSES] } },
        { pickupStatus: 'claimed', payStatus: 'paid' },
        { pickupStatus: otherPickup, payStatus: livePay, taskStatus: { notIn: [...TASK_TERMINAL_STATUSES] } },
      ],
    }
  }
  return {
    OR: [
      { pickupStatus: 'pending', payStatus: livePay },
      { pickupStatus: 'claimed', payStatus: { in: ['unpaid', 'paying'] } },
    ],
  }
}

// ── 到机码与本机领取 ──────────────────────────────────────────────────────────

type ArrivalOrder = {
  pickupCodeHash: string | null
  pickupStatus: string
  payStatus: string
  pickupCodeExpiresAt: Date | null
}

/**
 * 本单当前处于「可取」。判据：有哈希、pending、付款在 unpaid/paying/paid、截止在未来。
 * 这个函数只回答布尔。明文是否下发由订单视图决定：可取，或失败后仍可续打，才解密到机码。
 */
export function hasUsableArrivalCode(order: ArrivalOrder | null, now: Date = new Date()): boolean {
  if (!order?.pickupCodeHash) return false
  if (order.pickupStatus !== 'pending') return false
  if (!(LIVE_PAY_STATUSES as readonly string[]).includes(order.payStatus)) return false
  return Boolean(order.pickupCodeExpiresAt && order.pickupCodeExpiresAt > now)
}

export type ClaimableOrder = ArrivalOrder & {
  terminalId: string | null
  printTaskId: string | null
  pickupClaimedAt: Date | null
  paidAt: Date | null
}

/**
 * 当前这台（已验签）一体机能不能直接领这一单：
 * 有已验签终端身份、订单绑定的就是本机、取件态 pending/claimed、付款态 unpaid/paying/paid、
 * 取件窗口未关（与核销同一判定）、尚未派发打印任务。
 * 这里只是列表提示；真正领取时 claim-here 仍会完整走一遍核销判定。
 */
export function isClaimableHere(
  order: ClaimableOrder | null,
  verifiedTerminalId: string | null,
  now: Date = new Date(),
): boolean {
  if (!verifiedTerminalId || !order) return false
  if (order.terminalId !== verifiedTerminalId) return false
  if (!OPEN_PICKUP.includes(order.pickupStatus)) return false
  if (!(LIVE_PAY_STATUSES as readonly string[]).includes(order.payStatus)) return false
  if (order.printTaskId) return false
  return !isPickupClaimWindowClosed(order, now)
}
