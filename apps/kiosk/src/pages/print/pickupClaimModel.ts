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
import { errorCodeOf } from '../../services/api/userErrorMessage'

/**
 * 认领失败的四种屏。
 * - invalid：码不存在 / 已过期 / 不属于本机 —— 服务端对这几种故意回同一句，页面也不区分。
 * - locked：服务端按终端维度的失败锁定（PICKUP_CLAIM_LOCKED），锁定期内任何码都不再核对。
 * - network：网络/服务异常或缺少可信回执；是否已认领未知。认领对同一终端幂等，可以原码重查。
 * - other：其余明确业务拒绝（已退款、文件不可用、终端安全校验、限流等）。
 */
export type PickupFailure = 'invalid' | 'locked' | 'network' | 'other'

const INVALID_CODES = new Set([
  'PICKUP_CODE_INVALID',
  'PICKUP_CODE_EXPIRED',
  'PICKUP_CODE_LENGTH',
  'PICKUP_CODE_PATTERN',
])
const NETWORK_CODES = new Set(['NETWORK_ERROR', 'REQUEST_TIMEOUT', 'CLAIM_RECEIPT_UNKNOWN'])

export function classifyClaimFailure(error: unknown): PickupFailure {
  const code = errorCodeOf(error)
  if (code && INVALID_CODES.has(code)) return 'invalid'
  if (code === 'PICKUP_CLAIM_LOCKED') return 'locked'
  if (code && NETWORK_CODES.has(code)) return 'network'
  // 浏览器 fetch 失败是 TypeError；httpAdapter 把「连不上」记为 status 0。
  if (error instanceof TypeError) return 'network'
  if (error instanceof ApiHttpError && (error.status === 0 || error.status >= 500)) return 'network'
  return 'other'
}

/**
 * 锁定时一行版的说法（hid 指引屏只有一个错误位）。共享码表不登记 PICKUP_CLAIM_LOCKED，
 * 不在这里接住就会落到「请重试」——而锁定期内重试只会再被拒。
 * 服务端不回剩余时长，所以不写分钟数。
 */
export const PICKUP_LOCKED_MESSAGE = '本机输码暂时停用，过一段时间会自动解除；着急请找现场工作人员'

/** 稿里 data-testid="arrival-code-state-*" 的态名，便于和原型逐屏对照。 */
export type PickupScreen =
  | 'idle'
  | 'legacy'
  | 'verifying'
  | 'invalid-or-expired'
  | 'locked'
  | 'network-error'
  | 'failed'
  | 'success'
  | 'hid'

export function failureScreen(failure: PickupFailure): PickupScreen {
  if (failure === 'invalid') return 'invalid-or-expired'
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

/**
 * 成功两条分支完全由服务端 released 决定，用户不能自选：
 * released=false —— 订单已认领、未付款，付款成功后才创建打印任务；
 * released=true  —— 已付（或免费）订单，认领时服务端已经释放出打印任务。
 */
export function claimSuccessCopy(released: boolean): ClaimSuccessCopy {
  return released
    ? {
        title: '打印任务已释放',
        line: '这笔订单已支付（或为免费订单），打印任务已进入队列，请留在出纸口旁。',
        steps: ['订单已认领', '进入打印队列', '出纸后核对页数再离开'],
        cta: '查看打印进度',
      }
    : {
        title: '订单核验成功',
        line: '这笔订单还没支付。付款成功后系统才会创建打印任务，不会提前出纸。',
        steps: ['订单已认领', '去收银台现场支付', '支付完成开始打印'],
        cta: '进入现场支付',
      }
}

/** 成功卡订单行的补充信息：只转述回执里真有的文件名与金额，缺哪项就省哪项。 */
export function claimMetaLine(fileName: string | null | undefined, amountCents: number | undefined): string {
  return [fileName || null, typeof amountCents === 'number' ? `金额 ${formatCents(amountCents)}` : null]
    .filter(Boolean)
    .join(' · ')
}
