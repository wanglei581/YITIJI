// 一体机首页「免费使用」的读取与判定。不依赖 React，钩子只负责接线。
//
// 价目在这里单独读（fetchPrintPriceConfig），不改 usePrintPriceConfig：
// 打印页等调用方仍只在挂载时读一次。
// 新一轮先不显示。价目或配置只要有一边已经能判定不该显示，立刻发布不显示；
// 只有这一轮两边都回来、并且都满足，才发布显示。30 秒没回齐按失败，
// 之后才到的成功也不再显示。终端号变了立刻不显示并重读；不是当前终端的结果丢掉。

import type { PrintPriceConfigView } from '@ai-job-print/shared'
import { subscribeTerminalIdentity } from '../services/api/screensaver'
import {
  getCachedKioskTerminalConfig,
  getTerminalId,
  peekCachedKioskTerminalConfig,
} from '../services/api/terminalConfig'
import { fetchPrintPriceConfig, unitCentsFor, type PriceConfigState } from '../services/print/priceConfigApi'

export const REFRESH_MS = 5 * 60 * 1000
export const HOME_FREE_BADGE_ROUND_TIMEOUT_MS = 30 * 1000

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
  subscribeIdentity?: (listener: () => void) => () => void
}

function configAllows(config: unknown): boolean {
  return typeof config === 'object' && config !== null && (config as { homeFreeBadge?: unknown }).homeFreeBadge === true
}

function priceAllows(priceConfig: PrintPriceConfigView): boolean {
  return unitCentsFor(priceConfig, 'black_white') === 0 && unitCentsFor(priceConfig, 'color') === 0
}

function settle<T>(load: () => Promise<T> | T): Promise<T> {
  try {
    return Promise.resolve(load())
  } catch (error) {
    return Promise.reject(error)
  }
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
  const subscribeIdentity = overrides.subscribeIdentity ?? subscribeTerminalIdentity
  // 缓存配置不能拿来维持「免费」。签名留着，是为了调用方仍可注入，但这里不读它。
  void peek

  let stopped = false
  let round = 0
  let watchedId = getId()
  let roundTimer: ReturnType<typeof setTimeout> | null = null

  const publish = (visible: boolean) => {
    if (stopped) return
    onVisible(visible)
  }

  const clearRoundTimer = () => {
    if (roundTimer !== null) {
      clearTimeout(roundTimer)
      roundTimer = null
    }
  }

  const load = () => {
    if (stopped) return
    const ticket = ++round
    clearRoundTimer()
    const terminalId = getId()
    watchedId = terminalId
    // 新一轮还没回齐，不能沿用上一轮的「显示」。
    publish(false)
    if (!terminalId) return

    const still = () => !stopped && ticket === round && getId() === terminalId
    let configReady = false
    let priceReady = false
    let configOn = false
    let priceFree = false
    let failed = false

    const publishShowIfBoth = () => {
      if (!still() || failed) return
      if (configReady && priceReady && configOn && priceFree) {
        clearRoundTimer()
        publish(true)
      }
    }

    roundTimer = setTimeout(() => {
      if (!still() || (configReady && priceReady)) return
      failed = true
      publish(false)
    }, HOME_FREE_BADGE_ROUND_TIMEOUT_MS)

    // 这一轮一开始就发出请求。同步抛错也进同一条失败路径，不让收费机器多显示一会儿。
    void settle(() => loadConfig(terminalId))
      .then((config) => {
        if (!still() || failed) return
        configReady = true
        configOn = configAllows(config)
        if (!configOn) {
          failed = true
          clearRoundTimer()
          publish(false)
          return
        }
        publishShowIfBoth()
      })
      .catch(() => {
        if (!still()) return
        failed = true
        configReady = true
        clearRoundTimer()
        publish(false)
      })

    void settle(loadPrice)
      .then((priceConfig) => {
        if (!still() || failed) return
        priceReady = true
        priceFree = priceAllows(priceConfig)
        if (!priceFree) {
          failed = true
          clearRoundTimer()
          publish(false)
          return
        }
        publishShowIfBoth()
      })
      .catch(() => {
        if (!still()) return
        failed = true
        priceReady = true
        clearRoundTimer()
        publish(false)
      })
  }

  const unsubscribe = subscribeIdentity(() => {
    if (stopped) return
    const next = getId()
    if (next === watchedId) return
    watchedId = next
    publish(false)
    load()
  })

  load()
  const timer = setInterval(load, REFRESH_MS)
  return () => {
    stopped = true
    round += 1
    clearRoundTimer()
    clearInterval(timer)
    unsubscribe()
  }
}
