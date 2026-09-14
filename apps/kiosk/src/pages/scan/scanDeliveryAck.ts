import { SCAN_TASK_ACK_NOT_ALLOWED } from '@ai-job-print/shared'
import { SCAN_ACK_CREDENTIALS_INCOMPLETE, ackScanSession } from '../../services/api/scanTasks'
import { errorCodeOf } from '../../services/api/userErrorMessage'
import type { SessionFailure } from './scanRescanRecovery'

/**
 * 投递确认（ACK）——「这台机器上现在有一个人正看着这一场扫描」的唯一证据。
 *
 * ## 它修的是哪一个缺陷
 *
 * 在这之前，`POST /scan/sessions` 一返回 2xx，服务端那条任务就已经可投递了：
 * Agent 的 current-lease 立刻看得见它，面板上扫出来的文件会直接投过去。于是只要
 * 那份 2xx **没能变成屏幕上的一场会话**（回话在路上丢了、页面被整页重载、清场把本机
 * 登记抹了），服务端就留下一个可投递却没有任何界面在看着的收件箱：下一位走到面板前
 * 按下扫描，文件进的是上一位的任务。一体机是公共设备，这是这条链路上最后一个能
 * 跨用户串件的口子。
 *
 * 服务端 2026-09-14 起把它改成两段：新建会话一律 `deliveryAckedAt = null`，
 * current-lease **看不见**未确认的行（60 秒没确认就回收）；只有本机确认自己确实
 * 握着这一场的控制凭据之后，它才变得可投递。
 *
 * ## 于是本机这一侧多了一条硬规矩
 *
 * **ACK 成功之前，屏幕上不许出现任何让用户去面板按开始的东西**（操作指引、
 * 「我已操作，开始等待」都算）。理由不是保守：未确认的任务在服务端是不可投递的，
 * 这时候让用户扫，那张纸会落进 Agent 的 `_unclaimed` 而不是他的会话，
 * 人在机器前白等到轮询上限，屏幕上一句解释都没有。
 *
 * ACK 失败也照旧安全 —— 任务停在「不可投递」，不会被谁领走。所以失败时本机要做的
 * 只有一件事：**如实说还没确认，并且不要叫人去扫**。
 */

export interface ScanAckCredentials {
  scanTaskId: string
  controlToken: string
}

/**
 * 本机这一侧的确认进度。设置页和等待页共用同一套取值，因为它们要回答的是同一个问题：
 * **现在能不能让用户去面板上按开始**。
 *
 * 'idle' 还没有可确认的会话；'pending' 正在确认（或刚建成、马上要确认）；
 * 'acked' 服务端已经记下投递授权，这一场可投递；'retryable' 上一次确认没成，
 * 但服务端没有拒绝这一场 —— 任务仍停在不可投递，谁都收不到那张纸，可以再问一次。
 */
export type ScanAckState = 'idle' | 'pending' | 'acked' | 'retryable'

/**
 * 「服务端明确不认这一场」的三个码。判据只有码，不看本机状态。
 *
 * · {@link SCAN_TASK_ACK_NOT_ALLOWED}（409）：任务不是未过期的 waiting/matched，
 *   服务端不会再让它变得可投递 —— 这一场到此为止；
 * · `SCAN_TASK_FORBIDDEN`（403）：控制凭据 / 会员身份 / 终端对不上。本机手里这份
 *   凭据操作不了那条任务，留着它只会让页面对着一场自己碰不到的会话发号施令；
 * · `SCAN_TASK_NOT_FOUND`（404）：服务端那边根本没有这条任务。
 *
 * 第四个来自本机 `scanTasks.ts`：凭据不全，请求根本没发出去，同样是确定结论。
 *
 * 码取自 shared 的常量而不是重打一遍字符串：两处各写一份、其中一处被改掉时，
 * 这张表就永远匹配不上服务端回的那个码 —— 闸门看起来还在，实际已经空转。
 */
export const SCAN_ACK_DEFINITIVE_CODES = new Set<string>([
  SCAN_TASK_ACK_NOT_ALLOWED,
  'SCAN_TASK_FORBIDDEN',
  'SCAN_TASK_NOT_FOUND',
  SCAN_ACK_CREDENTIALS_INCOMPLETE,
])

export function isDefinitiveAckRefusal(code: string | undefined): boolean {
  return code !== undefined && SCAN_ACK_DEFINITIVE_CODES.has(code)
}

/**
 * 服务端明确不认这一场（fail-closed 那一屏）。
 *
 * 这些 description 是**纯字符串**，直接渲染进 `<p>`，没有 markdown：
 * 写 `**粗体**` 会把星号原样打在 27 寸公共屏上。
 *
 * 必须说清三件事，少一件用户就会做错动作：这一场不能用了、本机已经把它撤掉了
 * （所以没有谁在等他那张纸）、现在别去面板按开始。
 */
export const SCAN_ACK_REFUSED_FAILURE: SessionFailure = {
  title: '这次扫描会话没能取得投递授权',
  description: '会话建出来了，但本机向服务端确认投递授权时被明确拒绝：这一场已经过期、'
    + '被取消或已经结束，服务端不会再把面板上扫出来的文件投给它。本页已经把它撤掉，'
    + '也清掉了本机这一份记录，所以服务端那边没有留下还在等文件的任务，'
    + '你手上的纸不会被谁悄悄收走。现在请先别在面板上按开始：没有会话认领那份文件。'
    + '要继续请按「重新开始一次扫描」建一个新会话。',
}

/**
 * 还没确认，但也没被拒（断网 / 5xx / 429 / 终端票失效）。
 *
 * 这一屏最要紧的是**不把话说死，也不叫人去扫**：会话确实建成了，但它此刻在服务端
 * 是不可投递的，这时候扫一张纸只会白扫。所以出路是「再确认一次」，不是「去面板操作」。
 */
export const SCAN_ACK_PENDING_FAILURE: SessionFailure = {
  title: '还没确认这台机器能收这份文件',
  description: '扫描会话已经建成，但本机还没能向服务端确认投递授权。没确认之前，'
    + '打印机面板上扫出来的文件不会被投递到这一场，所以现在按开始只会白扫一张纸，'
    + '也不会被别人收走。这一步可以重来：点「再确认一次」让本机再问一遍服务端。'
    + '一直不成就安全返回扫描首页，或者叫工作人员看一眼这台机器到服务端的网络。',
}

/**
 * 还在确认（还没有任何失败结论）时那一屏的正文。
 *
 * 和上面两条一样是**纯字符串**：它会被原样渲染进 `<p>`，写 markdown 会把星号
 * 打在 27 寸公共屏上。三句缺一不可 —— 会话确实建成了、这一刻扫也没用、
 * 但也不会被别人收走（否则用户会以为自己的纸有风险，转身去找工作人员）。
 */
export const SCAN_ACK_PENDING_NOTICE = '扫描会话已经建成。本机正在向服务端确认投递授权：'
  + '确认之前，打印机面板上扫出来的文件不会被投递到这一场，所以请先别在面板上按开始。'
  + '这一场也不会被别人收走 —— 没确认的任务对谁都不可投递。'

/**
 * 等待页上被明确拒绝时写进结果快照的那句话。
 *
 * 和 {@link SCAN_ACK_REFUSED_FAILURE} 说的是同一件事，但不能共用一份文字：那一份的
 * 出路是设置页上的「重新开始一次扫描」，而等待页拒绝之后落的是结果屏，
 * 那里根本没有这颗按钮 —— 照抄过去就是指了一条按不到的路。
 */
export const SCAN_ACK_REFUSED_PROGRESS_REASON = '服务端没有给这一场投递授权（已过期、被取消'
  + '或已经结束），本机已经把它撤掉。面板上扫出来的文件不会投到这一场，'
  + '你手上的纸也不会被谁收走。要继续请重新开始一次扫描。'

export type ScanAckOutcome =
  | { ok: true; deliveryAckedAt: string }
  | { ok: false; definitive: boolean; failure: SessionFailure }

/**
 * 把一次 ACK 失败翻译成「确定 / 不确定」加一屏结论。纯函数，不碰任何状态。
 *
 * 二选一的判据只有失败码：
 *   · 确定 → 这一场永远不会变得可投递，调用方必须撤销 + 清本机登记 + fail-closed；
 *   · 不确定 → 任务仍停在不可投递，调用方只需如实说还没确认，并保留重试。
 *
 * 刻意**不**把服务端的 message 透出来：ACK 的失败文案要回答的是「我现在能不能去
 * 面板按开始」，而服务端那句话（比如「当前扫描任务状态不允许确认投递」）回答不了它。
 */
export function classifyAckFailure(error: unknown): { definitive: boolean; failure: SessionFailure } {
  const definitive = isDefinitiveAckRefusal(errorCodeOf(error))
  return {
    definitive,
    failure: definitive ? SCAN_ACK_REFUSED_FAILURE : SCAN_ACK_PENDING_FAILURE,
  }
}

/**
 * 发一次 ACK，把结果压成「能不能放行」这一个判断。
 *
 * 幂等：服务端对已经确认过的任务原样回那一刻的 `deliveryAckedAt`，所以复水、
 * 整页重载、用户手动重试都可以放心再发一次，不会有副作用。
 *
 * 不抛异常 —— 调用方拿到的永远是一个结论。ACK 这条链路上「抛出去」没有意义：
 * 每一种失败都必须落成屏幕上的一句话，没有哪一种可以静默。
 */
export async function acknowledgeScanDelivery(
  credentials: ScanAckCredentials,
  memberToken: string | null | undefined,
): Promise<ScanAckOutcome> {
  try {
    const acked = await ackScanSession(credentials.scanTaskId, credentials.controlToken, memberToken)
    // 服务端回了 2xx 但没带时间戳：这不是一次可用的确认，按「还没确认」处理，
    // 绝不能据此放行 —— 放行的判据必须是服务端真的写下了那一笔。
    if (typeof acked?.deliveryAckedAt !== 'string' || acked.deliveryAckedAt.trim().length === 0) {
      return { ok: false, definitive: false, failure: SCAN_ACK_PENDING_FAILURE }
    }
    return { ok: true, deliveryAckedAt: acked.deliveryAckedAt }
  } catch (error) {
    const { definitive, failure } = classifyAckFailure(error)
    return { ok: false, definitive, failure }
  }
}
