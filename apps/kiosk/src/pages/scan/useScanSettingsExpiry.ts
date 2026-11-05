import { useEffect } from 'react'
import { formatCountdown } from './scanSettingsModel'
import type { ScanSettingsSession } from './useScanSettingsState'

/**
 * 设置页按服务端给的有效期走的倒计时，以及到点之后的处置（撤任务 + 换成「已过期」那一屏）。
 *
 * 2026-11-02 K1a 从 `ScanSettingsPage.tsx` 整段搬来（理由与分工见 `useScanSettingsState`）。
 * **只搬不改**。
 */
export function useScanSettingsExpiry(input: ScanSettingsSession): void {
  const {
    expiresAt,
    setCountdown,
    setFailure,
    setPhase,
    expiryHandledRef,
    createdIdRef,
    controlTokenRef,
    confirmedRef,
    cancelSessionOnce,
  } = input

  useEffect(() => {
    if (!expiresAt) return

    const tick = () => {
      setCountdown(formatCountdown(expiresAt))
      if (Date.parse(expiresAt) > Date.now() || expiryHandledRef.current) return
      expiryHandledRef.current = true
      if (createdIdRef.current && controlTokenRef.current && !confirmedRef.current) {
        cancelSessionOnce(createdIdRef.current, controlTokenRef.current)
      }
      setFailure({
        title: '这次扫描已过期',
        description: '这一次已超过系统给出的有效期，本页已停止继续操作。请返回扫描首页重新创建。',
      })
      setPhase('expired')
    }

    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
    // 取消函数依赖可变 token/ref，当前 effect 只应由服务端过期时间重建。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt])
}
