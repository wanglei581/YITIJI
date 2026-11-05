import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { type ScanType } from './scanWorkbench'
import { type ScanStage } from './scanWorkbenchModel'
import {
  armScanRescanAuthority,
  beginPlainScanRestart,
  beginScanRescan,
  clearScanRescanAuthority,
  hasScanRescanAuthority,
  type ScanOutcome,
} from './scanWorkbenchSession'
import type { ScanResultState } from './scanResultModel'

const CONTROL_FIELDS = new Set(['success', 'reason', 'simulateFailure', 'failReason', 'file', 'outcome'])

/**
 * 多久重问一次「现在还有没有可用的重扫凭据」。
 *
 * 只影响按钮上那句话什么时候改口，不参与任何放行判断（放行由点击那一刻的
 * `beginScanRescan` 和服务端说了算）。取 5 秒：本地有效期是 15 分钟，
 * 用户在这一屏读完两段话再抬手也不止 5 秒，误导窗口足够小；再密就是白烧一体机的 CPU。
 */
const RESCAN_AUTHORITY_RECHECK_MS = 5_000

/**
 * 结果页的「安全重扫」授权：登记、隔几秒重问、点「重试扫描」时的取用与跳转，以及
 * 「重新开始一次扫描」这条普通新会话的入口。
 *
 * 2026-11-02 K1a 从 `ScanResultPage.tsx` 整段搬来（理由：页面 512 行，往里再加屏上扫描的结果之前先按职责拆开）。
 * **只搬不改**：判据、顺序、注释都是拆分前的原文，`navigate` 仍然只有 `goToSettings` 里
 * 非工作台兜底那一处（门禁按整组结果页文件数，总共只许两处：这一处和出口 hook 里的 `leaveScanFlow`）。
 */
export function useScanResultRescan(input: {
  state: ScanResultState
  scanType: ScanType
  outcome: ScanOutcome
  priorScanTaskId: string | null
  priorControlToken: string | null
  onGoStage?: (stage: ScanStage) => void
}) {
  const navigate = useNavigate()
  const { state, scanType, outcome, priorScanTaskId, priorControlToken, onGoStage } = input
  const [rescanAuthorized, setRescanAuthorized] = useState(false)
  // 用户按过「重试扫描（同一份材料）」，而那一刻已经没有可用的成对授权了。
  // 只用于**把这件事说出来**：本页没有替他改发普通重扫，出路是他自己按的那一个。
  const [safeRescanLost, setSafeRescanLost] = useState(false)

  /**
   * 登记这一场可能存在的重扫授权。幂等（同一场不会重新计时），所以可以被调用两次：
   * 一次在下面的 effect 里（决定按钮说什么），一次在点击那一刻（首屏那一帧 effect
   * 还没跑，而按钮已经可以点了 —— 少了那一次，快点两下就会落进「没有授权」分支）。
   */
  const armIfPossible = useCallback((): boolean => {
    if (outcome !== 'failed' && outcome !== 'expired') return false
    if (!priorScanTaskId || !priorControlToken) return false
    return armScanRescanAuthority({ priorScanTaskId, priorControlToken, scanType })
  }, [outcome, priorScanTaskId, priorControlToken, scanType])

  /* ── 这一场结束了：要不要留一枚安全重扫授权 ────────────────────────────
   *
   * 服务端只在任务**已经取到文件**（matched，内容 hash 已落 lastAttemptHash）之后
   * 才落到 failed / cancelled / expired 的那几条路径上铸授权。前端能看见的对应终态
   * 就是 failed 和 expired —— 只有这两种登记。
   *
   * 另外两种终态必须**反过来**：completed 和「完成但没带文件」的任务服务端已经建了档
   * （fileId 非空），按契约根本不会有授权，所以这里显式扔掉。
   *
   * 说清这一句的性质，免得下一个人误判它的分量：它是**纵深**，不是当前唯一的防线。
   * 今天走到成功终态之前必然先经过一次创建，而创建那一步是一次性取用
   * （`takeScanRescanAuthority`），槽位那时已经空了；离开这一屏的几个出口也各自
   * 清场。它守的是那些前提被改坏的将来 —— 比如 `deriveOutcome` 的兜底分支被调整、
   * 或者哪天成功终态不再必须经过一次创建。
   *
   * 登记本身不代表授权真的存在（本机看不见服务端有没有铸）。它只是「可以去取用一次」，
   * 取不取得到由服务端 403 说了算，页面不替它下结论。 */
  useEffect(() => {
    if (outcome !== 'failed' && outcome !== 'expired') {
      clearScanRescanAuthority()
      setRescanAuthorized(false)
      return undefined
    }
    armIfPossible()
    setRescanAuthorized(hasScanRescanAuthority(scanType))
    /* 本地有效期会走完（15 分钟，与服务端同一个值），清场也可能在别处发生。
     * 不重新采样的话，按钮会一直挂着「（同一份材料）」那句话 —— 用户照着它把同一张纸
     * 放回去，而那一刻本机其实已经没有可用凭据了。所以隔几秒重问一次：
     * 这是「状态不许误导」的那一半，另一半是点击时再验一遍（handleRetry）。 */
    const timer = window.setInterval(() => {
      setRescanAuthorized(hasScanRescanAuthority(scanType))
    }, RESCAN_AUTHORITY_RECHECK_MS)
    return () => window.clearInterval(timer)
  }, [armIfPossible, outcome, scanType])

  const retryExtras = {
    source: state.source,
    pageMode: state.pageMode,
    color: state.color,
    dpi: state.dpi,
  }
  /** 带去设置页的路由 state：只有扫描参数，控制字段（凭证 / 结果）一律剥掉。 */
  const retryState = Object.fromEntries(
    Object.entries(state).filter(([k]) => !CONTROL_FIELDS.has(k)),
  )

  const goToSettings = () => {
    if (onGoStage) {
      onGoStage('settings')
      return
    }
    navigate('/scan?stage=settings', { state: retryState })
  }

  /**
   * 「重试扫描（同一份材料）」。**只有安全重扫这一条路**，拿不到授权就不走。
   *
   * 三件事按序：
   *   1. 幂等再登记一次 —— 补上首屏那一帧 effect 还没跑完的窗口；
   *   2. `beginScanRescan` 判有没有可用的成对授权：没有就**什么都不动**（不销毁
   *      本机那份 live/结果快照，也不跳页），返回 false；
   *   3. 只有拿到了才跳设置页 —— 那边取用一次，body 的 id 与重扫头成对发出。
   *
   * 忽略第 2 步的返回值就是这次修的缺陷：跳过去之后设置页照样会建会话，而手里没有
   * 授权，发出去的是一个**普通**创建。用户按的是「同一份材料」，随后把同一张纸放回
   * 面板，服务端按两小时同字节去重把文件拒掉，任务停在 waiting 直到过期 ——
   * 人在机器前白等十分钟，屏幕上全程没有一句话解释。
   */
  const handleRetry = () => {
    armIfPossible()
    if (!beginScanRescan({ scanType, extras: retryExtras })) {
      setSafeRescanLost(true)
      setRescanAuthorized(false)
      return
    }
    setSafeRescanLost(false)
    goToSettings()
  }

  /**
   * 「重新开始一次扫描」——用户显式选择的普通新会话，**不是**安全同字节重扫。
   *
   * 成功页上的「重新扫描」走的也是这一条：上一场已经建档，服务端那条去重管的是
   * 「取过件但没建档成功」的字节，所以那里本来就没有安全重扫可言。
   */
  const handlePlainRestart = () => {
    beginPlainScanRestart({ scanType, extras: retryExtras })
    goToSettings()
  }

  return { rescanAuthorized, safeRescanLost, handleRetry, handlePlainRestart }
}
