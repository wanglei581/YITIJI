// 一体机首页「免费使用」、页脚收费句和四张入口卡的短价。这一段只接线，判定在 reader。
//
// 开关开着，并且本机 pricing 五个生效价都读到、且都是 0，角标才为 true。
// 任一价大于 0、价读不齐、本机配置读不到或没有这一项，角标一律 false。
// 旧接口没下发 homeFreeBadge 时按关，不当成开。
// 是否收费、角标和五个生效价来自同一轮配置。配置按 REFRESH_MS 重读。新一轮三样都先撤下（价回到未知）。
// 30 秒没回来、终端号变了、重读失败，都不沿用上一轮。

import { useEffect, useState } from 'react'
import { startKioskHomeFreeBadgePolling, UNKNOWN_HOME_PRICES, type KioskHomeEffectivePrices } from './kioskHomeFreeBadgeReader'

export { kioskHomeFreeBadgeVisible, REFRESH_MS, startKioskHomeFreeBadgePolling } from './kioskHomeFreeBadgeReader'
export type { KioskHomeEffectivePrices, KioskHomeFreeBadgeInput } from './kioskHomeFreeBadgeReader'

export interface KioskHomePriceSnapshot {
  badge: boolean
  charged: boolean
  /** 本机五个生效价（分）。读不到的是 null，不当成 0。 */
  prices: KioskHomeEffectivePrices
}

export function useKioskHomePriceSnapshot(): KioskHomePriceSnapshot {
  const [snapshot, setSnapshot] = useState({ badge: false, charged: false })
  const [prices, setPrices] = useState<KioskHomeEffectivePrices>(UNKNOWN_HOME_PRICES)

  // 价和角标、收费在同一拍里发出，React 合并成一次重画，不会出现价是新一轮、角标是上一轮。
  useEffect(() => startKioskHomeFreeBadgePolling((badge, charged = false) => {
    setSnapshot({ badge, charged })
  }, { onPrices: setPrices }), [])

  return { ...snapshot, prices }
}

export function useKioskHomeFreeBadge(): boolean {
  return useKioskHomePriceSnapshot().badge
}
