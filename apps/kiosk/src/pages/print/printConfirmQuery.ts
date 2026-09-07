// 报价确认页地址栏契约。
//
// 金额只认服务端 POST /orders/quote。地址栏里的取值不是报价、不是文件本身。
// 白名单以外的键、同名键重复、不可回显取值、非空 # 片段，一律 fail-closed
// 到 invalid-context，并立刻换成只含安全登记参数的地址。
// 键名与取值不进 DOM、不进属性、不进错误文案。

import { useLayoutEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export const QUERY_ALLOW = [
  'source',
  'fileId',
  'pages',
  'copies',
  'duplex',
  'color',
  'state',
  'debug',
  'flat',
  'coupon',
  'capture',
] as const

export const PRINT_CONFIRM_STATES = [
  'missing-context',
  'invalid-context',
  'quoting',
  'quoted',
  'quote-failed',
  'capability-invalid-params',
  'benefit-unverified',
  'zero-amount',
] as const

export type PrintConfirmScreen = (typeof PRINT_CONFIRM_STATES)[number]

const SYNTHETIC_STATES: readonly PrintConfirmScreen[] = [
  'quoted',
  'benefit-unverified',
  'zero-amount',
]

const SENSITIVE_KEY =
  /token|secret|sign|url|uri|href|link|key|pass|auth|credential|cookie|session|jwt|otp|ticket|access|bearer/i

export function safeVal(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,40}$/.test(value) && !/\d{8,}/.test(value)
}

function decodePair(part: string): [string, string] {
  const cut = part.indexOf('=')
  const rawKey = cut < 0 ? part : part.slice(0, cut)
  const rawVal = cut < 0 ? '' : part.slice(cut + 1)
  const decode = (input: string) => {
    try {
      return decodeURIComponent(input.replace(/\+/g, ' '))
    } catch {
      return input
    }
  }
  return [decode(rawKey), decode(rawVal)]
}

export type QueryScan = {
  dirty: boolean
  hasFragment: boolean
  sensitive: boolean
  duplicate: boolean
  badKey: boolean
  badValue: boolean
  debug: boolean
  flat: boolean
  capture: boolean
  requestedState: string | null
}

export function hasNonEmptyFragment(hash: string, href: string): boolean {
  if (typeof hash === 'string' && hash.length > 1) return true
  const at = href.indexOf('#')
  return at >= 0 && at < href.length - 1
}

export function scanPrintConfirmQuery(search: string, hash: string, href: string): QueryScan {
  const query = search.startsWith('?') ? search.slice(1) : search
  const pairs = query === '' ? [] : query.split('&').filter(Boolean).map(decodePair)
  const seen = new Set<string>()
  let badKey = false
  let badValue = false
  let duplicate = false
  let sensitive = false
  let debug = false
  let flat = false
  let capture = false
  let requestedState: string | null = null

  for (const [key, value] of pairs) {
    if (key === 'debug' && value === '1') debug = true
    if (key === 'flat' && value === '1') flat = true
    if (key === 'capture' && value === '1') capture = true
    if (key === 'state') requestedState = value

    if (!(QUERY_ALLOW as readonly string[]).includes(key)) {
      badKey = true
      if (SENSITIVE_KEY.test(key)) sensitive = true
      continue
    }
    if (seen.has(key)) {
      duplicate = true
      badKey = true
    }
    seen.add(key)
    if (value !== '' && !safeVal(value)) badValue = true
  }

  const hasFragment = hasNonEmptyFragment(hash, href)
  return {
    dirty: badKey || badValue || duplicate || hasFragment,
    hasFragment,
    sensitive,
    duplicate,
    badKey,
    badValue,
    debug,
    flat,
    capture,
    requestedState,
  }
}

export function invalidContextReason(scan: QueryScan): string {
  if (scan.hasFragment) {
    return (
      '地址里带了 # 之后的内容。本页把任何非空 # 片段都当作不可信输入：不解析、不做白名单，也不按它的内容判断该显示哪一份文件。' +
      '地址栏已经就地换成不带 # 的安全地址，它的原文不会显示在屏幕上，也不会带去下一步。'
    )
  }
  if (scan.sensitive) {
    return (
      '地址里带了本页没有登记的参数，其中有像凭证、签名链接那样的键名。' +
      '本页只认来源、文件编号、页数、份数、单双面、颜色和页面状态这几个登记参数，其余一概不看、不显示，也不会带去下一步。' +
      '地址栏里那几个取值已经就地清掉了。'
    )
  }
  if (scan.duplicate || scan.badKey) {
    return (
      '地址里带了本页登记表以外的参数，或者同一个参数出现了不止一次。' +
      '同名键重复出现时本页不会只取第一个假装没事。地址栏已经就地清掉了。'
    )
  }
  return (
    '地址里有参数的取值不像本页登记过的编号或状态。' +
    '取值不合规的内容不会显示在屏幕上，也不会留在地址栏。'
  )
}

export function isRegisteredScreen(value: string | null): value is PrintConfirmScreen {
  return value !== null && (PRINT_CONFIRM_STATES as readonly string[]).includes(value)
}

/** 合成排版演示：必须同时带 capture=1 与 debug=1，否则一律不渲染金额。 */
export function allowSyntheticScreen(scan: QueryScan, screen: PrintConfirmScreen): boolean {
  return scan.capture && scan.debug && SYNTHETIC_STATES.includes(screen)
}

function safeSearch(scan: QueryScan): string {
  const parts = ['state=invalid-context']
  if (scan.debug) parts.push('debug=1')
  if (scan.flat) parts.push('flat=1')
  return `?${parts.join('&')}`
}

export function usePrintConfirmQueryGuard(): {
  scan: QueryScan
  queryInvalid: boolean
  invalidReason: string
} {
  const location = useLocation()
  const navigate = useNavigate()
  const [href] = useState(() => (typeof window === 'undefined' ? '' : window.location.href))
  const scan = useMemo(
    () => scanPrintConfirmQuery(location.search, location.hash, href),
    [location.search, location.hash, href],
  )
  const queryInvalid = scan.dirty
  const invalidReason = queryInvalid ? invalidContextReason(scan) : ''

  useLayoutEffect(() => {
    if (!queryInvalid) return
    const next = safeSearch(scan)
    if (location.search === next && !location.hash) return
    try {
      window.history.replaceState(window.history.state, '', `${location.pathname}${next}`)
    } catch {
      /* file:// 等宿主可能拒绝 replaceState；屏幕仍走 invalid-context。 */
    }
    navigate({ pathname: location.pathname, search: next, hash: '' }, { replace: true, state: null })
  }, [queryInvalid, scan, location.pathname, location.search, location.hash, navigate])

  return { scan, queryInvalid, invalidReason }
}
