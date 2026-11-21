// 一体机首页「免费使用」的读取与判定。不依赖 React，钩子只负责接线。
//
// 价在本机终端配置的 pricing.effective 上。
// 角标：开关为真，并且五个生效价都读到、且都是 0，才返回 true。
// 任一价大于 0、价读不齐、配置读不到或没有开关，角标一律 false。
// 同一轮配置同时给出「是否收费」：读到的有效价里有一个大于 0 就是收费，缺的键不算 0。
// 读不齐且没有正价，或整段价目读不到，不算收费。角标和收费句都用这一对结果，不各读一次。
// 新一轮两个都先不显示。30 秒没回来按失败，之后才到的成功也不再采用。
// 终端号变了立刻两个都撤下并重读；不是当前终端的结果丢掉。
// 同一轮还把读到的五个生效价（分）原样交给首页卡片标价。读不到的键是 null（未知），不当成 0；
// 新一轮、超时、读失败、换终端时五个价一起回到未知。

import { TERMINAL_CHARGE_SERVICE_KEYS, type TerminalChargeServiceKey } from '@ai-job-print/shared'
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

/** 本机五个生效价（分）。null = 这一轮没读到或不是非负整数，不等于 0 元。 */
export type KioskHomeEffectivePrices = Readonly<Record<TerminalChargeServiceKey, number | null>>

export const UNKNOWN_HOME_PRICES: KioskHomeEffectivePrices = Object.freeze(
  Object.fromEntries(TERMINAL_CHARGE_SERVICE_KEYS.map((key) => [key, null])) as Record<TerminalChargeServiceKey, null>,
)

function isCents(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function readEffective(config: unknown): Record<string, unknown> | null {
  if (typeof config !== 'object' || config === null) return null
  const pricing = (config as { pricing?: unknown }).pricing
  if (typeof pricing !== 'object' || pricing === null) return null
  const effective = (pricing as { effective?: unknown }).effective
  if (typeof effective !== 'object' || effective === null) return null
  return effective as Record<string, unknown>
}

function readKnownPrices(config: unknown): { known: number[]; complete: boolean } | null {
  const effective = readEffective(config)
  if (!effective) return null
  const known: number[] = []
  let complete = true
  for (const key of TERMINAL_CHARGE_SERVICE_KEYS) {
    const value = effective[key]
    if (!isCents(value)) {
      complete = false
      continue
    }
    known.push(value)
  }
  return { known, complete }
}

/** 逐键读五个生效价。读到的原样给出；缺键、负数、小数、字符串都记 null；整段价目读不到时五个都是 null。 */
export function kioskHomeEffectivePrices(config: unknown): KioskHomeEffectivePrices {
  const effective = readEffective(config)
  if (!effective) return UNKNOWN_HOME_PRICES
  const prices = {} as Record<TerminalChargeServiceKey, number | null>
  for (const key of TERMINAL_CHARGE_SERVICE_KEYS) {
    const value = effective[key]
    prices[key] = isCents(value) ? value : null
  }
  return Object.freeze(prices)
}

function readEffectiveCents(config: unknown): number[] | null {
  const read = readKnownPrices(config)
  if (!read?.complete) return null
  return read.known
}

/** 纯判定。调用方传入已经取好的本机配置（含 pricing）。 */
export function kioskHomeFreeBadgeVisible(input: KioskHomeFreeBadgeInput): boolean {
  if (typeof input.config !== 'object' || input.config === null) return false
  if ((input.config as { homeFreeBadge?: unknown }).homeFreeBadge !== true) return false
  const cents = readEffectiveCents(input.config)
  if (!cents) return false
  return cents.every((value) => value === 0)
}

/** 读到的有效价里至少有一个大于 0。缺的键不算 0；一个正价都没有，或价目整体读不到，不当成在收费。 */
export function kioskEffectivePricesCharged(config: unknown): boolean {
  const read = readKnownPrices(config)
  if (!read) return false
  return read.known.some((value) => value > 0)
}

export interface KioskHomeFreeBadgePollingOverrides {
  getTerminalId?: () => string | null
  peekConfig?: (terminalId: string, maxAgeMs: number) => unknown
  loadConfig?: (terminalId: string) => Promise<unknown>
  subscribeIdentity?: (listener: () => void) => () => void
  /** 收同一轮的五个生效价。和角标、是否收费同一拍发出；撤下时发 UNKNOWN_HOME_PRICES。 */
  onPrices?: (prices: KioskHomeEffectivePrices) => void
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
  onVisible: (badge: boolean, charged: boolean) => void,
  overrides: KioskHomeFreeBadgePollingOverrides = {},
): () => void {
  const getId = overrides.getTerminalId ?? getTerminalId
  const peek = overrides.peekConfig ?? peekCachedKioskTerminalConfig
  const loadConfig = overrides.loadConfig ?? ((terminalId: string) => getCachedKioskTerminalConfig(terminalId))
  const subscribeIdentity = overrides.subscribeIdentity ?? subscribeTerminalIdentity
  const onPrices = overrides.onPrices
  // 缓存配置不能拿来维持「免费」。签名留着，是为了调用方仍可注入，但这里不读它。
  void peek

  let stopped = false
  let round = 0
  let watchedId = getId()
  let roundTimer: ReturnType<typeof setTimeout> | null = null

  const publish = (badge: boolean, charged: boolean) => {
    if (stopped) return
    onVisible(badge, charged)
  }

  const publishPrices = (prices: KioskHomeEffectivePrices) => {
    if (stopped || !onPrices) return
    onPrices(prices)
  }

  // 撤下：五个价回到未知，角标和收费句都不显示。
  const hide = () => {
    publishPrices(UNKNOWN_HOME_PRICES)
    publish(false, false)
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
    hide()
    if (!terminalId) return

    const still = () => !stopped && ticket === round && getId() === terminalId
    let failed = false
    let settled = false

    roundTimer = setTimeout(() => {
      if (!still() || settled) return
      failed = true
      hide()
    }, HOME_FREE_BADGE_ROUND_TIMEOUT_MS)

    void settle(() => loadConfig(terminalId))
      .then((config) => {
        if (!still() || failed) return
        settled = true
        clearRoundTimer()
        // 五个价、角标和是否收费出自同一份配置，同一拍发出：先交价，再交角标与收费。
        publishPrices(kioskHomeEffectivePrices(config))
        publish(kioskHomeFreeBadgeVisible({ config }), kioskEffectivePricesCharged(config))
      })
      .catch(() => {
        if (!still()) return
        failed = true
        settled = true
        clearRoundTimer()
        hide()
      })
  }

  const unsubscribe = subscribeIdentity(() => {
    if (stopped) return
    const next = getId()
    if (next === watchedId) return
    watchedId = next
    hide()
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
