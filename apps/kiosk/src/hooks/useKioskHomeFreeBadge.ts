// 一体机首页「免费使用」该不该显示。这一段只算出布尔，首页先不画。
//
// 开关开着，并且本机 pricing 五个生效价都读到、且都是 0，才返回 true。
// 任一价大于 0、价读不齐、本机配置读不到或没有这一项，一律 false。
// 旧接口没下发 homeFreeBadge 时按关，不当成开。
// 配置按 REFRESH_MS 重读。新一轮先不显示。
// 30 秒没回来、终端号变了、重读失败，都不沿用上一轮。

import { useEffect, useState } from 'react'
import { startKioskHomeFreeBadgePolling } from './kioskHomeFreeBadgeReader'

export { kioskHomeFreeBadgeVisible, REFRESH_MS, startKioskHomeFreeBadgePolling } from './kioskHomeFreeBadgeReader'
export type { KioskHomeFreeBadgeInput } from './kioskHomeFreeBadgeReader'

export function useKioskHomeFreeBadge(): boolean {
  const [visible, setVisible] = useState(false)

  useEffect(() => startKioskHomeFreeBadgePolling(setVisible), [])

  return visible
}
