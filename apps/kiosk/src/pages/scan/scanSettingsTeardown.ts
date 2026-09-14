import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { ScanSessionCreateResponse } from '@ai-job-print/shared'
import { cancelScanSession } from '../../services/api/scanTasks'
import { scanCleanupInProgress } from './scanCleanupGate'
import type { ScanAckCredentials, ScanAckState } from './scanDeliveryAck'
import type { SessionFailure } from './scanRescanRecovery'
import type { SessionPhase } from './scanSettingsModel'
import { revokeCreatedScanSession, type ScanRevokeIntent } from './scanSessionRevoke'
import { patchScanWorkbenchSession } from './scanWorkbenchSession'

/**
 * 设置页「这一场到此为止」的四种收场。
 *
 * 搬出来的理由和 `scanSettingsModel` / `scanRescanRecovery` / `ScanSettingsStatusView`
 * 同一条：`ScanSettingsPage` 贴着 CLAUDE.md §8 的 800 行硬线。这一组和那几个不同的是
 * 它**有副作用**（发 DELETE、抹本机登记、改状态），所以不是纯函数，而是一个按
 * refs + setters 装配出来的闭包组 —— 判据一个字都没变，只是换了个文件放。
 *
 * 四条的分工必须分得清，混用任何两条都会留下真实后果：
 *   · `cancelSessionOnce` —— 页面还在，等得起一次 await（用户自己按的返回 / 过期）；
 *   · `abandonCreatedSession` —— 页面已经不在了（清场 / 卸载 / 终端 fail-closed），
 *     走不阻塞的撤销通道；
 *   · `discardCreatedSession` —— 会话建出来了但本机确定用不了，撤 + 抹 + 换结论屏；
 *   · `failClosedOnAckRefusal` —— 上一条加一位「服务端明确不认投递授权」。
 */

export interface ScanTeardownRefs {
  /** 这一场的 DELETE 只发一次的闸（`'ack-compensation'` 是唯一例外）。 */
  cancelRequestedRef: MutableRefObject<boolean>
  /** 发起创建那一刻取的身份快照。撤销、ACK 都用它，不用现取的 `getToken()`。 */
  createTokenRef: MutableRefObject<string | null>
  createdIdRef: MutableRefObject<string | null>
  controlTokenRef: MutableRefObject<string | null>
  ackRequestedForRef: MutableRefObject<string | null>
  sessionPromiseRef: MutableRefObject<Promise<ScanSessionCreateResponse> | null>
}

export interface ScanTeardownSetters {
  setScanTaskId: Dispatch<SetStateAction<string | null>>
  setControlToken: Dispatch<SetStateAction<string | null>>
  setInstructions: Dispatch<SetStateAction<string[] | null>>
  setExpiresAt: Dispatch<SetStateAction<string | null>>
  setAckState: Dispatch<SetStateAction<ScanAckState>>
  setAckRefused: Dispatch<SetStateAction<boolean>>
  setFailure: Dispatch<SetStateAction<SessionFailure | null>>
  setPhase: Dispatch<SetStateAction<SessionPhase>>
}

export interface ScanSessionTeardown {
  cancelSessionOnce: (id: string, controlToken: string) => void
  abandonCreatedSession: (
    credentials: { scanTaskId: string; controlToken: string },
    intent?: ScanRevokeIntent,
  ) => void
  discardCreatedSession: (credentials: ScanAckCredentials, reason: SessionFailure) => void
  failClosedOnAckRefusal: (credentials: ScanAckCredentials, ackFailure: SessionFailure) => void
}

export function createScanSessionTeardown(
  refs: ScanTeardownRefs,
  setters: ScanTeardownSetters,
): ScanSessionTeardown {
  /**
   * 页面还在时的正常取消。
   *
   * 身份用 `createTokenRef`（这一场建成时那个快照）而不是现取的 `getToken()`：
   * 服务端 `cancel()` 按 endUserId 校验，用户在这中间退出 / 换人之后现取只会 403 ——
   * 看起来撤了，其实那条任务原地存活。复水进来的那一场没走过创建，
   * 快照由设置页那个挂载 effect 补上。
   */
  const cancelSessionOnce = (id: string, controlToken: string): void => {
    if (refs.cancelRequestedRef.current) return
    refs.cancelRequestedRef.current = true
    void cancelScanSession(id, controlToken, refs.createTokenRef.current).catch(() => undefined)
  }

  /**
   * 丢弃一个刚建成、却已经没有人会使用的任务。
   *
   * 和 cancelSessionOnce 的分工：那条是**页面还在**时的正常取消（等得起一次 await）；
   * 这条发生在清场 / 卸载之后，页面随时可能被拆掉或整页重载，所以走 keepalive 的
   * 撤销通道，并且用**创建时**那个身份。
   * 共用 cancelRequestedRef：两条合起来对同一个任务只发一次 DELETE。
   *
   * @param intent `'ack-compensation'` 是这道去重**唯一**的例外，两层闸门一起放行
   *   （本页的 cancelRequestedRef 与 scanSessionRevoke 的按 id 计数）。
   *   只有「离开之后那次 ACK 才成功」那一支传它：那一刻服务端那条任务可能刚刚变得
   *   可投递，而先前那次撤销已知没有生效（生效了的话 ACK 只会拿回 409）——
   *   不放行就留下一个可投递却没人看着的收件箱，它连 60 秒未确认回收器都收不到。
   *   完整理由见 scanSessionRevoke 的 REVOKE_ATTEMPT_CAP。
   */
  const abandonCreatedSession = (
    credentials: { scanTaskId: string; controlToken: string },
    intent: ScanRevokeIntent = 'best-effort',
  ): void => {
    if (refs.cancelRequestedRef.current && intent !== 'ack-compensation') return
    refs.cancelRequestedRef.current = true
    /* 清场收尾正在进行：这一场已经归 scanCleanupGate 管了 —— 那次创建在发出时就把
     * promise 连同身份快照交给了它（trackScanSessionCreation），本机登记里的 live
     * 也在清场那一刻被它接手。那条闸会一直重试到服务端**回话确认**为止，
     * 而这里能做的只有再发一次拿不到回执的 keepalive：既证明不了什么，
     * 也可能和闸里的请求赛跑。所以交出去就不重复发。 */
    if (scanCleanupInProgress()) return
    revokeCreatedScanSession(credentials, refs.createTokenRef.current, intent)
  }

  /**
   * 丢弃一个刚建成、但本机已经确定用不了的会话：撤服务端任务 → 抹本机登记
   * （`live: undefined` 同时推进代次）→ 清空本页凭据并**放开撤销闸**（那次 DELETE
   * 已发出、id 也已抹掉，不放开的话用户重开的下一场就永远撤不掉）→ 换结论屏。
   *
   * 两处调用（服务端不给投递授权 / 凭据没能落进登记）成因不同、结论屏不同，这四件事
   * 一件都不能少：只抹本机不撤服务端，那条任务会占住终端的活动会话；只撤服务端不抹
   * 本机，看门狗整页重载之后这一场会被复水成「有会话」。
   */
  const discardCreatedSession = (
    credentials: ScanAckCredentials,
    reason: SessionFailure,
  ): void => {
    abandonCreatedSession(credentials)
    patchScanWorkbenchSession({ stage: 'settings', live: undefined })
    refs.createdIdRef.current = null
    refs.controlTokenRef.current = null
    refs.ackRequestedForRef.current = null
    refs.cancelRequestedRef.current = false
    refs.sessionPromiseRef.current = null
    setters.setScanTaskId(null)
    setters.setControlToken(null)
    setters.setInstructions(null)
    setters.setExpiresAt(null)
    setters.setAckState('idle')
    setters.setFailure(reason)
    setters.setPhase('error')
  }

  /** 服务端明确不认这一场的投递授权。哪些码算「明确不认」见 scanDeliveryAck。 */
  const failClosedOnAckRefusal = (
    credentials: ScanAckCredentials,
    ackFailure: SessionFailure,
  ): void => {
    discardCreatedSession(credentials, ackFailure)
    setters.setAckRefused(true)
  }

  return {
    cancelSessionOnce,
    abandonCreatedSession,
    discardCreatedSession,
    failClosedOnAckRefusal,
  }
}
