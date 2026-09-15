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

/* ══ 以下是「等服务端把话说完」的那一条撤销通道（2026-09-15 P1） ════════════════
 *
 * 上面那套是 fire-and-forget：发出去就算，回执一律吞掉。它对**页面还活着**的离开
 * （leaveScanFlow / 结果页出口）是对的 —— 那一刻还有人在看着，ACK 补偿也还跑得动。
 *
 * 但清场（隐私空闲 / 屏保 / 退出 / 换人）不一样：它的最后一步是整页重载，
 * 而重载会把「ACK 回来之后补一次撤销」那段代码连同执行环境一起干掉。于是
 *   ① 离开时发的 DELETE 在路上丢了（本机永远不会知道，因为回执被吞了）；
 *   ② 还在飞的那次 ACK 随后成功了；
 *   ③ 重载把补偿代码杀了；
 * 三件事一撞，服务端就留下一条 `deliveryAckedAt` 非空、状态仍是 waiting 的任务：
 * 60 秒未确认回收器收不到它（它已确认），而 Agent 的 current-lease 看得见它
 * （`deliveryAckedAt: { not: null }`，scan-tasks.service.ts 的 getScanDeliveryLease）。
 * 它会一直可投递到自然过期 —— 下一位在面板上按下扫描，文件投给已经走掉的上一位。
 *
 * 所以清场这条路上撤销必须**等服务端回话**，并且在拿到确认之前不许重载。
 * 这里只负责发一次并把回答翻译成「确认了没有」；等待、退避、上限、界面归
 * `scanCleanupGate.ts` 管。
 */

/**
 * 一次「等回话」的撤销的结论。
 *
 * `confirmed: true` 的三种理由，判据都来自 scan-tasks.service.ts 的 `cancel()`
 * 与 `getScanDeliveryLease()`，共同点是**这条任务此后不可能再被 Agent 领走**：
 *   · `cancelled` —— 200，服务端刚把它 CAS 成 cancelled；
 *   · `not-found` —— 404 `SCAN_TASK_NOT_FOUND`，服务端那边根本没有这条任务；
 *   · `already-terminal` —— 400 `SCAN_TASK_ALREADY_COMPLETED` 或 409
 *     `SCAN_TASK_CANCEL_CONFLICT`。后者的判据是 `status !== 'waiting' && !== 'matched'`，
 *     也就是它已经是 cancelled / failed / expired / completed 之一。租约查询只签
 *     `status: 'waiting'` 的行，所以这几种一律领不走。
 *
 * `confirmed: false` 的三种，一种都不许当成「清干净了」：
 *   · `forbidden` —— 403，本机手里这份身份/凭据动不了那条任务（它可能仍是 waiting）；
 *   · `server-error` —— 5xx / 429 / 其它非终态码，服务端没给结论；
 *   · `unreachable` —— 请求压根没拿到应答（断网、被掐断）。
 */
export type ScanRevokeVerdict =
  | { confirmed: true; reason: 'cancelled' | 'not-found' | 'already-terminal' }
  | { confirmed: false; reason: 'forbidden' | 'server-error' | 'unreachable' }

/** 服务端明确说「这条任务已经不可能被领走了」的两个码。 */
const TERMINAL_CANCEL_CODES = new Set(['SCAN_TASK_ALREADY_COMPLETED', 'SCAN_TASK_CANCEL_CONFLICT'])

async function readErrorCode(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { code?: unknown } } | null
    const code = body?.error?.code
    return typeof code === 'string' ? code : ''
  } catch {
    // 非 JSON（网关的 HTML 错误页之类）：当作「服务端没给结论」，由调用方继续重试。
    return ''
  }
}

function revokeHeaders(controlToken: string, identityToken: string | null): Headers {
  const headers = new Headers({
    Accept: 'application/json',
    'X-Scan-Session-Control': controlToken,
  })
  const terminalId = getTerminalId()
  if (terminalId) headers.set('X-Terminal-Id', terminalId)
  if (identityToken) headers.set('Authorization', `Bearer ${identityToken}`)
  return headers
}

/**
 * 发一次 DELETE 并**等服务端回话**，把回答翻译成 {@link ScanRevokeVerdict}。
 *
 * 三点和上面那条 fire-and-forget 通道刻意不同，每一点都是这条路径的必需：
 *   1. **不带 keepalive**。keepalive 的意义是「文档正在被拆掉也要把请求送出去」，
 *      而这条路径的全部前提恰恰是**先别拆文档**；keepalive 请求还受额外配额限制，
 *      拿回执反而更不可靠。
 *   2. **不走 `scanTasks.ts` 的 `requestJson`**。那条通道带 `notifySessionIfInvalid`：
 *      用一个刚失效的会员令牌发请求拿回 401 时，它会广播「会员会话过期」，
 *      而 AuthContext 的处置是 `window.location.assign(...)` —— 一次硬跳转，
 *      正好把这里等着的清理连同执行环境一起杀掉。清场路径不能踩这颗雷。
 *   3. **不参与 {@link REVOKE_ATTEMPT_CAP} 的按次上限**。那道上限是为「尽力而为、
 *      不重试」设的；这条路径的职责相反 —— 重试到服务端给出确认为止，
 *      次数由 scanCleanupGate 按退避表与服务端给的自然过期时刻收口。
 *
 * @param identityToken 发起这一场的那个会员令牌（游客 / 已登出为 null）。
 *   服务端 `cancel()` 对 `endUserId === null` 的调用方只校验 controlToken —— 那是它
 *   刻意为「登出之后仍要撤得掉」留的路（见 scan-tasks.service.ts 里那段注释），
 *   所以传 null 是合法调用，不是绕过校验。
 */
export async function requestConfirmedScanRevoke(
  credentials: { scanTaskId: string; controlToken: string },
  identityToken: string | null,
): Promise<ScanRevokeVerdict> {
  let res: Response
  try {
    res = await fetch(revokeUrl(credentials.scanTaskId), {
      method: 'DELETE',
      headers: revokeHeaders(credentials.controlToken, identityToken),
      credentials: 'include',
    })
  } catch {
    return { confirmed: false, reason: 'unreachable' }
  }

  if (res.ok) return { confirmed: true, reason: 'cancelled' }
  const code = await readErrorCode(res)
  if (res.status === 404 || code === 'SCAN_TASK_NOT_FOUND') {
    return { confirmed: true, reason: 'not-found' }
  }
  if (TERMINAL_CANCEL_CODES.has(code)) return { confirmed: true, reason: 'already-terminal' }
  if (res.status === 403 || code === 'SCAN_TASK_FORBIDDEN') {
    return { confirmed: false, reason: 'forbidden' }
  }
  return { confirmed: false, reason: 'server-error' }
}

/**
 * 文档真的要走了（`pagehide`）时的最后一发。
 *
 * 只在这一种时刻用：浏览器被关掉、一体机被拔电、Kiosk 外壳自己重启 —— 那一刻没有
 * 任何界面能再等回执，keepalive 是唯一还有机会送达的形式。它**不是**清场路径的
 * 正常出口（正常出口是上面那条等回话的通道），所以刻意不参与按次上限：
 * 文档都要没了，「别刷请求」这条顾虑不成立，而漏发一次的代价是一条可投递的孤儿任务。
 */
export function sendUnloadRevokeBeacon(
  credentials: { scanTaskId: string; controlToken: string },
  identityToken: string | null,
): void {
  try {
    void fetch(revokeUrl(credentials.scanTaskId), {
      method: 'DELETE',
      headers: revokeHeaders(credentials.controlToken, identityToken),
      credentials: 'include',
      keepalive: true,
    }).catch(() => undefined)
  } catch {
    /* 文档正在消失，这里没有第二条出路，也没有人能看见错误。 */
  }
}
