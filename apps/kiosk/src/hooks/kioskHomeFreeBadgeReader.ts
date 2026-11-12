// 一体机首页「免费使用」的读取与判定。不依赖 React，钩子只负责接线。
//
// 价目在这里单独读（fetchPrintPriceConfig），不改 usePrintPriceConfig：
// 打印页等调用方仍只在挂载时读一次。
// 配置和价目按同一个 REFRESH_MS 一起重读。任一次失败都丢掉上一轮，
// 不能沿用上一次的 0 元，否则收费之后首页仍会算出该显示。

import {
  getCachedKioskTerminalConfig,
  getTerminalId,
  peekCachedKioskTerminalConfig,
} from '../services/api/terminalConfig'
import { fetchPrintPriceConfig, unitCentsFor, type PriceConfigState } from '../services/print/priceConfigApi'
import type { PrintPriceConfigView } from '@ai-job-print/shared'

export const REFRESH_MS = 5 * 60 * 1000

export interface KioskHomeFreeBadgeInput {
  config: unknown
  priceStatus: PriceConfigState['status']
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

export interface KioskHomeFreeBadgePollingOverrides {
  getTerminalId?: () => string | null
  peekConfig?: (terminalId: string, maxAgeMs: number) => unknown
  loadConfig?: (terminalId: string) => Promise<unknown>
  loadPrice?: () => Promise<PrintPriceConfigView>
}

interface Snapshot {
  config: unknown
  priceStatus: PriceConfigState['status']
  priceConfig: PrintPriceConfigView | null
}

function visibleOf(snapshot: Snapshot): boolean {
  return kioskHomeFreeBadgeVisible({
    config: snapshot.config,
    priceStatus: snapshot.priceStatus,
    bwCents: unitCentsFor(snapshot.priceConfig, 'black_white'),
    colorCents: unitCentsFor(snapshot.priceConfig, 'color'),
  })
}

/**
 * 立刻读一次，之后每 REFRESH_MS 重读配置和价目。
 * 返回停止函数：清掉定时器，在途结果不再公布。
 */
export function startKioskHomeFreeBadgePolling(
  onVisible: (visible: boolean) => void,
  overrides: KioskHomeFreeBadgePollingOverrides = {},
): () => void {
  const getId = overrides.getTerminalId ?? getTerminalId
  const peek = overrides.peekConfig ?? peekCachedKioskTerminalConfig
  const loadConfig = overrides.loadConfig ?? ((terminalId: string) => getCachedKioskTerminalConfig(terminalId))
  const loadPrice = overrides.loadPrice ?? fetchPrintPriceConfig

  let stopped = false
  let round = 0
  const initialId = getId()
  let snapshot: Snapshot = {
    config: initialId ? peek(initialId, REFRESH_MS) : null,
    priceStatus: 'loading',
    priceConfig: null,
  }

  const publish = () => {
    onVisible(visibleOf(snapshot))
  }

  const load = () => {
    const ticket = ++round
    const terminalId = getId()
    if (!terminalId) {
      snapshot = { config: null, priceStatus: 'error', priceConfig: null }
      publish()
      return
    }
    const configTask = Promise.resolve()
      .then(() => loadConfig(terminalId))
      .then((config) => ({ ok: true as const, config }))
      .catch(() => ({ ok: false as const }))
    const priceTask = Promise.resolve()
      .then(() => loadPrice())
      .then((priceConfig) => ({ ok: true as const, priceConfig }))
      .catch(() => ({ ok: false as const }))
    void Promise.all([configTask, priceTask]).then(([configResult, priceResult]) => {
      if (stopped || ticket !== round) return
      // 失败写成读不到，不用上一轮的配置或 0 元价目。
      snapshot = {
        config: configResult.ok ? configResult.config : null,
        priceStatus: priceResult.ok ? 'ready' : 'error',
        priceConfig: priceResult.ok ? priceResult.priceConfig : null,
      }
      publish()
    })
  }

  publish()
  load()
  const timer = setInterval(load, REFRESH_MS)
  return () => {
    stopped = true
    round += 1
    clearInterval(timer)
  }
}
