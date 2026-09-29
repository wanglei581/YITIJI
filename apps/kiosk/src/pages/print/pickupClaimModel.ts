// ============================================================
// pickupClaimModel —— 到机码页（稿 11-arrival-code.html）的纯逻辑
//
// 只放「从服务端回执推出该画哪一屏」的判定与派生，不发请求、不碰 DOM：
//   · 认领失败按错误码分成稿里的几种态（无效或过期 / 锁定 / 网络 / 其他）；
//   · 码位格的格数与内容；
//   · 历史码字母键盘的键位（由 shared 字符集推出，不手写）；
//   · 认领成功两条分支（未付 → 收银台；已释放 → 打印进度）的步骤文案。
//
// 请求本身（终端会话票、x-terminal-id、staleSignal）仍在页面里，门禁按页面文件取证。
// ============================================================

import {
  LEGACY_PICKUP_CODE_ALPHABET,
  PICKUP_CODE_LENGTH,
  PICKUP_CODE_MAX_INPUT_LENGTH,
} from '@ai-job-print/shared'
import { ApiHttpError } from '../../services/api/httpAdapter'
import { formatCents } from './cashierStatus'
import { SHARED_USER_MESSAGE_CODES, errorCodeOf, userMessageOf } from '../../services/api/userErrorMessage'

/**
 * 认领失败的五种屏。
 * - invalid：码不存在 / 已过期 / 不属于本机 —— 服务端对这几种故意回同一句，页面也不区分。
 * - locked：服务端按终端维度的失败锁定（PICKUP_CLAIM_LOCKED），锁定期内任何码都不再核对。
 * - network：网络/服务异常或缺少可信回执；是否已认领未知。认领对同一终端幂等，可以原码重查。
 * - closed：这枚码在服务端已经是终态（已用过、已退款、文件失效、订单不能再付款），
 *   在这台机器上怎么重输都不会变。主操作不能是「重试 / 重新输入」：照着重输只会占限流配额，
 *   后面排队的人也跟着用不了。出路是回手机重新下单或找工作人员。
 * - other：其余明确业务拒绝（本机不能打印、隐私检查未完成、限流、并发冲突等），稍后可能恢复。
 */
export type PickupFailure = 'invalid' | 'locked' | 'network' | 'closed' | 'other'

const INVALID_CODES = new Set([
  'PICKUP_CODE_INVALID',
  'PICKUP_CODE_EXPIRED',
  'PICKUP_CODE_LENGTH',
  'PICKUP_CODE_PATTERN',
])
const NETWORK_CODES = new Set(['NETWORK_ERROR', 'REQUEST_TIMEOUT', 'CLAIM_RECEIPT_UNKNOWN'])

/**
 * 服务端已是终态的码：同一枚码在这台机器上再输多少次结果都一样。
 * 门禁 verify-pickup-claim-error-coverage 断言这几个码的文案不含「重试」、分类为 closed。
 */
export const PICKUP_CLOSED_CODES: ReadonlySet<string> = new Set([
  'PICKUP_CODE_ALREADY_USED',
  'PICKUP_CODE_UNAVAILABLE',
  'ORDER_REFUNDED',
  'ORDER_PAYMENT_UNAVAILABLE',
  'PRINT_FILE_EXPIRED',
  'PRINT_FILE_NOT_FOUND',
  'FILE_CONTENT_CHANGED',
])

/**
 * 锁定时一行版的说法（hid 指引屏只有一个错误位）。共享码表不登记 PICKUP_CLAIM_LOCKED，
 * 不在这里接住就会落到「请重试」——而锁定期内重试只会再被拒。
 * 服务端不回剩余时长，所以不写分钟数。
 */
export const PICKUP_LOCKED_MESSAGE = '本机输码暂时停用，过一段时间会自动解除；着急请找现场工作人员'

const TERMINAL_NOT_READY_MESSAGE = '这台机器暂时不能取件，请找现场工作人员'
const ORDER_BUSY_MESSAGE = '这笔订单正在处理，请等几秒再输一次；仍不行请找现场工作人员'

/**
 * 认领接口（POST /print/jobs/claim-pickup）会回的错误码 → 站在机器前的人能照着做的一句话。
 *
 * 为什么不直接用共享码表：共享码表按「跨页面通用」写，比如 PICKUP_CODE_UNAVAILABLE 在那里是
 * 「暂时不可用」—— 对取件来说「暂时」会引人重输。这里按取件场景逐码写，未登记的码再落共享码表。
 * 码的来源是 services/api/src/print-jobs/pickup-order.service.ts 的 claim() 链路（含它调用的
 * release / 文件就绪 / 隐私检查 / 能力开关）；门禁从服务端源码抽码，逐个断言这里有。
 */
export const PICKUP_CLAIM_MESSAGES: Readonly<Record<string, string>> = {
  PICKUP_CODE_INVALID: '到机码无效或已过期，请核对后重新输入',
  PICKUP_CODE_EXPIRED: '到机码无效或已过期，请核对后重新输入',
  PICKUP_CODE_ALREADY_USED: '这个到机码已经用过，不能再次取件。要再打一份，请在手机上重新下单；没拿到纸请找现场工作人员',
  PICKUP_CODE_UNAVAILABLE: '这个到机码已经不能使用。请在手机小程序「我的 → 打印订单」查看这笔订单，需要的话重新下单',
  ORDER_REFUNDED: '本单已退款，不再出纸。款项按原路退回，可在小程序「我的 → 打印订单」查看退款进度',
  ORDER_PAYMENT_UNAVAILABLE: '这笔订单已经不能付款（可能已关闭）。请在手机小程序「我的 → 打印订单」查看，需要的话重新下单',
  PRINT_FILE_EXPIRED: '这笔订单的文件已经失效，不能打印。请在手机上重新上传文件、重新下单',
  PRINT_FILE_NOT_FOUND: '这笔订单的文件已经失效，不能打印。请在手机上重新上传文件、重新下单',
  FILE_CONTENT_CHANGED: '这笔订单的文件已经失效，不能打印。请在手机上重新上传文件、重新下单',
  PRINT_PII_SCAN_REQUIRED: '这份文件的隐私检查还没完成，暂时不能打印。请过一会儿再输一次，或找现场工作人员',
  PII_SCAN_STALE: '这份文件在隐私检查后又改过，暂时不能打印。请在手机上重新检查后再来取件',
  PICKUP_CLAIM_RATE_LIMITED: '输码太频繁了，请等一分钟再输',
  PICKUP_CLAIM_LOCKED: PICKUP_LOCKED_MESSAGE,
  CAPABILITY_NOT_CONFIGURED: '这台机器暂时不能打印这笔订单，请找现场工作人员',
  CAPABILITY_UNAVAILABLE: '这台机器暂时不能打印这笔订单，请找现场工作人员',
  PRINT_TERMINAL_NOT_READY: TERMINAL_NOT_READY_MESSAGE,
  PRINT_TERMINAL_DEGRADED: TERMINAL_NOT_READY_MESSAGE,
  PRINT_TERMINAL_NOT_FOUND: TERMINAL_NOT_READY_MESSAGE,
  TERMINAL_ID_REQUIRED: TERMINAL_NOT_READY_MESSAGE,
  ORDER_NOT_FOUND: '没有找到这笔订单，请核对到机码后重新输入',
  PICKUP_TERMINAL_MISMATCH: '到机码无效或已过期，请核对后重新输入',
  PICKUP_NOT_CLAIMED: ORDER_BUSY_MESSAGE,
  ORDER_NOT_PAID: ORDER_BUSY_MESSAGE,
  ORDER_RELEASE_INVALID_STATE: ORDER_BUSY_MESSAGE,
  ORDER_RELEASE_CONFLICT: ORDER_BUSY_MESSAGE,
}

export function classifyClaimFailure(error: unknown): PickupFailure {
  const code = errorCodeOf(error)
  if (code && INVALID_CODES.has(code)) return 'invalid'
  if (code === 'PICKUP_CLAIM_LOCKED') return 'locked'
  if (code && PICKUP_CLOSED_CODES.has(code)) return 'closed'
  if (code && NETWORK_CODES.has(code)) return 'network'
  // 浏览器 fetch 失败是 TypeError；httpAdapter 把「连不上」记为 status 0。
  if (error instanceof TypeError) return 'network'
  if (error instanceof ApiHttpError && (error.status === 0 || error.status >= 500)) return 'network'
  return 'other'
}

/** 未登记的码走共享码表；共享码表也没有时用这句（它是「还能再试」的那类失败才会落到的）。 */
export const PICKUP_CLAIM_FALLBACK_MESSAGE = '到机码校验没有完成，请重试或联系现场工作人员'

/**
 * 认领失败时屏上那一句话。取件页没有会员登录：未登记的 401/403 不能落成共享码表的
 * 「登录状态已失效」，按「本机安全校验」说。
 */
export function pickupClaimMessage(error: unknown): string {
  const code = errorCodeOf(error)
  if (code && Object.prototype.hasOwnProperty.call(PICKUP_CLAIM_MESSAGES, code)) {
    return PICKUP_CLAIM_MESSAGES[code] as string
  }
  if (code && SHARED_USER_MESSAGE_CODES.includes(code)) return userMessageOf(error, PICKUP_CLAIM_FALLBACK_MESSAGE)
  if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
    return '这台机器的安全校验没通过，请找现场工作人员'
  }
  return userMessageOf(error, PICKUP_CLAIM_FALLBACK_MESSAGE)
}


/** 稿里 data-testid="arrival-code-state-*" 的态名，便于和原型逐屏对照。 */
export type PickupScreen =
  | 'idle'
  | 'legacy'
  | 'verifying'
  | 'invalid-or-expired'
  | 'locked'
  | 'network-error'
  | 'closed'
  | 'failed'
  | 'success'
  | 'hid'

export function failureScreen(failure: PickupFailure): PickupScreen {
  if (failure === 'invalid') return 'invalid-or-expired'
  if (failure === 'closed') return 'closed'
  if (failure === 'locked') return 'locked'
  if (failure === 'network') return 'network-error'
  return 'failed'
}

/**
 * 码位格：出现字母或超过 8 位就按 10 位历史码显示——不阻断、不截断。
 * 只影响显示几格，受理判据仍是 shared 的 PICKUP_CODE_ACCEPTED_PATTERN。
 */
export function pickupCells(display: string, legacyMode: boolean): string[] {
  const legacy = legacyMode || display.length > PICKUP_CODE_LENGTH || /[A-Z]/.test(display)
  const count = legacy ? PICKUP_CODE_MAX_INPUT_LENGTH : PICKUP_CODE_LENGTH
  return Array.from({ length: count }, (_, i) => display[i] ?? '')
}

/** 历史码键盘键位 = 存量码 31 字符集本身（没有 0/O/1/I/L，键盘上就没有这几个键）。 */
export const LEGACY_KEYS: readonly string[] = LEGACY_PICKUP_CODE_ALPHABET.split('')

export interface ClaimSuccessCopy {
  title: string
  line: string
  steps: readonly [string, string, string]
  cta: string
}

const FINISHED_PRINT_STATUSES = new Set(['completed', 'failed', 'cancelled', 'abandoned'])

/**
 * 成功文案先看有没有放行打印，放行后再看打印状态：
 * released=false —— 还没付款，去收银台；
 * released=true 且已经打完 —— 如实说完成，给出路；
 * 其余已放行 —— 还在队列或正在出纸，请留在出纸口旁。
 */
export function claimSuccessCopy(released: boolean, printTaskStatus?: string | null): ClaimSuccessCopy {
  if (!released) {
    return {
      title: '订单核验成功',
      line: '这笔订单还没支付。付款成功后才会开始打印，不会提前出纸。',
      steps: ['订单已核对', '去收银台现场支付', '支付完成开始打印'],
      cta: '进入现场支付',
    }
  }
  if (printTaskStatus === 'completed') {
    return {
      title: '这一单已经打印完成',
      line: '这一单已经打印完成。请核对出纸口的纸张，核对后可以离开。',
      steps: ['订单已核对', '打印已经完成', '核对后可以离开'],
      cta: '查看打印结果',
    }
  }
  if (printTaskStatus === 'failed' || printTaskStatus === 'cancelled' || printTaskStatus === 'abandoned') {
    return {
      title: '这一单没有打成',
      line: '这一单没有打成。请联系现场工作人员，不要在出纸口空等。',
      steps: ['订单已核对', '打印没有完成', '找工作人员处理'],
      cta: '查看这一单',
    }
  }
  if (printTaskStatus === 'printing') {
    return {
      title: '正在出纸',
      line: '打印机正在出纸，请留在出纸口旁。',
      steps: ['订单已核对', '正在出纸', '出完再核对页数'],
      cta: '查看打印进度',
    }
  }
  return {
    title: '已进入打印队列',
    line: '打印任务已进入队列，请留在出纸口旁。',
    steps: ['订单已核对', '进入打印队列', '出纸后核对页数再离开'],
    cta: '查看打印进度',
  }
}

/** 认领成功后去哪一页。已完成不能再送去「请留在出纸口旁」的进度页。 */
export function claimSuccessDestination(input: {
  released: boolean
  printTaskStatus?: string | null
  taskId?: string | null
}): '/print/cashier' | '/print/progress' | '/print/done' | '/me/print-orders' {
  if (!input.released) return '/print/cashier'
  if (FINISHED_PRINT_STATUSES.has(input.printTaskStatus ?? '')) {
    return input.taskId ? '/print/done' : '/me/print-orders'
  }
  return '/print/progress'
}

/** 成功卡订单行的补充信息：只转述回执里真有的文件名与金额，缺哪项就省哪项。 */
export function claimMetaLine(fileName: string | null | undefined, amountCents: number | undefined): string {
  return [fileName || null, typeof amountCents === 'number' ? `金额 ${formatCents(amountCents)}` : null]
    .filter(Boolean)
    .join(' · ')
}
