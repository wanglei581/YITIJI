// 一体机首页「免费使用」的读取与判定。不依赖 React，钩子只负责接线。
//
// 价在本机终端配置的 pricing.effective 上，五个键都要读到。
// 开关为真，并且五个生效价都是 0，才返回 true。
// 任一价大于 0、价读不齐、配置读不到或没有开关，一律 false。
// 新一轮先不显示。30 秒没回来按失败，之后才到的成功也不再显示。
// 终端号变了立刻不显示并重读；不是当前终端的结果丢掉。

import { TERMINAL_CHARGE_SERVICE_KEYS } from '@ai-job-print/shared'
import { subscribeTerminalIdentity } from '../services/api/screensaver'
import {
  getCachedKioskTerminalConfig,
  getTerminalId,
  peekCachedKioskTerminalConfig,
} from '../services/api/terminalConfig'

export const REFRESH_MS = 5 * 60 * 1000
export const HOME_FREE_BADGE_ROUND_TIMEOUT_MS = 30 * 1000

export interface KioskHomeFreeBadgeInput {
  config: unknown
}

function readEffectiveCents(config: unknown): number[] | null {
  if (typeof config !== 'object' || config === null) return null
  const pricing = (config as { pricing?: unknown }).pricing
  if (typeof pricing !== 'object' || pricing === null) return null
  const effective = (pricing as { effective?: unknown }).effective
  if (typeof effective !== 'object' || effective === null) return null
  const cents: number[] = []
  for (const key of TERMINAL_CHARGE_SERVICE_KEYS) {
    const value = (effective as Record<string, unknown>)[key]
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null
    cents.push(value)
  }
  return cents
}

/** 纯判定。调用方传入已经取好的本机配置（含 pricing）。 */
export function kioskHomeFreeBadgeVisible(input: KioskHomeFreeBadgeInput): boolean {
  if (typeof input.config !== 'object' || input.config === null) return false
  if ((input.config as { homeFreeBadge?: unknown }).homeFreeBadge !== true) return false
  const cents = readEffectiveCents(input.config)
  if (!cents) return false
  return cents.every((value) => value === 0)
}

export interface KioskHomeFreeBadgePollingOverrides {
  getTerminalId?: () => string | null
  peekConfig?: (terminalId: string, maxAgeMs: number) => unknown
  loadConfig?: (terminalId: string) => Promise<unknown>
  subscribeIdentity?: (listener: () => void) => () => void
}

function settle<T>(load: () => Promise<T> | T): Promise<T> {
  try {
    return Promise.resolve(load())
  } catch (error) {
    return Promise.reject(error)
  }
}

/**
 * 立刻读一次，之后每 REFRESH_MS 重读本机配置。
 * 返回停止函数：清掉定时器，在途结果不再公布。
 */
export function startKioskHomeFreeBadgePolling(
  onVisible: (visible: boolean) => void,
  overrides: KioskHomeFreeBadgePollingOverrides = {},
): () => void {
  const getId = overrides.getTerminalId ?? getTerminalId
  const peek = overrides.peekConfig ?? peekCachedKioskTerminalConfig
  const loadConfig = overrides.loadConfig ?? ((terminalId: string) => getCachedKioskTerminalConfig(terminalId))
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
    publish(false)
    if (!terminalId) return

    const still = () => !stopped && ticket === round && getId() === terminalId
    let failed = false
    let settled = false

    roundTimer = setTimeout(() => {
      if (!still() || settled) return
      failed = true
      publish(false)
    }, HOME_FREE_BADGE_ROUND_TIMEOUT_MS)

    void settle(() => loadConfig(terminalId))
      .then((config) => {
        if (!still() || failed) return
        settled = true
        clearRoundTimer()
        publish(kioskHomeFreeBadgeVisible({ config }))
      })
      .catch(() => {
        if (!still()) return
        failed = true
        settled = true
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
