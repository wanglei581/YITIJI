import { API_BASE_URL } from '../../services/api/client'
import { getTerminalId } from '../../services/api/screensaver'
import { readScanWorkbenchSession, type ScanLiveState } from './scanWorkbenchSession'

/**
 * 清掉本机扫描会话之前，先把服务端那个还活着的扫描任务撤掉。
 *
 * ## 为什么必须有这一步
 *
 * 本机的 `ai-job-print:current-scan-workbench` 只是**一份凭证副本**：真正决定
 * 「打印机面板扫出来的那份文件投递给谁」的是服务端的 ScanTask。清场（隐私空闲、
 * 屏保、退出、换人）只清本地那份副本，服务端任务照样停在 waiting —— 下一位用户
 * 走到面板前按下扫描，文件会被投递到**上一位用户**的任务上。清本地不撤服务端，
 * 等于把上一位的收件箱留在原地。
 *
 * ## 三条硬约束
 *
 * 1. **必须用即将失效的那个身份发**。服务端 `cancel()` 校验 `task.endUserId === endUserId`
 *    （scan-tasks.service.ts），换人场景里如果用新用户的令牌发，服务端只会回 403，
 *    旧任务原地存活 —— 比不发还糟（看起来撤了，其实没撤）。所以入参是 outgoing token，
 *    由调用方在清空登录态**之前**取。
 * 2. **不重试，不阻塞**。这条路径全部发生在页面正在被拆掉的那一刻
 *    （clearing 遮罩、logout、整页 reload）。keepalive 让请求在文档卸载后仍能送达；
 *    任何 await / 重试都可能把清场卡住，而清场比撤销更要紧。
 *    清场链路合起来对一个任务只发一次；**唯一的例外**是「离开之后 ACK 才成功」那一支，
 *    它可以补一次，理由与上限见 {@link REVOKE_ATTEMPT_CAP}。
 * 3. **已是终态就不发**。completed / failed / cancelled / expired 的任务再 DELETE，
 *    只会换回 400 SCAN_TASK_ALREADY_COMPLETED 或 404，白白制造一次噪音请求。
 */

/**
 * 一次撤销是什么性质的。它只决定一件事：**这一次允许不允许越过去重**。
 *
 * · `'best-effort'`：清场链路上的尽力而为（隐私空闲 / 退出 / 屏保 / 离开扫描流程 /
 *   创建响应迟到）。同一次清场往往连着触发好几条
 *   （KioskPrivacyGuard.hardClear → logout → clearKioskSensitiveSession），
 *   所以它们合起来对一个任务只许发一次。
 * · `'ack-compensation'`：**一次投递确认在离开之后才回来**，调用方据此补一次撤销。
 *   这一次必须允许，哪怕之前已经尽力而为过一次 —— 理由见 {@link REVOKE_ATTEMPT_CAP}。
 */
export type ScanRevokeIntent = 'best-effort' | 'ack-compensation'

/**
 * 每个 scanTaskId **累计**允许发出的 DELETE 次数，按意图取上限。
 *
 * ## 为什么补偿那一次不能和清场共用同一道去重
 *
 * 顺序是这样的：用户离开 → `revokeLiveScanSession` 发第一次 DELETE（登记进计数）→
 * 那一次在路上丢了（keepalive 请求随文档拆卸被掐断、网络抖动，本机永远不会知道）→
 * 而离开那一刻还在飞的那次 ACK **成功了**。
 *
 * 到这一步，服务端那条任务同时满足两件事：`deliveryAckedAt` 非空（所以 60 秒
 * 未确认回收器收不到它）、状态仍是 waiting（所以 Agent 的 current-lease 看得见它）。
 * 它就是一个可投递却没有任何界面在看着的收件箱，会一直活到自然过期 ——
 * 下一位走到面板前按下扫描，文件投给已经走掉的上一位。这是跨用户串件。
 *
 * 而且「ACK 成功」本身就是**第一次 DELETE 没有生效的证据**：服务端的 ack() 只对
 * 未过期的 waiting/matched 放行，任务真被撤掉的话那一次确认会拿回 409
 * SCAN_TASK_ACK_NOT_ALLOWED。所以补发不是重试一个也许成功了的请求，
 * 而是对一个**已知没生效**的请求做一次补偿。
 *
 * 上限是 2 而不是「不限次」：这条路径上真正需要的只有「再来一次」，
 * 而撤销永远是尽力而为（不重试、不阻塞、不 await）。封在 2 之后，
 * 反复清场、两屏各自补偿、用户来回按，合起来对一个任务最多两次 DELETE。
 */
const REVOKE_ATTEMPT_CAP: Record<ScanRevokeIntent, number> = {
  'best-effort': 1,
  'ack-compensation': 2,
}

/**
 * 每个 scanTaskId 已经发出过几次 DELETE。
 *
 * 模块级：两个入口（`revokeLiveScanSession` 读本机登记、`revokeCreatedScanSession`
 * 由创建方交凭证）共用同一份计数，所以同一个任务两条路径合起来也受同一个上限约束。
 */
const attemptsByTask = new Map<string, number>()

function revokeUrl(scanTaskId: string): string {
  return new URL(
    `${API_BASE_URL}/scan/sessions/${encodeURIComponent(scanTaskId)}`,
    window.location.origin,
  ).toString()
}

/**
 * 真正发出那一次 DELETE。去重、组头、keepalive、吞错都在这里，两个入口共用。
 *
 * @returns 是否真的发出了 DELETE（供调用方自测，不参与业务判断）。
 */
function sendRevoke(
  scanTaskId: string,
  controlToken: string,
  outgoingMemberToken: string | null | undefined,
  intent: ScanRevokeIntent,
): boolean {
  // 判据是「已经发了几次」对上「这一次的意图允许几次」，不是「发过没有」：
  // 清场那一次丢了而 ACK 随后成功的场景里，「发过没有」会把唯一一次补偿挡掉。
  const alreadySent = attemptsByTask.get(scanTaskId) ?? 0
  if (alreadySent >= REVOKE_ATTEMPT_CAP[intent]) return false
  // 登记在发请求之前：失败也不补发（撤销是尽力而为，不重试、不阻塞清场）。
  attemptsByTask.set(scanTaskId, alreadySent + 1)

  const headers = new Headers({
    Accept: 'application/json',
    'X-Scan-Session-Control': controlToken,
  })
  const terminalId = getTerminalId()
  if (terminalId) headers.set('X-Terminal-Id', terminalId)
  if (outgoingMemberToken) headers.set('Authorization', `Bearer ${outgoingMemberToken}`)

  try {
    void fetch(revokeUrl(scanTaskId), {
      method: 'DELETE',
      headers,
      credentials: 'include',
      // 页面正在被拆掉/重载：没有 keepalive 的请求会随文档一起被取消。
      keepalive: true,
      // 404 / 409 / 403 / 断网一律吞掉：清场不因为撤销失败而停下，
      // 也不向正在离开的用户报一个他无法处理的错误。
    }).catch(() => undefined)
  } catch {
    return false
  }
  return true
}

/**
 * 撤销本机当前登记的扫描任务（如果它还可能活着）。
 *
 * @param outgoingMemberToken 即将失效的会员令牌；游客为 null。
 * @returns 是否真的发出了 DELETE（供调用方自测，不参与业务判断）。
 */
export function revokeLiveScanSession(outgoingMemberToken: string | null | undefined): boolean {
  let live: ScanLiveState | undefined
  let hasResult = false
  try {
    const session = readScanWorkbenchSession()
    live = session?.live
    hasResult = session?.result !== undefined
  } catch {
    return false
  }
  if (!live) return false
  // 结果快照存在 = 服务端已经给过终态（completed / completed-no-file / failed / expired）。
  if (hasResult) return false
  // 本机已知过期：服务端的 reaper 会收掉它，这里再发 DELETE 只会拿回 404 / 400。
  if (!(Date.parse(live.expiresAt) > Date.now())) return false
  return sendRevoke(live.scanTaskId, live.controlToken, outgoingMemberToken, 'best-effort')
}

/**
 * 撤销一个**还没写进本机登记**的扫描任务。
 *
 * 创建请求在飞的那一刻被清场，是上面那条路径唯一够不着的情况：本机登记里还没有
 * live，`revokeLiveScanSession` 无从读起；等响应回来时登记已经被抹掉，再写回去就是
 * 把上一位的收件箱重新立起来。所以这条路径由**持有响应的那一方**直接交出凭证。
 *
 * 三点和上面一致，不再重复判断：
 * 1. 凭证是服务端刚刚回的，必然不是终态、也必然没过期 —— 不再查 hasResult / expiresAt；
 * 2. 身份必须是**发起创建的那一个**（服务端 `cancel()` 校验 `task.endUserId === endUserId`，
 *    换人之后用新身份发只会 403，旧任务原地存活），所以入参由调用方在创建时取好；
 * 3. 与 `revokeLiveScanSession` 共用同一份计数与同一套上限（{@link REVOKE_ATTEMPT_CAP}）。
 *
 * @param intent 默认 `'best-effort'`（和清场那条路径合起来只发一次）。只有
 *   「一次投递确认在用户离开之后才回来」那一支传 `'ack-compensation'`：那一刻
 *   任务可能刚刚变得可投递，而先前那次尽力而为的 DELETE 已知没有生效 ——
 *   必须允许再发一次，理由见 {@link REVOKE_ATTEMPT_CAP}。
 */
export function revokeCreatedScanSession(
  credentials: { scanTaskId: string; controlToken: string },
  creatingMemberToken: string | null | undefined,
  intent: ScanRevokeIntent = 'best-effort',
): boolean {
  return sendRevoke(credentials.scanTaskId, credentials.controlToken, creatingMemberToken, intent)
}
