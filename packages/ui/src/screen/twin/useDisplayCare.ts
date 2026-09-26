import { useEffect, useState } from 'react'

/**
 * 展示档（新窗口挂在展厅大屏上无人值守）的两件保养：防烧屏的整屏微移、每天凌晨重载一次。
 * 两端大屏共用；桌面档不启用。
 */

/** 防烧屏：每 4 分钟把整屏挪几个像素，一小时回到原位。 */
const DRIFT = [
  [0, 0],
  [3, 2],
  [-2, 3],
  [2, -3],
  [-3, -2],
] as const

export function useTwinBurnInDrift(enabled: boolean): readonly [number, number] {
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (!enabled) return
    const timer = window.setInterval(() => setStep((s) => (s + 1) % DRIFT.length), 4 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [enabled])
  return DRIFT[step]
}

/** 每天凌晨 3 点（上海时间）重新加载一次，释放长时间运行积累的内存；断网时不重载，由轮询横幅说明。 */
export function useTwinNightlyReload(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const openedAt = Date.now()
    const timer = window.setInterval(() => {
      const hour = Number(
        new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false }).format(new Date()),
      )
      if (hour === 3 && Date.now() - openedAt > 60 * 60 * 1000 && navigator.onLine) window.location.reload()
    }, 5 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [enabled])
}
