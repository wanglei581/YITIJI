// 本机五个生效价里有没有大于 0 的。读不齐或读失败是 false，页脚不能据此写成在收费。
// 和「免费使用」标识共用终端配置缓存，不另开一条请求。

import { useEffect, useState } from 'react'
import { kioskEffectivePricesCharged } from '../../../hooks/kioskHomeFreeBadgeReader'
import { getCachedKioskTerminalConfig, getTerminalId } from '../../../services/api/terminalConfig'

export function useHomeEffectivePriceCharged(): boolean {
  const [charged, setCharged] = useState(false)

  useEffect(() => {
    const terminalId = getTerminalId()
    if (!terminalId) return
    let cancelled = false
    void getCachedKioskTerminalConfig(terminalId)
      .then((config) => {
        if (!cancelled) setCharged(kioskEffectivePricesCharged(config))
      })
      .catch(() => {
        if (!cancelled) setCharged(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return charged
}
