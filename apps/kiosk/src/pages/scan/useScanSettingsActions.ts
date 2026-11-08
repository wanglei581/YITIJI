import { useNavigate } from 'react-router-dom'
import { type ScanType } from './scanWorkbench'
import { type ScanStage } from './scanWorkbenchModel'
import {
  beginPlainScanRestart,
  patchScanWorkbenchSession,
  type ScanWorkbenchSession,
} from './scanWorkbenchSession'
import type { ScanSettingsSession } from './useScanSettingsState'

/**
 * 设置页的六个按钮处理函数：安全返回、重新开始一次扫描、静默期结束后重试、
 * 再确认一次、再试一次安全重扫、我已操作开始等待。
 *
 * 2026-11-02 K1a 从 `ScanSettingsPage.tsx` 整段搬来（理由与分工见 `useScanSettingsState`）。
 * **只搬不改**：每个函数的注释（它们各自解释了为什么要置空 `sessionPromiseRef`、为什么不碰
 * `armedAtMs`、为什么 `rescanIntentRef` 保持 true）、顺序、判据都是拆分前的原文。
 * 路由跳转和阶段回调也留在这里，页面本身不再调 `navigate`。
 */
export function useScanSettingsActions(
  input: ScanSettingsSession & {
    scanType: ScanType | null
    stored: ScanWorkbenchSession | null
    onGoStage?: (stage: ScanStage) => void
  },
) {
  const navigate = useNavigate()
  const {
    scanType,
    stored,
    onGoStage,
    ackState,
    scanTaskId,
    controlToken,
    instructions,
    expiresAt,
    starting,
    setStarting,
    quietPeriodRemaining,
    setQuietPeriodBlocked,
    setRescanCredentialsLost,
    setRescanRefusedByServer,
    setRescanRetryable,
    setPlainRestartChosen,
    setReplayingLostCreate,
    setAckRefused,
    setAckState,
    setFailure,
    setPhase,
    confirmedRef,
    createdIdRef,
    controlTokenRef,
    rescanIntentRef,
    sessionPromiseRef,
    cancelSessionOnce,
  } = input

  const handleSafeReturn = () => {
    if (createdIdRef.current && controlTokenRef.current && !confirmedRef.current) {
      cancelSessionOnce(createdIdRef.current, controlTokenRef.current)
    }
    // live: undefined 同时是「这一场到此为止」的宣告（代次 +1）：
    // 创建请求还在飞的时候点返回，响应回来会因为代次对不上而自己把任务撤掉。
    patchScanWorkbenchSession({ stage: 'start', live: undefined, result: undefined })
    if (onGoStage) {
      onGoStage('start')
      return
    }
    navigate('/scan?stage=start')
  }

  /**
   * fail-closed 两屏共用的出路：用户显式选择「重新开始一次扫描」。
   *
   * 覆盖两种成因 —— 本机取不到凭据（`rescanCredentialsLost`，含整页重载与延迟取用）
   * 和服务端不认（`rescanRefusedByServer`）。两屏的正文各说各的成因，出路只有这一个。
   * 这一条不是降级的捷径：文案已经说清它不是安全同字节重扫，按下它是用户的选择。
   *
   * 四件事缺一不可：
   *   1. `beginPlainScanRestart` 抹掉登记里那笔安全重扫意图（也顺手清空授权槽位）；
   *   2. `rescanIntentRef` 跟着变 false —— 否则上面那道延迟取用闸门会把这一次
   *      **用户亲手选的**普通创建当成「意图还在却没凭据」再判一次 fail-closed，
   *      按钮按下去什么都不会发生；
   *   3. `sessionPromiseRef.current = null` —— 服务端拒绝那条路径上它握着一个**已经
   *      reject 的 promise**。不置空的话 effect 重跑只会给那个 rejection 再挂一遍
   *      then/catch，新的 POST 永远发不出去，页面停在 loading。
   *      （凭据丢失那条路径上它本来就是 null，正是这个差别让人容易漏掉这一行。）
   *   4. 两个 fail-closed 标志都复位，effect 依赖随之变化并重跑。
   */
  const handlePlainRestart = () => {
    if (!scanType) return
    beginPlainScanRestart({ scanType, extras: stored?.extras })
    rescanIntentRef.current = false
    sessionPromiseRef.current = null
    setRescanCredentialsLost(false)
    setRescanRefusedByServer(false)
    // 用户选的是普通会话：那颗「再试一次安全重扫」必须一起下台，
    // 否则这一屏会同时挂着两个互相矛盾的主行动。
    setRescanRetryable(false)
    setPlainRestartChosen(true)
    // 这一次是用户新选的普通会话：上一次那场重放的进度不许留在等待屏上。
    setReplayingLostCreate(false)
    // 投递授权那条 fail-closed 也要一起复位（它是这一屏的第三种成因）：
    // 不复位的话，创建 effect 会在 `if (ackRefused) return` 处早退，按钮按下去毫无反应。
    setAckRefused(false)
    setAckState('idle')
    setFailure(null)
    setPhase('loading')
  }

  const handleQuietPeriodRetry = () => {
    if (!scanType || quietPeriodRemaining > 0) return
    sessionPromiseRef.current = null
    setQuietPeriodBlocked(false)
    setFailure(null)
    setPhase('loading')
  }

  /**
   * 「再确认一次」——把那一次投递确认原样重发。
   *
   * 只对**不确定**的失败出现（断网 / 5xx / 429 / 终端票失效）：那时任务仍停在
   * 不可投递，谁都收不到那张纸，重发一次是安全的，而且服务端对已确认的会话幂等。
   * 服务端明确拒绝的那一支走 failClosedOnAckRefusal，不会走到这里。
   */
  const handleAckRetry = () => {
    if (ackState !== 'retryable') return
    setFailure(null)
    setAckState('pending')
  }

  /**
   * 「再试一次安全重扫」——把刚被原样放回的那枚授权再发一次，**仍然成对**，不降级。
   *
   * 置空 sessionPromiseRef 与「复位标志让 effect 重跑」两件事的理由同 handlePlainRestart。
   * 差别只在两处，而它们正是这条存在的全部意义：
   *   · `rescanIntentRef` 保持 true —— 这仍然是一次「同一份材料」，万一取用时授权已经
   *     过期，延迟取用闸门必须照旧 fail-closed，而不是放一个无签名的普通创建出去；
   *   · 不碰 armedAtMs —— 有效期始终从上一场铸出来那一刻算起，点几次都不会延长。
   */
  const handleRescanRetry = () => {
    if (!scanType) return
    sessionPromiseRef.current = null
    setRescanRetryable(false)
    // 新一轮请求从「还没开始重放」起算；上一轮的进度不许挂在这一轮的等待屏上。
    setReplayingLostCreate(false)
    setFailure(null)
    setPhase('loading')
  }

  const handleConfirm = () => {
    if (!scanType || !scanTaskId || !controlToken || starting) return
    confirmedRef.current = true
    setStarting(true)
    patchScanWorkbenchSession({
      stage: 'progress',
      scanType,
      live: {
        scanTaskId,
        controlToken,
        instructions: instructions ?? [],
        expiresAt: expiresAt ?? new Date().toISOString(),
      },
    })
    if (onGoStage) {
      onGoStage('progress')
      return
    }
    navigate('/scan?stage=progress', { state: { scanTaskId, scanType, controlToken } })
  }

  return {
    handleSafeReturn,
    handlePlainRestart,
    handleQuietPeriodRetry,
    handleAckRetry,
    handleRescanRetry,
    handleConfirm,
  }
}
