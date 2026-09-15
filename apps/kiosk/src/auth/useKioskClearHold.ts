import { useCallback, useEffect, useRef, useState } from 'react'
import {
  scanCleanupStatus,
  subscribeScanCleanup,
  whenScanCleanupSettled,
  type ScanCleanupStatus,
} from '../pages/scan/scanCleanupGate'

/**
 * 「清完本机之后，什么时候才允许把机器交给下一位」。
 *
 * 清场链路的最后一步是整页重载（或进屏保）。那一步会把本页所有还在飞的补偿逻辑
 * 连同执行环境一起干掉 —— 包括「投递确认回来之后补一次撤销」。于是一次在路上丢了的
 * DELETE 加上一次随后成功的 ACK，就会在服务端留下一条可投递、却没有任何界面在看着的
 * 扫描任务（完整成因见 scanCleanupGate）。
 *
 * 所以这一步不能无条件执行，只能**登记一个意图**：等服务端把话说完再跑。
 * `hold(run)` 就是那个登记 —— 收尾已经结束时它**同步**执行 `run()`
 * （没有扫描会话的那条最常见路径上，时序和这条闸出现之前一模一样）。
 *
 * 单独抽成一个 hook 而不是塞进 KioskPrivacyGuard：那个文件已经 660 多行，
 * 贴着 CLAUDE.md §8 的 800 行硬线。
 */
export function useKioskClearHold(): {
  /** 供遮罩如实显示「还在等什么、试了几次、最迟等到什么时候」。 */
  cleanup: ScanCleanupStatus
  /** 登记「收完尾就跑这一步」。已经收完时同步执行。 */
  hold: (run: () => void) => void
} {
  const [cleanup, setCleanup] = useState<ScanCleanupStatus>(scanCleanupStatus)
  const disposeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    // 订阅先于读一次：闸在这两句之间收完尾时，下面这次读会补上那个结果，
    // 不会停在一个永远不再变化的旧快照上。
    const unsubscribe = subscribeScanCleanup(() => setCleanup(scanCleanupStatus()))
    setCleanup(scanCleanupStatus())
    return () => {
      unsubscribe()
      disposeRef.current?.()
      disposeRef.current = null
    }
  }, [])

  const hold = useCallback((run: () => void) => {
    // 一次清场只登记一个出口：屏保那条路径上 clearToScreensaver 可能在等待期间
    // 转成 hardClear，后登记的那个才是真正要走的落点。
    disposeRef.current?.()
    disposeRef.current = whenScanCleanupSettled(run)
  }, [])

  return { cleanup, hold }
}
