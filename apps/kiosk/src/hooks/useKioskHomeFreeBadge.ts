// 一体机首页「免费使用」该不该显示。这一段只算出布尔，首页先不画。
//
// 开关开着，并且打印价目读到、黑白与彩色单价都是 0，才返回 true。
// 价目大于 0、价目读失败、本机配置读不到或没有这一项，一律 false。
// 旧接口没下发 homeFreeBadge 时按关，不当成开。

import { useEffect, useState } from 'react'
import {
  getCachedKioskTerminalConfig,
  getTerminalId,
  peekCachedKioskTerminalConfig,
} from '../services/api/terminalConfig'
import { unitCentsFor, usePrintPriceConfig } from '../services/print/priceConfigApi'

const REFRESH_MS = 5 * 60 * 1000

export interface KioskHomeFreeBadgeInput {
  config: unknown
  priceStatus: 'loading' | 'ready' | 'error'
  bwCents: number | null
  colorCents: number | null
}

/** 纯判定。调用方传入已经取好的配置和两种单价。 */
export function kioskHomeFreeBadgeVisible(input: KioskHomeFreeBadgeInput): boolean {
  if (input.priceStatus !== 'ready') return false
  if (input.bwCents !== 0 || input.colorCents !== 0) return false
  if (typeof input.config !== 'object' || input.config === null) return false
  return (input.config as { homeFreeBadge?: unknown }).homeFreeBadge === true
}

function readCachedConfig(): unknown {
  const terminalId = getTerminalId()
  if (!terminalId) return null
  return peekCachedKioskTerminalConfig(terminalId, REFRESH_MS)
}

export function useKioskHomeFreeBadge(): boolean {
  const price = usePrintPriceConfig()
  const [config, setConfig] = useState<unknown>(readCachedConfig)

  useEffect(() => {
    let alive = true
    const load = () => {
      const terminalId = getTerminalId()
      if (!terminalId) {
        if (alive) setConfig(null)
        return
      }
      getCachedKioskTerminalConfig(terminalId)
        .then((next) => {
          if (alive) setConfig(next)
        })
        // 读失败按关。不能沿用上一次的「该显示」，避免价目或配置短暂失败时仍写免费。
        .catch(() => {
          if (alive) setConfig(null)
        })
    }
    load()
    const timer = window.setInterval(load, REFRESH_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  return kioskHomeFreeBadgeVisible({
    config,
    priceStatus: price.status,
    bwCents: unitCentsFor(price.config, 'black_white'),
    colorCents: unitCentsFor(price.config, 'color'),
  })
}
