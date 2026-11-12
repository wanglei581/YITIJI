// 一体机首页「免费使用」该不该显示。这一段只算出布尔，首页先不画。
//
// 开关开着，并且打印价目读到、黑白与彩色单价都是 0，才返回 true。
// 价目大于 0、价目读失败、本机配置读不到或没有这一项，一律 false。
// 旧接口没下发 homeFreeBadge 时按关，不当成开。
// 配置和价目按同一个 REFRESH_MS 一起重读。新一轮先不显示；
// 任一边已经能判定不该显示就立刻关掉，两边都满足才显示。
// 30 秒没回齐、终端号变了、重读失败，都不沿用上一轮。

import { useEffect, useState } from 'react'
import { startKioskHomeFreeBadgePolling } from './kioskHomeFreeBadgeReader'

export { kioskHomeFreeBadgeVisible, REFRESH_MS, startKioskHomeFreeBadgePolling } from './kioskHomeFreeBadgeReader'
export type { KioskHomeFreeBadgeInput } from './kioskHomeFreeBadgeReader'

export function useKioskHomeFreeBadge(): boolean {
  const [visible, setVisible] = useState(false)

  useEffect(() => startKioskHomeFreeBadgePolling(setVisible), [])

  return visible
}
