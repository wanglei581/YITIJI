// 一体机首页「免费使用」和页脚收费句。这一段只接线，判定在 reader。
//
// 开关开着，并且本机 pricing 五个生效价都读到、且都是 0，角标才为 true。
// 任一价大于 0、价读不齐、本机配置读不到或没有这一项，角标一律 false。
// 旧接口没下发 homeFreeBadge 时按关，不当成开。
// 是否收费和角标来自同一轮配置。配置按 REFRESH_MS 重读。新一轮两个都先不显示。
// 30 秒没回来、终端号变了、重读失败，都不沿用上一轮。

import { useEffect, useState } from 'react'
import { startKioskHomeFreeBadgePolling } from './kioskHomeFreeBadgeReader'

export { kioskHomeFreeBadgeVisible, REFRESH_MS, startKioskHomeFreeBadgePolling } from './kioskHomeFreeBadgeReader'
export type { KioskHomeFreeBadgeInput } from './kioskHomeFreeBadgeReader'

export interface KioskHomePriceSnapshot {
  badge: boolean
  charged: boolean
}

export function useKioskHomePriceSnapshot(): KioskHomePriceSnapshot {
  const [snapshot, setSnapshot] = useState<KioskHomePriceSnapshot>({ badge: false, charged: false })

  useEffect(() => startKioskHomeFreeBadgePolling((badge, charged = false) => {
    setSnapshot({ badge, charged })
  }), [])

  return snapshot
}

export function useKioskHomeFreeBadge(): boolean {
  return useKioskHomePriceSnapshot().badge
}
