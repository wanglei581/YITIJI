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
 * 2. **只发一次，不重试，不阻塞**。这条路径全部发生在页面正在被拆掉的那一刻
 *    （clearing 遮罩、logout、整页 reload）。keepalive 让请求在文档卸载后仍能送达；
 *    任何重试或等待都可能把清场卡住，而清场比撤销更要紧。
 * 3. **已是终态就不发**。completed / failed / cancelled / expired 的任务再 DELETE，
 *    只会换回 400 SCAN_TASK_ALREADY_COMPLETED 或 404，白白制造一次噪音请求。
 */

/**
 * 已经尝试过撤销的 scanTaskId。
 *
 * 模块级：一次页面生命周期内每个任务最多发一次 DELETE。同一次清场往往会连着触发
 * 好几条链路（KioskPrivacyGuard.hardClear → logout → clearKioskSensitiveSession），
 * 没有这道去重就会对同一个任务发三次。
 */
const attempted = new Set<string>()

function revokeUrl(scanTaskId: string): string {
  return new URL(
    `${API_BASE_URL}/scan/sessions/${encodeURIComponent(scanTaskId)}`,
    window.location.origin,
  ).toString()
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
  if (attempted.has(live.scanTaskId)) return false
  attempted.add(live.scanTaskId)

  const headers = new Headers({
    Accept: 'application/json',
    'X-Scan-Session-Control': live.controlToken,
  })
  const terminalId = getTerminalId()
  if (terminalId) headers.set('X-Terminal-Id', terminalId)
  if (outgoingMemberToken) headers.set('Authorization', `Bearer ${outgoingMemberToken}`)

  try {
    void fetch(revokeUrl(live.scanTaskId), {
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
