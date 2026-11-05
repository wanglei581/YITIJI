import { useEffect } from 'react'
import { acknowledgeScanDelivery, type ScanAckCredentials } from './scanDeliveryAck'
import { scanLifecycleGeneration } from './scanWorkbenchSession'
import type { ScanSettingsSession } from './useScanSettingsState'

/**
 * 设置页的投递确认（ACK）effect。
 *
 * 2026-11-02 K1a 从 `ScanSettingsPage.tsx` 整段搬来（理由与分工见 `useScanSettingsState`）。
 * **只搬不改**，注释、顺序、判据都是拆分前的原文。
 *
 * 为什么没有和 `ScanProgressPage` 里那一段合并成一个共用 hook：两段只有骨架相像，
 * 几处决定行为的地方都不一样，合成一个就得带七个回调，比两段各自读更难读，
 * 还会让两条各自要紧的安全路径多一层别人看不见的间接：
 *   · 凭据来源 —— 这里读 `createdIdRef` / `controlTokenRef`（缺一个就不发），
 *     等待页读 props 里的 `scanTaskId` / `controlToken`；
 *   · 身份 —— 这里用 `createTokenRef`（建这一场时的快照），等待页现取 `getToken()`；
 *   · 生命周期闸 —— 这里是「代次变 或 本页已卸载」，等待页只看代次；
 *   · 补偿撤销 —— 这里走 `abandonCreatedSession`（带本页去重与清场交接判断），
 *     等待页直接调 `revokeCreatedScanSession`；
 *   · 三种结论的处置 —— 成功时这里还要 `setFailure(null)`；明确拒绝时这里是撤+抹+换结论屏+立 `ackRefused`，
 *     等待页是落一个失败结果并本机放弃；不确定时这里还要写 `failure`；
 *   · 依赖 —— 这里只有 `[ackState]`，等待页还带任务身份两项。
 */
export function useScanSettingsDeliveryAck(input: ScanSettingsSession): void {
  const {
    ackState,
    setAckState,
    setFailure,
    createdIdRef,
    controlTokenRef,
    createTokenRef,
    unmountedRef,
    abandonCreatedSession,
    failClosedOnAckRefusal,
  } = input

  /**
   * 投递确认（ACK）：唯一一处让这一场在服务端变得可投递的地方（见 scanDeliveryAck）。
   *
   * 三条路汇到这同一段：新建成功、重放领回来的 child、以及**复水**（整页重载 / 从别处
   * 回到本阶段）。复水那一条本机并不知道当初确认过没有，而 ACK 幂等，所以再问一次
   * 永远是对的，猜「应该确认过了」才是错的。
   *
   * 生命周期闸门与创建那一段同一副判据（代次 / 卸载），但后果更重：ACK 成功那一刻
   * 任务**已经可投递**，用户若已经走了或清过场，它就是一个没人看着的收件箱 ——
   * 所以那一支必须撤，且绝不许写回状态。
   */
  useEffect(() => {
    if (ackState !== 'pending') return undefined
    const pendingScanTaskId = createdIdRef.current
    const pendingControlToken = controlTokenRef.current
    // 没有完整凭据就一个请求都不发：半对凭据发出去只会拿回 403，
    // 而那条 403 在屏幕上会被读成「服务端不认这一场」—— 把本机的缺失说成服务端的结论。
    if (!pendingScanTaskId || !pendingControlToken) return undefined
    const credentials: ScanAckCredentials = {
      scanTaskId: pendingScanTaskId,
      controlToken: pendingControlToken,
    }
    const ackGeneration = scanLifecycleGeneration()
    /* 身份用**这一场建成时**那份快照，不是现取。创建 effect 在发请求之前写下它，
     * 复水那一条由挂载 effect 补上，所以这里读到的永远是「建这一场的那个人」。
     * 现取的坏处不是理论上的：ACK 与撤销在服务端都按 endUserId 校验，用户中途退出
     * 或换人之后现取只会拿回 403，而页面会把那条 403 读成「服务端不认这一场」——
     * 把本机的身份漂移说成服务端的结论。 */
    const memberToken = createTokenRef.current
    let stale = false

    void acknowledgeScanDelivery(credentials, memberToken).then((outcome) => {
      if (scanLifecycleGeneration() !== ackGeneration || unmountedRef.current) {
        /* 用户走了 / 清场了 / 换人了。确认可能刚刚成功，也就是说服务端那条任务此刻
         * 可能已经可投递 —— 必须撤掉，并且一个字节都不许写回本机。
         *
         * 这一次是**补偿**，不是又一次尽力而为：离开那条路径（leaveScanFlow /
         * 清场）已经按本机登记发过一次 DELETE 了，按普通去重这里会被直接挡掉。
         * 而「ACK 成功」正是那一次 DELETE 没生效的证据（生效了服务端只会回 409），
         * 同时 deliveryAckedAt 已经非空 —— 60 秒未确认回收器再也收不到它，
         * 它会一直可投递到自然过期。所以这一次必须越过去重发出去。 */
        abandonCreatedSession(credentials, 'ack-compensation')
        return
      }
      if (stale) return
      if (outcome.ok) {
        setFailure(null)
        setAckState('acked')
        return
      }
      if (outcome.definitive) {
        failClosedOnAckRefusal(credentials, outcome.failure)
        return
      }
      // 断网 / 5xx / 429 / 终端票失效：任务仍然停在不可投递，没有人会收到那张纸。
      // 如实说还没确认，并保留重试；这一屏不许出现任何让用户去面板操作的话。
      setFailure(outcome.failure)
      setAckState('retryable')
    })

    return () => {
      stale = true
    }
    // 只由 ackState 驱动：'pending' 进来、拿到结论出去。用户按「再确认一次」时
    // handleAckRetry 把它打回 'pending'，这一段就再跑一次（服务端幂等）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ackState])
}
