import type { ScanSessionCreateResponse } from '@ai-job-print/shared'
import { ApiHttpError } from '../../services/api/httpAdapter'

/**
 * 「这次配对创建到底建成了没有」——把这个问题问到有答案为止（有界）。
 *
 * ## 它修的是哪一个缺陷
 *
 * `POST /scan/sessions` 的响应在回来的路上丢了（断网、代理掐断、进程被换）。
 * 浏览器侧只能看到一个 TypeError，本机据此判「结果未知」。但服务端那一边**可能已经
 * 提交了一条 child waiting 任务**：它挂在这台终端上等文件。本机既不知道它的 id，
 * 也不知道它的 controlToken，于是：
 *   · 屏幕上什么都没有，用户以为没建成；
 *   · 服务端那条 waiting 却是真的，下一位走到面板前按下扫描，
 *     文件就投给了这条**没有任何界面在看着**的任务。
 * 一体机是公共设备，这正是「看不见的收件箱」——必须主动去把它找回来。
 *
 * ## 为什么「再发一次同样的请求」是安全的
 *
 * 服务端把配对重扫创建做成了幂等（2026-09-14）：同一对
 * `retryOfScanTaskId` + `X-Scan-Retry-Control`（同一用户 / 终端 / scanType）再发一次
 * 拿回的是**同一个 child**，`scanTaskId` 不变、`controlToken` 就是上一场那份明文，
 * 不会再消费一次授权，也不会插第二条 child。所以重放不是「再建一个」，
 * 而是「把刚才那个领回来」。child 已经不在 waiting/matched 或已过期时回
 * 409 `SCAN_RETRY_CHILD_NOT_RECOVERABLE` —— 那是一个**确定**的答案，重放到此为止。
 *
 * ## 三条边界，一条都不放宽
 *
 * 1. **只对配对请求重放。** 普通创建没有幂等键，重发就是真的多建一条。
 *    `paired === false` 时第一个错误原样抛出，一个字节都不重发。
 * 2. **只对「结果未知」重放。** 拿到任何 HTTP 应答（429 / 409 SCAN_TERMINAL_BUSY /
 *    401 / 5xx / 403）都说明服务端**回过话**了，结论是确定的：立即抛出，交给页面按
 *    既有的失败码分流（429 / BUSY / 5xx 仍然走用户手动的「再试一次安全重扫」）。
 *    这条是 review 要求 5 的全部内容 —— 自动重放只吃真正的未知态。
 * 3. **有界，且退避。** 创建端点是 12 次/分**按出口 IP** 计的
 *    （scan-tasks.controller.ts 的 `@Throttle`，tracker 是纯 IP），一个大厅里好几台
 *    机器共用一个桶。下面 5 次重放最坏情况用掉 6/12，剩下一半留给用户自己的动作。
 *    时间上约 24 秒封顶，不会一直转。
 */

/** 本机重放到头仍然问不出结果时抛的码。status 必须是 0（结果确实未知）。 */
export const SCAN_CREATE_REPLAY_UNRESOLVED = 'SCAN_CREATE_REPLAY_UNRESOLVED'

/**
 * 退避表。首次 800ms（网络抖动多半已经过去），随后翻倍，总计 5 次 ≈ 24.8 秒。
 *
 * 不取更密：创建端点按出口 IP 限 12 次/分，密了会把整个大厅的额度烧掉。
 * 不取更长：child 的 `expiresAt` 是服务端给的 10 分钟，本机**不得延长**它；
 * 重放拖得越久，用户对着「正在确认」的等待就越没有意义 —— 到点就如实说问不出来，
 * 把「要不要再试」交回给用户（那一次仍然是成对的，仍然会被服务端幂等地领回同一条）。
 */
export const SCAN_CREATE_REPLAY_DELAYS_MS: readonly number[] = [800, 1600, 3200, 6400, 12800]

/**
 * 「连服务端收没收到都不知道」——只有这一种才配自动重放。
 *
 * 判据是本仓的既有约定：`status === 0` 表示压根没拿到 HTTP 应答
 * （`scanTasks.ts` 的 networkError 就是这么造的）。
 * 注意 `TERMINAL_SESSION_INVALID` 是 401、`SCAN_RESCAN_AUTHORITY_INCOMPLETE` 是 400，
 * 两者都表示「请求根本没发出去」，结论确定，因此都**不**在这里。
 */
export function isUnknownCreateOutcome(error: unknown): boolean {
  return error instanceof ApiHttpError && (error.code === 'NETWORK_ERROR' || error.status === 0)
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => { window.setTimeout(resolve, ms) })
}

export interface ScanCreateReplayOptions {
  /** 注入用（单测把它压到 0）。生产恒为上面那张表。 */
  delaysMs?: readonly number[]
  sleep?: (ms: number) => Promise<void>
  /** 每次重放**发出之前**回调一次（1 起算），供页面如实改口说「正在确认」。 */
  onReplay?: (attempt: number) => void
  /**
   * 每一次重放**发出之前**问一句「这件事还值不值得做」。返回 false 就当场收手，
   * 按「问不出结果」结束（抛 {@link SCAN_CREATE_REPLAY_UNRESOLVED}）。
   *
   * 唯一的调用场景是清场：这一位用户已经走了，把那条 child 领回来已经没有任何意义
   * （没人会用它），而重放最长 24 秒 —— 那 24 秒里清场屏只能干等着，机器交不出去。
   * 收手之后那条 child 仍然是安全的：本机从来不知道它的 id，也就**永远不会确认它**，
   * 而 `getScanDeliveryLease()` 只签 `deliveryAckedAt: { not: null }` 的行，
   * 未确认的 waiting 对 Agent 自始至终不可见，60 秒后还会被未确认回收器收成 expired。
   *
   * 不传就是「一直重放到有答案」—— 页内离开（leaveScanFlow）走的正是这一条：
   * 那时执行环境还在，领回来的 child 会被当场撤掉，比留给回收器干净。
   */
  shouldContinue?: () => boolean
}

/**
 * 发一次创建；结果未知且这一次是配对重扫时，按退避表把**同一个** send 重放到有答案。
 *
 * `send` 由调用方给，且必须是同一个闭包：重放复用它，才能保证发出去的永远是同一对
 * （body 里的 `retryOfScanTaskId` + `X-Scan-Retry-Control` 头）。本模块**从不**自己
 * 构造请求，也就没有任何路径能退化成一个无签名的普通创建。
 *
 * @returns 服务端真实回过的那一条会话（第一次的，或者重放领回来的同一条 child）。
 * @throws 任何确定的失败原样抛出；重放到头仍未知则抛 `SCAN_CREATE_REPLAY_UNRESOLVED`。
 */
export async function replayCreateUntilOutcomeKnown(
  send: () => Promise<ScanSessionCreateResponse>,
  paired: boolean,
  options: ScanCreateReplayOptions = {},
): Promise<ScanSessionCreateResponse> {
  try {
    return await send()
  } catch (firstError) {
    // 普通创建没有幂等键，重发就是真的多建一条；确定的失败也没有什么可问的。
    if (!paired || !isUnknownCreateOutcome(firstError)) throw firstError

    const delays = options.delaysMs ?? SCAN_CREATE_REPLAY_DELAYS_MS
    const sleep = options.sleep ?? defaultSleep
    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      // 问在**发出之前**，不是发出之后：清场那一刻已经在飞的那一次仍然会回来
      // （它的凭证照旧交给 scanCleanupGate 撤掉），但不会再有新的一次被发出去。
      if (options.shouldContinue && !options.shouldContinue()) break
      options.onReplay?.(attempt + 1)
      await sleep(delays[attempt] ?? 0)
      try {
        return await send()
      } catch (replayError) {
        // 又是未知 → 继续退避；拿到确定答案（含 409 child 不可恢复）→ 当场收工。
        if (!isUnknownCreateOutcome(replayError)) throw replayError
      }
    }
    throw new ApiHttpError(
      SCAN_CREATE_REPLAY_UNRESOLVED,
      '无法确认这次安全重扫是否已经建成会话',
      0,
    )
  }
}
