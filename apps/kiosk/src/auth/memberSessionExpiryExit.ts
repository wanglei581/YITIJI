import { whenScanCleanupSettled } from '../pages/scan/scanCleanupGate'
import { isLoginPath, loginPathForCurrentLocation } from './returnPath'

/**
 * 会员会话失效（401）之后那一步「回登录页」。
 *
 * ## 它修的是哪一个缺陷（2026-09-15，P1）
 *
 * 401 这条路此前是这么走的：
 *
 *   `logout()`（内部 `clearKioskSensitiveSession` → `beginScanSessionCleanup`）
 *   → **同一句之后立刻** `window.location.assign('/login?from=…')`。
 *
 * `beginScanSessionCleanup` 只是把要撤的那一场**交给**收尾闸，撤销本身是异步的：
 * 闸会一直重发 DELETE，直到服务端亲口确认，或走到服务端给的那个自然过期时刻。
 * 紧接着的整页跳转把这段重试连同执行环境一起干掉，于是这条路退化成
 * `pagehide` 那一次 keepalive beacon —— 发一次，回执一律吞掉。
 *
 * 弱网丢包时它就漏：那一发 DELETE 丢了，而离开那一刻还在飞的**投递确认（ACK）
 * 成功了**。服务端于是留下一条 `deliveryAckedAt` 非空、状态仍是 waiting 的任务：
 * 60 秒未确认回收器收不到它（它已确认），Agent 的 current-lease 看得见它，
 * 它一直可投递到自然过期 —— 下一位走到面板前按下扫描，文件投给已经走掉的上一位。
 * 跨用户串件，和 scanCleanupGate 要堵的是同一个口子；这里只是把清场链路上
 * 最后一个绕过它的出口（401）也接回去。
 *
 * ## 改判据之后的顺序
 *
 * 1. **本机同步清干净**：PII、令牌、登录态在 `clearLocalSession()` 这一句里就没了，
 *    一个网络往返都不等。这一条不许变 —— 屏幕上那一位的东西不能因为网络坏了多留一秒。
 * 2. **跳转登记成意图**：交给 {@link whenScanCleanupSettled}。没有待清理扫描会话时
 *    它**同步**执行，时序和这条闸出现之前一模一样，一帧都不多等（绝大多数 401 走这条）；
 *    有待清理会话时，只有服务端确认那一场撤掉了、或它走到服务端给的自然过期时刻，
 *    才真的跳。5xx、断网、403 之后还没走完 fallback 的那几种，一律继续等。
 *
 * ## 为什么一定是「至多跳一次」
 *
 * 三个旗子各管一件事，都只活在这个闭包里，不进 URL / 存储 / history：
 *   · `armed` —— 这一次过期已经登记过出口了。重复 401、StrictMode 里重建的订阅
 *     都撞在它上面，不会重复清本机、也不会挂第二个回调；
 *   · `exited` —— 真的跳过一次了。它**不被 {@link MemberSessionExpiryExit.cancel}
 *     重置**，所以「跳完 → 卸载 → 又来一发 401」也跳不了第二次；
 *   · `dispose` —— 还没跑掉的那次登记。只有 {@link MemberSessionExpiryExit.cancel}
 *     解得掉它，而全仓只有 `login()` 调它：这一位换了一张有效令牌之后，再把他踢去
 *     登录页是纯粹的打扰。`logout()` 和 Provider 卸载**都不撤销** —— 撤销的结果是
 *     这一位既登不回去、也走不掉，停在一张过期的页面上。
 */
export interface MemberSessionExpiryExit {
  /**
   * 处理一次 401。
   *
   * @param clearLocalSession 同步清空本机会话（AuthProvider 传 `logout`）。
   *   必须同步：它是这条路上唯一不许等网络的一步。
   */
  expire: (clearLocalSession: () => void) => void
  /**
   * 作废还没跑掉的那次跳转，并解除武装，让下一次 401 能重新登记。
   *
   * **只有 `login()` 有资格调它**：这一位已经换了一张有效令牌，旧的那次过期跳转
   * 再执行就是把刚登进来的人踢出去。`logout()`（手工登出、隐私清场都走它）和
   * Provider 卸载一律不调 —— 已经登记的跳转是一条必须走完的承诺。
   */
  cancel: () => void
}

export function createMemberSessionExpiryExit(): MemberSessionExpiryExit {
  let armed = false
  let exited = false
  let dispose: (() => void) | null = null

  const cancel = (): void => {
    dispose?.()
    dispose = null
    armed = false
  }

  const expire = (clearLocalSession: () => void): void => {
    // 已经为这一次过期登记过出口：本机早就清干净了，再清一遍也没有新东西可清。
    if (armed) return
    const shouldRedirect =
      typeof window !== 'undefined' && !isLoginPath(window.location.pathname)
    // 先清本机，再谈跳转。顺序反过来就等于「网络说了算才敢清 PII」。
    clearLocalSession()
    if (!shouldRedirect || exited) return
    armed = true
    /* 目的地在**这一刻**定下来，不在跳转那一刻现算：等待期间页面并不导航，
     * 但这样写把「从哪儿过期的」钉死在事实发生的时点上，也不会因为等待中途
     * 有人改了地址栏而把人送去别处。只带路径，不带任何令牌 / 任务号 / PII。 */
    const loginPath = loginPathForCurrentLocation()
    dispose = whenScanCleanupSettled(() => {
      // cancel() 之后不许再跳：这一位可能已经重新登录，或清场链路自己接管了出口。
      if (!armed) return
      exited = true
      window.location.assign(loginPath)
    })
  }

  return { expire, cancel }
}
