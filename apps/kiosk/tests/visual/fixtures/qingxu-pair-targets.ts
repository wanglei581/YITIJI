// 青序流光原稿 ↔ 一体机运行页：逐（画面，状态）枚举与造状态。
//
// 原稿枚举读每张稿自己的画面表 / 状态表（VIEWS 的 screen:state、SCREENS.states、
// PAGES.table、STATES、?hub= / ?screen= / ?view= / ?tab=），不走只认 ?state= 的几何门禁口径。
// 造状态只调用 tests 里已有的注册器与可见界面；造不出来的留 missingReason。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import type { ApiRouter } from '../../fixtures/api-router'
import {
  FAIR_ID,
  VISIT_PLAN_TASK_ID,
  registerFairApi,
  type FairApiOptions,
} from './fair-workbench-api'
import {
  loginThroughVisibleUi,
  openLoginVerificationError,
  openScanSettingsCreateFailed,
  registerEvidenceShell,
  seedCashierFailed,
  seedCashierPending,
  seedPrintDoneCompleted,
  seedPrintFlow,
  seedPrintProgress,
  seedScanProgress,
} from './kiosk-p1-evidence-capture-api'
import { assistantMockFallbackReply, assistantReply } from './fusion-w3-states'
import { writeScanWorkbenchSession } from './fusion-w2-state'
import { w6RouteCases, type W6RouteCase } from './fusion-w6-route-cases'
import { preparePrioritySeed, priorityPlan } from './qingxu-pair-seeds'
import { policyPagesExtraPairs, policyPagesPlan, preparePolicyPages } from './qingxu-pair-policy-pages'
import { prepareResumePages, resumePagesExtraPairs, resumePagesPlan } from './qingxu-pair-resume-pages'

const here = path.dirname(fileURLToPath(import.meta.url))
export const PROTO_DIR = path.resolve(here, '../../../../../docs/design/kiosk-redesign-2026-08')
// 2026-09-27 裁决（CLAUDE.md §9）：v2 目录里有的稿以 v2 为准，没有的仍读原稿。
export const PROTO_V2_DIR = path.resolve(here, '../../../../../docs/design/kiosk-redesign-2026-08-v2')

/** 稿文件（含同目录的 .js / .css 附件）的实际路径：v2 有就用 v2，否则用原稿。越出两个目录的返回 null。 */
export function protoFile(name: string): string | null {
  // v2 稿用 `../kiosk-redesign-2026-08/…` 引原稿目录的附件（48、50 的共用脚本就是这样引的）；经本地服务
  // 取时路径变成 `kiosk-redesign-2026-08/…`，按带目录名的路径在那一个目录里找，不再走 v2 优先。
  for (const dir of [PROTO_V2_DIR, PROTO_DIR]) {
    const prefix = `${path.basename(dir)}/`
    if (!name.startsWith(prefix)) continue
    const file = path.join(dir, name.slice(prefix.length))
    if (!file.startsWith(dir + path.sep)) return null
    return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null
  }
  for (const dir of [PROTO_V2_DIR, PROTO_DIR]) {
    const file = path.join(dir, name)
    if (!file.startsWith(dir + path.sep)) return null
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file
  }
  return null
}

const REGISTER_ONLY = new Set(['36-index.html', '37-pay-states.html'])
const PREVIEW_STATES = new Set([
  'preview-no-result', 'preview-loading', 'preview-failed', 'preview-ready', 'preview-hints',
  'preview-editing', 'export-chooser', 'export-exporting', 'export-failed', 'export-ready',
  'export-url-expired', 'export-print-unavailable', 'session-lost', 'illegal',
])
const OPTIMIZE_URL_STATES = new Set([
  'no-context', 'loading', 'ready', 'empty', 'read-error', 'optimize-failed', 'unavailable', 'illegal',
])
const REPORT_URL_STATES = new Set([
  'no-context', 'loading', 'report', 'report-minimal', 'report-empty', 'read-error',
  'diagnose-failed', 'unavailable', 'illegal',
])
const PLAN_URL_STATES = new Set([
  'no-artifact', 'qa-pins', 'slot-draft', 'slot-draft-blanks', 'compare-report',
  'compare-all-covered', 'print-unavailable', 'expired',
])
const ASSISTANT_DRIVEN = new Set(['default', 'composer', 'submitting', 'reply-real', 'reply-not-ai', 'reply-error'])
// 这几态在稿里要另带参数才画得出来，不带就回落成别的态（9/28 收稿时各实现方报的漏检）：
// 06 的主题页要 topic=，不带显示「没找到」；12 的取消两态要 cancel=ok|fail，不带显示「没有文件」；
// 32 选定通道之后的各态要 channel=，不带回落成「待支付」或「通道不明」。
const PAY_CHANNEL_STATES = [
  'channel-selected', 'pending-scan', 'pending-qr', 'awaiting-code-confirmation', 'pending-verification',
  'display-expired-reconciling', 'expired', 'attempt-failed', 'release-failed',
]
// 14 的报价态现在由并排夹具提供真实交接上下文与报价请求，允许 capture=1 进入运行页状态。
const NO_CAPTURE_FILES = new Set<string>()
function withoutCaptureFor(file: string, query: string): string {
  if (!NO_CAPTURE_FILES.has(file) || !query.startsWith('?')) return query
  const params = new URLSearchParams(query.slice(1))
  params.delete('capture')
  const rest = params.toString()
  return rest ? `?${rest}` : ''
}
const STATE_QUERY: Record<string, Record<string, Record<string, string>>> = {
  '06-help.html': { topic: { topic: 'print' } },
  '12-file-source.html': { 'phone-cancel-failed': { cancel: 'fail' }, 'phone-cancelled': { cancel: 'ok' } },
  '32-cashier.html': Object.fromEntries(PAY_CHANNEL_STATES.map((state) => [state, { channel: 'wechat' }])),
  // 14 的「已报价 / 权益未抵扣 / 零元单」摆的是示例金额，只在演示模式（debug=1）里画；不带就停在一屏说明。
  '14-print-confirm.html': Object.fromEntries(['quoted', 'benefit-unverified', 'zero-amount'].map((state) => [state, { debug: '1' }])),
}

const CANONICAL_ROUTE: Record<string, string> = {
  '/print/material-check': '/print/desk?step=check',
  '/print/preview': '/print/desk?step=preview',
  '/print/params': '/print/desk?step=preview',
  '/print/scan-sign': '/print-scan/sign',
  '/print/scan-convert': '/print-scan/convert',
  '/print/scan-feature': '/print-scan/feature/id-photo',
  '/scan/start': '/scan?stage=start',
  '/scan/settings': '/scan?stage=settings',
  '/scan/progress': '/scan?stage=progress',
  '/scan/result': '/scan?stage=result',
  '/interview/setup': '/interview?stage=setup',
  '/interview/session': '/interview?stage=session',
  '/interview/report': '/interview?stage=report',
  '/interview/tips': '/interview?stage=tips',
  '/interview/reports': '/interview?stage=reports',
  '/resume': '/resume/source',
  '/resume/upload': '/resume/source',
}

export type PairStatus = 'paired' | 'missing-runtime-setup' | 'runtime-redirected' | 'error'

export interface QingxuPairTarget {
  file: string
  nn: string
  screen: string
  state: string
  /** 原稿 URL 查询；空字符串表示裸地址。 */
  protoQuery: string
  /** 原稿截图前要等的 data-state；扫描夹具队列才会设。 */
  waitProtoState: boolean
  /** 截原稿前写入 sessionStorage，让稿自己落到 session-lost。 */
  protoSessionLost: boolean
  route: string | null
  runtimeUrl: string | null
  readyMarker: string | null
  /** false：36 索引 / 37 旧版，只登记不截。 */
  capture: boolean
  missingReason: string | null
  plan: RuntimePlan
}

export type RuntimePlan =
  | { kind: 'none' }
  | { kind: 'w6' }
  | { kind: 'url' }
  | { kind: 'fair' }
  | { kind: 'desk'; seeded: boolean }
  | { kind: 'cashier'; variant: 'pending' | 'failed' }
  | { kind: 'progress' }
  | { kind: 'done' }
  | { kind: 'scan-start' }
  | { kind: 'scan-settings' }
  | { kind: 'scan-create-failed' }
  | { kind: 'scan-progress' }
  | { kind: 'scan-result' }
  | { kind: 'login-error' }
  | { kind: 'assistant' }
  | { kind: 'priority' }
  /** 45 本机构官方渠道、48 政策服务（qingxu-pair-policy-pages.ts）。 */
  | { kind: 'policy-pages' }
  /** B 路 16/18–25/29/34/46/52（qingxu-pair-resume-pages.ts）。 */
  | { kind: 'resume-pages' }

interface RawPair {
  screen: string
  state: string
  axis: 'none' | 'state' | 'screen' | 'view' | 'hub' | 'tab'
  route: string | null
  protoQuery?: string
  waitProtoState?: boolean
  protoSessionLost?: boolean
}

function sliceBalanced(source: string, openIndex: number, open: string, close: string): string {
  let depth = 0
  let quote: string | null = null
  let escape = false
  for (let i = openIndex; i < source.length; i++) {
    const ch = source[i]
    if (quote) {
      if (escape) { escape = false; continue }
      if (ch === '\\') { escape = true; continue }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
    if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) return source.slice(openIndex, i + 1)
    }
  }
  return source.slice(openIndex)
}

function lastObject(source: string, name: string): string | null {
  const re = new RegExp(`(?:var|let|const)\\s+${name}\\s*=\\s*\\{`, 'g')
  let match: RegExpExecArray | null = null
  let found: RegExpExecArray | null = null
  while ((match = re.exec(source))) found = match
  if (!found) return null
  return sliceBalanced(source, found.index + found[0].length - 1, '{', '}')
}

function stringsOf(literal: string): string[] {
  return [...literal.matchAll(/['"]([a-z0-9-]+)['"]/g)].map((match) => match[1])
}

function arrayByName(source: string, name: string): string[] {
  const re = new RegExp(`(?:var|let|const|,)\\s*${name}\\s*=\\s*\\[`, 'g')
  let match: RegExpExecArray | null = null
  let found: RegExpExecArray | null = null
  while ((match = re.exec(source))) found = match
  if (!found) return []
  return stringsOf(sliceBalanced(source, found.index + found[0].length - 1, '[', ']'))
}

interface Entry { key: string; body: string }

function topEntries(objectLiteral: string): Entry[] {
  const src = objectLiteral
  const end = src.length - 1
  const out: Entry[] = []
  let i = 1
  while (i < end) {
    while (i < end && /[\s,]/.test(src[i])) i += 1
    if (i >= end) break
    if (src.startsWith('/*', i)) {
      const close = src.indexOf('*/', i)
      i = close === -1 ? end : close + 2
      continue
    }
    if (src.startsWith('//', i)) {
      const nl = src.indexOf('\n', i)
      i = nl === -1 ? end : nl + 1
      continue
    }
    let key = ''
    if (src[i] === '"' || src[i] === "'") {
      const quote = src[i]
      i += 1
      const start = i
      while (i < end && src[i] !== quote) {
        if (src[i] === '\\') i += 1
        i += 1
      }
      key = src.slice(start, i)
      i += 1
    } else if (/[A-Za-z0-9_$]/.test(src[i])) {
      const start = i
      while (i < end && /[A-Za-z0-9_$-]/.test(src[i])) i += 1
      key = src.slice(start, i)
    } else {
      i += 1
      continue
    }
    while (i < end && /\s/.test(src[i])) i += 1
    if (src[i] !== ':') continue
    i += 1
    while (i < end && /\s/.test(src[i])) i += 1
    if (src[i] === '{' || src[i] === '[') {
      const open = src[i]
      const body = sliceBalanced(src, i, open, open === '{' ? '}' : ']')
      out.push({ key, body })
      i += body.length
      continue
    }
    if (src.startsWith('function', i)) {
      const brace = src.indexOf('{', i)
      const body = sliceBalanced(src, brace, '{', '}')
      out.push({ key, body })
      i = brace + body.length
      continue
    }
    const start = i
    let depth = 0
    let quote: string | null = null
    let escape = false
    while (i < end) {
      const ch = src[i]
      if (quote) {
        if (escape) escape = false
        else if (ch === '\\') escape = true
        else if (ch === quote) quote = null
        i += 1
        continue
      }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; i += 1; continue }
      if (ch === '(' || ch === '{' || ch === '[') depth += 1
      else if (ch === ')' || ch === '}' || ch === ']') depth = Math.max(0, depth - 1)
      else if (ch === ',' && depth === 0) break
      i += 1
    }
    out.push({ key, body: src.slice(start, i) })
  }
  return out
}

function fieldArray(body: string, field: string): string[] | null {
  const re = new RegExp(`${field}\\s*:\\s*(\\[|[A-Z][A-Z0-9_]*)`)
  const match = re.exec(body)
  if (!match) return null
  if (match[1] === '[') {
    return stringsOf(sliceBalanced(body, match.index + match[0].length - 1, '[', ']'))
  }
  return null
}

function fieldIdent(body: string, field: string): string | null {
  const match = new RegExp(`${field}\\s*:\\s*([A-Z][A-Z0-9_]*)`).exec(body)
  return match?.[1] ?? null
}

function fieldRoute(body: string): string | null {
  const match = /route\s*:\s*['"](\/[^'"]+)['"]/.exec(body)
  return match?.[1] ?? null
}

function tableStates(body: string): string[] | null {
  const match = /table\s*:\s*\[/.exec(body)
  if (!match) return null
  const table = sliceBalanced(body, match.index + match[0].length - 1, '[', ']')
  const states: string[] = []
  let i = 1
  while (i < table.length - 1) {
    while (i < table.length && /[\s,]/.test(table[i])) i += 1
    if (table[i] !== '[') break
    const row = sliceBalanced(table, i, '[', ']')
    const first = stringsOf(row)[0]
    if (first) states.push(first)
    i += row.length
  }
  return states
}

function headerComment(html: string): string {
  const match = html.match(/<!--([\s\S]*?)-->/)
  return match?.[1] ?? ''
}

function headerScreenRoutes(comment: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const match of comment.matchAll(/(\/[A-Za-z0-9/:_.-]+)\s+[—-]{1,2}\s+screen=([a-z0-9-]+)/g)) {
    map.set(match[2], match[1])
  }
  return map
}

function headerRoutes(comment: string): string[] {
  const found: string[] = []
  for (const match of comment.matchAll(/route:\s*(\/[A-Za-z0-9/:_.-]+)/g)) found.push(match[1])
  return found
}

function headerPipes(comment: string): string[] {
  const lines = comment.split('\n')
  const start = lines.findIndex((row) => /^\s*state\b/.test(row))
  if (start < 0) return []
  const states: string[] = []
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i]
    if (i > start && !line.includes('|')) break
    if (!line.includes('|')) continue
    for (const match of line.matchAll(/\b([a-z][a-z0-9-]{1,40})\b/g)) {
      if (!['state', 'route', 'screen'].includes(match[1])) states.push(match[1])
    }
  }
  return [...new Set(states)]
}

function bundleOf(file: string): { html: string; source: string } {
  const html = fs.readFileSync(protoFile(file) ?? path.join(PROTO_DIR, file), 'utf8')
  let source = html
  // 同目录的脚本（v2 优先、缺的读原稿）和 v2 稿引用的原稿目录脚本（../kiosk-redesign-2026-08/x.js）都要读：
  // 分区参数常写在原稿的共用脚本里，只读同目录的会把 48 这类页的参数名判错（9/28：48 一直被当成 ?screen=，实际是 ?tab=）。
  for (const match of html.matchAll(/src="((?:\.\.\/kiosk-redesign-2026-08\/)?[a-z0-9_-]+\.js)"/gi)) {
    const rel = match[1]
    const side = rel.startsWith('../') ? path.join(PROTO_DIR, path.basename(rel)) : protoFile(rel)
    if (side && fs.existsSync(side)) source += `\n${fs.readFileSync(side, 'utf8')}`
  }
  return { html, source }
}

function queryFor(axis: RawPair['axis'], screen: string, state: string, extra: Record<string, string> = {}): string {
  if (axis === 'none') return ''
  const params = new URLSearchParams()
  if (axis !== 'state') params.set(axis, screen)
  params.set('state', state)
  params.set('capture', '1')
  params.set('flat', '1')
  for (const [key, value] of Object.entries(extra)) params.set(key, value)
  return `?${params.toString()}`
}

function pairsFromEntries(entries: Entry[], source: string, axis: RawPair['axis']): RawPair[] | null {
  const colon = entries.filter((entry) => /^[a-z0-9-]+:[a-z0-9-]+$/.test(entry.key))
  if (colon.length > 0) {
    return colon.map((entry) => {
      const [screen, state] = entry.key.split(':')
      return { screen, state, axis: axis === 'state' ? 'screen' : axis, route: null }
    })
  }
  const withStates = entries.flatMap((entry) => {
    const inline = fieldArray(entry.body, 'states')
    const ident = inline ? null : fieldIdent(entry.body, 'states')
    const states = inline ?? (ident ? arrayByName(source, ident) : null)
    const table = states ? null : tableStates(entry.body)
    const list = states ?? table
    if (!list || list.length === 0) return []
    const route = fieldRoute(entry.body)
    return list.map((state) => ({ screen: entry.key, state, axis, route }))
  })
  if (withStates.length > 0) return withStates
  const functions = entries.filter((entry) => entry.body.includes('function') && /^[a-z0-9-]+$/.test(entry.key))
  if (functions.length >= 2 && functions.length === entries.filter((entry) => entry.body.includes('function')).length) {
    return functions.map((entry) => ({ screen: 'main', state: entry.key, axis: 'state', route: null }))
  }
  return null
}

function scanPairs(source: string): RawPair[] {
  const keys = [...source.matchAll(/V\['([a-z0-9-]+)'\]\s*=\s*function/g)].map((match) => match[1])
  const screenOf = (state: string): string => {
    if (state === 'setup' || state === 'usb-panel') return 'start'
    if (state === 'create-loading' || state === 'create-failed' || state === 'panel-instruction') return 'settings'
    if (
      state === 'waiting-delivery' || state === 'polling' || state === 'poll-failed' || state.startsWith('cancel')
    ) return 'progress'
    if (state === 'session-lost' || state === 'blocked') return 'guard'
    return 'result'
  }
  const fx: Record<string, string> = {
    'create-failed': 'create-busy',
    'poll-failed': 'create-ok',
    failed: 'create-ok,poll-scan-failed',
    expired: 'create-ok,poll-expired',
    cancelled: 'create-ok,cancel-ok',
    'cancel-race': 'create-ok,cancel-already-completed,poll-completed',
    'cancel-race-unknown': 'create-ok,cancel-already-completed,poll-error',
    'cancel-conflict': 'create-ok,cancel-conflict,poll-waiting',
    'preview-failed': 'create-ok,poll-completed,preview-expired,preview-error',
    'completed-no-file': 'create-ok,poll-completed-nofile',
    'waiting-delivery': 'create-ok,poll-waiting',
    completed: 'create-ok,poll-waiting,poll-completed,preview-ok',
    'preview-ready': 'create-ok,poll-waiting,poll-completed,preview-ok',
  }
  return keys.map((state) => {
    const screen = screenOf(state)
    if (state === 'setup') return { screen, state, axis: 'none', route: '/scan/start', protoQuery: '?capture=1&flat=1' }
    if (state === 'usb-panel') {
      return { screen, state, axis: 'none', route: '/scan/start', protoQuery: '?capture=1&flat=1&mode=usb-panel', waitProtoState: true }
    }
    if (state === 'blocked') {
      return { screen, state, axis: 'none', route: '/scan/start', protoQuery: '?capture=1&flat=1&not-a-real-param=1', waitProtoState: true }
    }
    if (state === 'session-lost') {
      return { screen, state, axis: 'none', route: '/scan/start', protoQuery: '?capture=1&flat=1', protoSessionLost: true, waitProtoState: true }
    }
    const queue = fx[state]
    return {
      screen,
      state,
      axis: 'none',
      route: screen === 'settings' ? '/scan/settings' : screen === 'progress' ? '/scan/progress' : screen === 'result' ? '/scan/result' : '/scan/start',
      protoQuery: queue ? `?capture=1&flat=1&fx=${encodeURIComponent(queue)}` : '?capture=1&flat=1',
      waitProtoState: Boolean(queue),
    }
  })
}

function enumerateFile(file: string): RawPair[] {
  const { html, source } = bundleOf(file)
  const comment = headerComment(html)
  const screenRoutes = headerScreenRoutes(comment)
  const routes = headerRoutes(comment)
  const soleRoute = routes.length === 1 ? routes[0] : null

  let raw: RawPair[] | null = null
  if (file.startsWith('18-')) raw = scanPairs(source)
  else if (file.startsWith('16-')) {
    const hubs = [...source.matchAll(/HUB_ROUTE\s*=\s*\{([^}]+)\}/g)]
    const body = hubs.at(-1)?.[1] ?? ''
    const names = [...body.matchAll(/([a-z]+)\s*:/g)].map((match) => match[1])
    const states = [...source.matchAll(/state=\[([^\]]+)\]\.includes/g)].flatMap((match) => stringsOf(match[1]))
    raw = names.flatMap((screen) => states.map((state) => ({
      screen, state, axis: 'hub' as const, route: null,
    })))
  } else if (file.startsWith('01-')) {
    // member：9/29 补的登录态（W-75，只写「有人登录着」+「结束上一位的使用」）。运行时要真登录，本对照不配种子。
    raw = ['no-context', 'context', 'member'].map((state) => ({ screen: 'main', state, axis: 'state' as const, route: '/' }))
  } else if (file.startsWith('51-')) {
    raw = [
      ...arrayByName(source, 'QR_STATES').map((state) => ({ screen: 'qr-login', state, axis: 'screen' as const, route: '/member/qr-login' })),
      ...arrayByName(source, 'UPLOAD_STATES').map((state) => ({ screen: 'phone-upload', state, axis: 'screen' as const, route: '/upload/phone' })),
    ]
  } else {
    const axis: RawPair['axis'] = source.includes("get('view')") && !source.includes("get('screen')")
      ? 'view'
      : source.includes("KEYPARAM = HOST === 'policy'") && html.includes('data-host="policy"')
        ? 'tab'
        : source.includes("get('screen')") || source.includes('?screen=')
          ? 'screen'
          : 'state'
    const views = lastObject(source, 'VIEWS')
    const screens = lastObject(source, 'SCREENS')
    const pages = lastObject(source, 'PAGES')
    raw = (views && pairsFromEntries(topEntries(views), source, axis))
      || (screens && pairsFromEntries(topEntries(screens), source, 'screen'))
      || (pages && pairsFromEntries(topEntries(pages), source, axis === 'tab' ? 'tab' : 'screen'))
      || null
    if (!raw) {
      const viewList = arrayByName(source, 'VIEWS')
      const stateList = arrayByName(source, 'STATES')
      if (viewList.length > 1 && stateList.length > 1 && source.includes("get('screen')")) {
        raw = viewList.flatMap((screen) => stateList.map((state) => ({ screen, state, axis: 'screen' as const, route: null })))
      } else if (stateList.length > 0) {
        raw = stateList.map((state) => ({ screen: 'main', state, axis: 'state' as const, route: soleRoute }))
      }
    }
    if (!raw) {
      const pipes = headerPipes(comment)
      if (pipes.length > 0) raw = pipes.map((state) => ({ screen: 'main', state, axis: 'state' as const, route: soleRoute }))
    }
    if (!raw) {
      const dataStates = [...new Set([...html.matchAll(/data-state="([a-z0-9-]+)"/g)].map((match) => match[1]))]
      if (dataStates.length > 0) raw = dataStates.map((state) => ({ screen: 'main', state, axis: 'none' as const, route: soleRoute }))
      else raw = [{ screen: 'main', state: 'default', axis: 'none', route: soleRoute }]
    }
  }

  const dw = html.match(/DW_SCREEN\s*=\s*'([a-z0-9-]+)'/)
  if (dw) {
    const pages = lastObject(source, 'PAGES')
    const entry = pages ? topEntries(pages).find((item) => item.key === dw[1]) : undefined
    const states = entry ? fieldArray(entry.body, 'states') : null
    if (states) {
      raw = states.map((state) => {
        const screen = state.startsWith('list-') ? 'list'
          : state.startsWith('agency-') ? 'agency'
            : state.startsWith('job-') ? 'job'
              : state.startsWith('company-') ? 'company'
                : 'main'
        return { screen, state, axis: 'state' as const, route: null }
      })
    }
  }

  if (file.startsWith('29-')) {
    raw = raw.map((pair) => {
      const screen = pair.state.startsWith('reports') ? 'reports'
        : pair.state.startsWith('report') ? 'report'
          : pair.state.startsWith('session') ? 'session'
            : pair.state === 'tips' || pair.state.startsWith('tips-') ? 'tips'
              : 'setup'
      const route = {
        setup: '/interview/setup',
        session: '/interview/session',
        report: '/interview/report',
        tips: '/interview/tips',
        reports: '/interview/reports',
      }[screen]
      return { ...pair, screen, route, axis: 'state' as const }
    })
  }
  if (file.startsWith('34-')) {
    const screenOf = (state: string) => (
      state === 'review' ? 'questions'
        : state === 'ai-down' ? 'result'
          : state
    )
    const routeOfState = (screen: string) => ({
      intro: '/resume/self-assessment/intro',
      questions: '/resume/self-assessment/questions',
      result: '/resume/self-assessment/result',
      history: '/resume/self-assessment/history',
    }[screen] ?? '/resume/self-assessment/intro')
    raw = raw.map((pair) => {
      const screen = screenOf(pair.state)
      return { ...pair, screen, route: routeOfState(screen), axis: 'state' as const }
    })
  }
  if (file.startsWith('10-')) {
    raw = raw.map((pair) => pair.state === 'feature-id-photo' || pair.state === 'feature-not-found'
      ? { ...pair, screen: 'feature', route: pair.state === 'feature-not-found' ? '/print-scan/feature/missing-key' : '/print-scan/feature/id-photo' }
      : pair)
  }

  const fileRoute: Record<string, string> = {
    '00-standby.html': '/screensaver',
    '33-pickup-code.html': '/print/pickup-claim',
  }
  return raw.map((pair) => ({
    ...pair,
    route: pair.route ?? screenRoutes.get(pair.screen) ?? (screenRoutes.size === 0 ? soleRoute : null) ?? fileRoute[file] ?? null,
  }))
}

function canonical(route: string | null): string | null {
  if (!route) return null
  const [pathPart, query] = route.split('?')
  const mapped = CANONICAL_ROUTE[pathPart]
  if (!mapped) return route
  if (!query || mapped.includes('?')) return mapped
  return `${mapped}${mapped.includes('?') ? '&' : '?'}${query}`
}

function findCase(pathPart: string | undefined): W6RouteCase | undefined {
  if (!pathPart) return undefined
  return w6RouteCases.find((item) => item.pattern === pathPart || item.url.split('?')[0] === pathPart)
}

function w6Case(route: string | null): W6RouteCase | undefined {
  if (!route) return undefined
  const raw = route.split('?')[0]
  return findCase(raw) ?? findCase(canonical(route)?.split('?')[0])
}

function runtimeUrlFor(route: string | null): string | null {
  const canon = canonical(route)
  if (!canon || !route) return null
  const raw = route.split('?')[0]
  if (CANONICAL_ROUTE[raw]) return canon
  const hit = w6Case(route)
  if (!hit) return canon
  const extra = route.includes('?') ? route.slice(route.indexOf('?')) : ''
  const base = hit.url.split('?')[0]
  if (!extra) return hit.url
  const own = hit.url.includes('?') ? hit.url.slice(hit.url.indexOf('?') + 1) : ''
  return own ? `${base}?${own}&${extra.slice(1)}` : `${base}${extra}`
}

function directoryRoute(file: string, screen: string): string | null {
  if (file.startsWith('42-')) {
    if (screen === 'list') return '/offline-agencies'
    if (screen === 'agency') return '/offline-agencies/:id'
    if (screen === 'job') return '/jobs/:id/offline'
  }
  if (file.startsWith('43-')) {
    if (screen === 'list' || screen === 'main') return '/companies'
    if (screen === 'company') return '/companies/:id'
  }
  if (file.startsWith('44-')) return '/job-fairs/:id/companies/:companyId'
  // 3.14：稿 45 的运行时宿主换成本机构官方渠道（旧地址只做重定向）。
  if (file.startsWith('45-')) return '/official-channels'
  return null
}

function hubRoute(screen: string): string | null {
  const map: Record<string, string> = {
    resume: '/resume-service',
    jobs: '/jobs-service',
    fairs: '/fairs-service',
    interview: '/interview-service',
    policy: '/policy-service',
  }
  return map[screen] ?? null
}

function isDefaultState(state: string, siblings: string[]): boolean {
  return siblings[0] === state
}

function planOf(file: string, screen: string, state: string, siblings: string[]): { plan: RuntimePlan; reason: string | null; marker: string | null } {
  const priority = priorityPlan(file, screen, state)
  if (priority) return { plan: priority.plan, reason: priority.reason, marker: priority.marker }
  const nn = file.slice(0, 2)
  if (REGISTER_ONLY.has(file)) {
    return { plan: { kind: 'none' }, reason: nn === '36' ? '36 是设计索引页，只登记不截图' : '37 是 32 收银台的旧版，只登记不截图', marker: null }
  }
  if (nn === '28') {
    if (state === 'expired' && screen === 'materials') {
      return { plan: { kind: 'none' }, reason: 'FairMaterialsPage 写明 expired 没有代码路径：后端不下发「链接已过期」', marker: null }
    }
    return { plan: { kind: 'fair' }, reason: null, marker: `[data-testid="fair-${screen}-state-${state}"]` }
  }
  if (nn === '20') {
    return { plan: { kind: 'url' }, reason: null, marker: `[data-testid="sign-stamp-state-${state}"]` }
  }
  if (nn === '22' && REPORT_URL_STATES.has(state)) {
    return { plan: { kind: 'url' }, reason: null, marker: `[data-testid="resume-report-state-${state}"]` }
  }
  if (nn === '23' && screen === 'optimize' && OPTIMIZE_URL_STATES.has(state)) {
    return { plan: { kind: 'url' }, reason: null, marker: `[data-optimize-state="${state}"]` }
  }
  if (nn === '23' && screen === 'compare' && state === siblings[0]) {
    return { plan: { kind: 'w6' }, reason: null, marker: '[data-kiosk-screen="resume-optimize-compare"]' }
  }
  if (nn === '24' && PREVIEW_STATES.has(state)) {
    return { plan: { kind: 'url' }, reason: null, marker: `[data-generate-state="${state}"]` }
  }
  if (nn === '52' && PLAN_URL_STATES.has(state)) {
    return { plan: { kind: 'url' }, reason: null, marker: `[data-kiosk-screen="advisor-artifact"][data-state="${state}"]` }
  }
  if (nn === '05') {
    if (ASSISTANT_DRIVEN.has(state)) {
      return { plan: { kind: 'assistant' }, reason: null, marker: `[data-testid="ai-cockpit-state-${state}"]` }
    }
    return {
      plan: { kind: 'none' },
      reason: '助手运行时不读 ?state=。ai-unavailable 被 not-ai 判定盖住；五个语音态要真实通话相位，chat 拦截造不出来',
      marker: null,
    }
  }
  if (nn === '03') {
    if (state === 'phone-idle' || state === siblings[0]) {
      return { plan: { kind: 'w6' }, reason: null, marker: '[data-kiosk-screen="login"]' }
    }
    if (state === 'phone-code-invalid') {
      return { plan: { kind: 'login-error' }, reason: null, marker: '[data-kiosk-screen="login"] [role="alert"]' }
    }
    return { plan: { kind: 'none' }, reason: '登录页现成种子只有可见默认态和验证码错误；其余要真实短信或二维码票据时序', marker: null }
  }
  if (nn === '13') {
    if (state === 'missing-context') return { plan: { kind: 'desk', seeded: false }, reason: null, marker: 'h2:text-is("这一页没有待处理的文件")' }
    if (state === 'check-clean') return { plan: { kind: 'desk', seeded: true }, reason: null, marker: '[data-print-desk-step="check"]' }
    if (state === 'preview') return { plan: { kind: 'desk', seeded: true }, reason: null, marker: '[data-print-desk-step="preview"]' }
    return { plan: { kind: 'none' }, reason: '打印台运行时只有 ?step=check|preview，现成材料会话种子覆盖不了这一夹具态', marker: null }
  }
  if (nn === '32') {
    if (state === 'no-order') return { plan: { kind: 'w6' }, reason: null, marker: '.qx-state-t:text-is("没有待支付的订单")' }
    if (state === 'pending') return { plan: { kind: 'cashier', variant: 'pending' }, reason: null, marker: '[data-kiosk-screen="print-cashier"], .qx-stage' }
    if (state === 'attempt-failed') return { plan: { kind: 'cashier', variant: 'failed' }, reason: null, marker: '[data-kiosk-screen="print-cashier"], .qx-stage' }
    return { plan: { kind: 'none' }, reason: '收银台现成种子只有无订单、待支付和支付失败', marker: null }
  }
  if (nn === '15') {
    if (state === 'printing') return { plan: { kind: 'progress' }, reason: null, marker: '[data-kiosk-screen="print-progress"], h1' }
    if (state === 'completed') return { plan: { kind: 'done' }, reason: null, marker: '[data-w2-page="print-done"]' }
    return { plan: { kind: 'none' }, reason: '打印进度/完成现成种子只有 printing 与 completed', marker: null }
  }
  if (nn === '10' && (state === 'feature-id-photo' || state === 'feature-not-found')) {
    return { plan: { kind: 'w6' }, reason: null, marker: '[data-w2-page="print-scan-feature"]' }
  }
  if (nn === '18') {
    if (state === 'setup') return { plan: { kind: 'scan-start' }, reason: null, marker: '[data-w2-page="scan-start"]' }
    if (state === 'panel-instruction') return { plan: { kind: 'scan-settings' }, reason: null, marker: '[data-w2-page="scan-settings"]' }
    if (state === 'create-failed') return { plan: { kind: 'scan-create-failed' }, reason: null, marker: '[data-w2-page="scan-settings"], [data-w2-page="scan-start"]' }
    if (state === 'waiting-delivery') return { plan: { kind: 'scan-progress' }, reason: null, marker: '[data-w2-page="scan-progress"]' }
    if (state === 'completed') return { plan: { kind: 'scan-result' }, reason: null, marker: '[data-w2-page="scan-result"]' }
    return { plan: { kind: 'none' }, reason: '扫描稿多数态靠 ?fx= 队列推进；运行时现成种子只覆盖四个阶段的代表态', marker: null }
  }
  if (!isDefaultState(state, siblings)) {
    return { plan: { kind: 'none' }, reason: '这一态没有现成注册器；本轮只给该路由配了默认态', marker: null }
  }
  return { plan: { kind: 'w6' }, reason: null, marker: null }
}

function routeOf(file: string, pair: RawPair): string | null {
  return directoryRoute(file, pair.screen)
    ?? (file.startsWith('16-') ? hubRoute(pair.screen) : null)
    ?? pair.route
}

export function buildQingxuPairs(): QingxuPairTarget[] {
  // 两个目录的并集：v2 里新补的稿（原稿没有的编号）也要进对照。
  const files = [...new Set([...fs.readdirSync(PROTO_DIR), ...fs.readdirSync(PROTO_V2_DIR)])]
    .filter((name) => /^\d{2}-.+\.html$/.test(name) && !name.includes('.proposal.'))
    .sort()
  const targets: QingxuPairTarget[] = []
  for (const file of files) {
    const raw = enumerateFile(file)
    // 稿里画不出、运行页真有的态（目前只登记 45）：配到最接近的稿态上并排看。
    for (const extra of policyPagesExtraPairs(file)) raw.push({ ...extra, axis: 'state' })
    for (const extra of resumePagesExtraPairs(file)) raw.push({ ...extra, axis: 'state' })
    const byScreen = new Map<string, string[]>()
    for (const pair of raw) {
      const list = byScreen.get(pair.screen) ?? []
      list.push(pair.state)
      byScreen.set(pair.screen, list)
    }
    for (const pair of raw) {
      const siblings = byScreen.get(pair.screen) ?? [pair.state]
      const route = routeOf(file, pair)
      const priority = resumePagesPlan(file, pair.screen, pair.state) ?? priorityPlan(file, pair.screen, pair.state) ?? policyPagesPlan(file, pair.screen, pair.state)
      const decided = priority
        ? { plan: priority.plan, reason: priority.reason, marker: priority.marker }
        : planOf(file, pair.screen, pair.state, siblings)
      const runtimeRoute = priority?.runtimePath ?? (decided.plan.kind === 'none' ? route : (
        file.startsWith('24-') && PREVIEW_STATES.has(pair.state) ? '/resume/generate/preview'
          : file.startsWith('23-') && pair.screen === 'compare' ? '/resume/optimize/compare'
            : file.startsWith('22-') ? '/resume/report'
              : file.startsWith('23-') && pair.screen === 'optimize' ? '/resume/optimize'
                : file.startsWith('20-') ? '/print-scan/sign'
                  : file.startsWith('52-') ? '/ai/plan'
                    : file.startsWith('05-') ? '/assistant'
                      : file.startsWith('13-') ? (pair.state === 'preview' ? '/print/desk?step=preview' : '/print/desk?step=check')
                        : file.startsWith('32-') ? '/print/cashier'
                          : file.startsWith('15-') ? (pair.state === 'completed' ? '/print/done' : '/print/progress')
                            : route
      ))
      const hit = w6Case(runtimeRoute)
      const marker = decided.marker ?? hit?.marker ?? null
      const extra: Record<string, string> = {}
      if (file.startsWith('22-') || file.startsWith('23-') || (file.startsWith('24-') && PREVIEW_STATES.has(pair.state))) {
        extra.taskId = 'paircapture01'
      }
      // 07 的带内容态要 fixture=1 才渲染示例订单，不带时一律停在「正在读取」（9/28 留白整改时发现量错了态）。
      if (file.startsWith('07-')) extra.fixture = '1'
      Object.assign(extra, STATE_QUERY[file]?.[pair.state] ?? {})
      targets.push({
        file,
        nn: file.slice(0, 2),
        screen: pair.screen,
        state: pair.state,
        protoQuery: withoutCaptureFor(file, pair.protoQuery ?? queryFor(pair.axis, pair.screen, pair.state, extra)),
        waitProtoState: Boolean(pair.waitProtoState),
        protoSessionLost: Boolean(pair.protoSessionLost),
        route: runtimeRoute,
        runtimeUrl: decided.plan.kind === 'none' ? null : (priority?.runtimePath ?? runtimeUrlFor(runtimeRoute)),
        readyMarker: decided.plan.kind === 'none' ? null : marker,
        capture: !REGISTER_ONLY.has(file),
        missingReason: decided.plan.kind === 'none' ? (decided.reason ?? (runtimeRoute ? '没有现成注册器覆盖这一态' : '稿没有对应运行时路由')) : null,
        plan: decided.plan.kind === 'w6' && !runtimeUrlFor(runtimeRoute)
          ? { kind: 'none' }
          : decided.plan,
      })
      const last = targets.at(-1)
      if (last && last.plan.kind === 'none' && decided.plan.kind === 'w6') {
        last.missingReason = runtimeRoute ? `运行时路由 ${runtimeRoute} 不在现成路由夹具里` : '稿没有对应运行时路由'
        last.runtimeUrl = null
        last.readyMarker = null
      }
    }
  }
  return targets
}

const TASK_ID = 'paircapture01'

function fairOptions(screen: string, state: string): FairApiOptions {
  if (screen === 'list' && state === 'loading') return { list: 'pending' }
  if (screen === 'list' && state === 'empty') return { list: 'empty' }
  if (screen === 'list' && state === 'error') return { list: 'error' }
  if (screen === 'checkin' && (state === 'guide' || state === 'qr')) return { fair: { status: 'ongoing' } }
  if (screen === 'checkin' && state === 'empty') return { fair: { checkinUrl: null } }
  if (screen === 'checkin' && state === 'error') return { list: 'error' }
  if (screen === 'detail' && state === 'loading') return { detail: 'pending' }
  if (screen === 'detail' && state === 'ended') return { fair: { status: 'ended' } }
  if (screen === 'detail' && state === 'unpublished') return { fair: { publishStatus: 'unpublished' } }
  if (screen === 'detail' && state === 'error') return { detail: 'error' }
  if (screen === 'companies' && state === 'loading') return { companies: 'pending' }
  if (screen === 'companies' && state === 'empty') return { companies: 'empty' }
  if (screen === 'companies' && state === 'error') return { companies: 'error' }
  if (screen === 'map' && state === 'index') return { map: 'ok', venueGuide: 'ok' }
  if (screen === 'map' && state === 'empty') return { map: 'empty' }
  if (screen === 'map' && state === 'error') return { map: 'error' }
  if (screen === 'materials' && state === 'empty') return { materials: 'empty' }
  if (screen === 'stats' && state === 'ready') return { stats: 'real' }
  if (screen === 'stats' && state === 'empty') return { stats: 'mock' }
  if (screen === 'stats' && state === 'error') return { stats: 'error' }
  if (screen === 'visit-plan' && state === 'generating') return { visitPlanLatest: 'not-found' }
  if (screen === 'visit-plan' && (state === 'ready' || state === 'ai-unavailable' || state === 'failed')) {
    return { visitPlanLatest: 'not-found' }
  }
  return {}
}

async function seedResumeTask(page: Page): Promise<void> {
  await page.addInitScript((taskId) => {
    window.sessionStorage.setItem(
      'ai-job-print:current-ai-resume',
      JSON.stringify({ taskId, accessToken: 'fixture-access-token' }),
    )
  }, VISIT_PLAN_TASK_ID)
}

async function sendAssistant(page: Page, text: string): Promise<void> {
  const input = page.getByLabel('输入咨询问题')
  await input.click()
  await input.fill(text)
  const keyboardSend = page.getByRole('group', { name: '虚拟键盘' }).getByRole('button', { name: '发送', exact: true })
  if (await keyboardSend.count()) await keyboardSend.click()
  else await page.locator('.assistant-send').click()
}

export async function prepareRuntime(page: Page, api: ApiRouter, target: QingxuPairTarget): Promise<void> {
  const url = target.runtimeUrl
  if (!url || target.plan.kind === 'none') return
  if (target.plan.kind === 'priority') {
    registerEvidenceShell(api)
    await preparePrioritySeed(page, api, target)
    return
  }
  if (target.plan.kind === 'policy-pages') {
    registerEvidenceShell(api)
    await preparePolicyPages(page, api, target)
    return
  }
  if (target.plan.kind === 'resume-pages') {
    registerEvidenceShell(api)
    await prepareResumePages(page, api, target)
    return
  }
  if (target.plan.kind === 'fair') {
    registerFairApi(api, fairOptions(target.screen, target.state))
    if (target.screen === 'visit-plan' && target.state === 'generating') {
      await seedResumeTask(page)
      api.respondWith('GET', `/api/v1/job-fairs/${FAIR_ID}/visit-plan/${VISIT_PLAN_TASK_ID}`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 20_000))
        return { status: 404, json: { error: { code: 'FAIR_VISIT_PLAN_NOT_FOUND', message: '暂无' } } }
      })
    }
    if (target.screen === 'visit-plan' && (target.state === 'ready' || target.state === 'failed' || target.state === 'ai-unavailable')) {
      await seedResumeTask(page)
    }
    if (target.screen === 'visit-plan' && target.state === 'ready') {
      api.respond('GET', `/api/v1/job-fairs/${FAIR_ID}/visit-plan/${VISIT_PLAN_TASK_ID}`, {
        status: 200,
        json: {
          taskId: VISIT_PLAN_TASK_ID,
          status: 'completed',
          mode: 'preparation',
          summary: '按这场已发布的参展名单整理的准备清单。',
          basedOn: { resume: true, fairId: FAIR_ID, fairName: '2026 青岛高校毕业生招聘会', companyCount: 2, positionCount: 3 },
          preparationChecklist: ['带上纸质简历'],
          questionsToAsk: ['这个岗位是否在现场接受咨询'],
          onsiteTips: ['先按展位号看一圈'],
          providerName: 'llm',
        },
      })
    }
    if (target.screen === 'materials' && target.state === 'print-failed') {
      api.respond('POST', `/api/v1/job-fairs/${FAIR_ID}/materials/material-001/print-url`, {
        status: 500,
        json: { error: { code: 'INTERNAL', message: '打印文件生成失败' } },
      })
    }
    if (target.screen === 'visit-plan' && target.state === 'failed') {
      api.respond('POST', `/api/v1/job-fairs/${FAIR_ID}/visit-plan/${VISIT_PLAN_TASK_ID}`, {
        status: 200,
        json: { taskId: VISIT_PLAN_TASK_ID, status: 'failed', failReason: '夹具：本次不产出内容' },
      })
    }
    if (target.screen === 'visit-plan' && target.state === 'ai-unavailable') {
      api.respond('POST', `/api/v1/job-fairs/${FAIR_ID}/visit-plan/${VISIT_PLAN_TASK_ID}`, {
        status: 503,
        json: { error: { code: 'AI_NOT_CONFIGURED', message: '参会准备单当前不可用' } },
      })
    }
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    if (target.screen === 'list' && target.state === 'favorites-empty') {
      const chip = page.getByRole('button', { name: /只看收藏/ })
      await chip.waitFor({ timeout: 8_000 })
      await chip.click()
    }
    if (target.screen === 'checkin' && target.state === 'qr') {
      const button = page.getByRole('button', { name: '扫码签到' })
      await button.waitFor({ timeout: 8_000 })
      await button.click()
    }
    if (target.screen === 'materials' && target.state === 'print-failed') {
      const button = page.getByRole('button', { name: /去打印/ }).first()
      await button.waitFor({ timeout: 8_000 })
      await button.click()
    }
    if (target.screen === 'visit-plan' && (target.state === 'failed' || target.state === 'ai-unavailable')) {
      const button = page.getByTestId('fair-visit-plan-generate')
      await button.waitFor({ timeout: 8_000 })
      await button.click()
    }
    return
  }

  registerEvidenceShell(api)
  if (target.plan.kind === 'login-error') {
    await openLoginVerificationError(page, api)
    return
  }
  if (target.plan.kind === 'desk') {
    if (!target.plan.seeded) {
      await page.goto(url, { waitUntil: 'domcontentloaded' })
      return
    }
    await seedPrintFlow(page, url.includes('preview') ? '/print/desk?step=preview' : '/print/desk?step=check')
    return
  }
  if (target.plan.kind === 'cashier') {
    if (target.plan.variant === 'pending') await seedCashierPending(page, api)
    else await seedCashierFailed(page, api)
    return
  }
  if (target.plan.kind === 'progress') {
    await seedPrintProgress(page, api)
    return
  }
  if (target.plan.kind === 'done') {
    await seedPrintDoneCompleted(page, api)
    return
  }
  if (target.plan.kind === 'scan-start') {
    await page.goto('/scan?stage=start', { waitUntil: 'domcontentloaded' })
    return
  }
  if (target.plan.kind === 'scan-settings') {
    await page.goto('/scan?stage=settings', { waitUntil: 'domcontentloaded' })
    return
  }
  if (target.plan.kind === 'scan-create-failed') {
    await openScanSettingsCreateFailed(page, api)
    return
  }
  if (target.plan.kind === 'scan-progress') {
    await seedScanProgress(page, api)
    return
  }
  if (target.plan.kind === 'scan-result') {
    api.respond('GET', '/api/v1/scan/sessions/w2-scan-001', {
      status: 200,
      json: { success: true, data: { scanTaskId: 'w2-scan-001', status: 'completed', scanType: 'resume', file: null, errorCode: null, errorMessage: null } },
    })
    await page.goto('/scan?stage=start', { waitUntil: 'domcontentloaded' })
    await writeScanWorkbenchSession(page, {
      stage: 'result',
      scanType: 'resume',
      result: {
        outcome: 'completed',
        success: true,
        file: { fileId: 'scan-file-001', fileUrl: '/api/v1/files/scan-file-001/content', name: '扫描件.pdf', size: '120 KB', pages: 1, format: 'pdf', mimeType: 'application/pdf' },
      },
    })
    await page.goto('/scan?stage=result', { waitUntil: 'domcontentloaded' })
    return
  }
  if (target.plan.kind === 'assistant') {
    if (target.state === 'submitting') {
      api.respondWith('POST', '/api/v1/assistant/chat', async () => {
        await new Promise((resolve) => setTimeout(resolve, 20_000))
        return { status: 200, json: assistantReply }
      })
    } else if (target.state === 'reply-real') {
      api.respond('POST', '/api/v1/assistant/chat', { status: 200, json: assistantReply })
    } else if (target.state === 'reply-not-ai') {
      api.respond('POST', '/api/v1/assistant/chat', { status: 200, json: assistantMockFallbackReply })
    } else if (target.state === 'reply-error') {
      api.abort('POST', '/api/v1/assistant/chat', 'internetdisconnected')
    }
    await page.goto('/assistant', { waitUntil: 'domcontentloaded' })
    if (target.state === 'composer') {
      await page.getByLabel('输入咨询问题').fill('如何整理项目经历')
      return
    }
    if (target.state !== 'default') await sendAssistant(page, '如何整理项目经历')
    return
  }
  if (target.plan.kind === 'url') {
    const params = new URLSearchParams()
    params.set('state', target.state)
    params.set('capture', '1')
    if (target.file.startsWith('22-') || target.file.startsWith('23-') || target.file.startsWith('24-')) {
      params.set('taskId', TASK_ID)
    }
    const pathPart = url.split('?')[0]
    await page.goto(`${pathPart}?${params.toString()}`, { waitUntil: 'domcontentloaded' })
    return
  }

  const hit = w6Case(target.route)
  if (hit?.seed) await hit.seed(page)
  if (hit?.requiresMemberSession) await loginThroughVisibleUi(page, url.split('?')[0])
  else await page.goto(url, { waitUntil: 'domcontentloaded' })
  if (target.file.startsWith('10-') && target.state === 'feature-id-photo') {
    await page.goto('/print-scan/feature/id-photo', { waitUntil: 'domcontentloaded' })
  }
}

export function markerSeen(page: Page, marker: string | null): Promise<boolean> {
  if (!marker) return Promise.resolve(false)
  const parts = marker.split(',').map((item) => item.trim()).filter(Boolean)
  return (async () => {
    for (const part of parts) {
      if (await page.locator(part).count()) return true
    }
    return false
  })()
}

// 供本文件直接 node 枚举核对，不参与 Playwright。
if (process.argv.includes('--list')) {
  const pairs = buildQingxuPairs()
  const by = new Map<string, QingxuPairTarget[]>()
  for (const pair of pairs) {
    const list = by.get(pair.file) ?? []
    list.push(pair)
    by.set(pair.file, list)
  }
  for (const [file, list] of by) {
    const screens = new Set(list.map((item) => item.screen))
    const planned = list.filter((item) => item.plan.kind !== 'none').length
    console.log(`${file}  screens=${screens.size} pairs=${list.length} planned=${planned} screens=${[...screens].join(',')}`)
  }
  console.log(`TOTAL ${pairs.length}`)
  const fair = pairs.filter((item) => item.nn === '28')
  const sign = pairs.filter((item) => item.nn === '20')
  if (new Set(fair.map((item) => item.screen)).size !== 8 || fair.length !== 33) {
    console.error(`28 expected 8 screens / 33 states, got ${new Set(fair.map((item) => item.screen)).size} / ${fair.length}`)
    process.exitCode = 1
  }
  if (sign.length !== 63) {
    console.error(`20 expected 63 states, got ${sign.length}`)
    process.exitCode = 1
  }
}
