// ============================================================
// 付款屏（稿 pay-1113.js 的 pay-service）：路由参数白名单、屏上句子、每一态的顶栏与底栏。
// 不发请求、不读存储，单测与页面共用。
//
// 句子出处：稿 pay-1113.js 26–32 行通用句、213–219 行服务名与 TRIP、571–647 行付款屏。
// 与稿不同的只有三处，都是裁决定的：
//   1. 渠道照实写：wechat「请用微信扫这张码」，sandbox「测试支付通道 · 非真实收款」，不照抄稿里两家渠道并列的那句。
//   2. 简历 TRIP 句：运行页没有「对照岗位、换写法」，写「这一趟的改写都包含」。
//   3. 金额用建单返回的 amountCents，不是稿里的演示价。
// 稿里没有句子的情形（退款中、出不了码）只用稿里已有的说法和 copy/unattendedCopy.ts 的标准句拼。
// ============================================================
import type { ServiceOrderKey } from '@ai-job-print/shared'
import { helpNeededLine } from '../../copy/unattendedCopy'
import type { ServiceOrderPhase } from '../../services/api/serviceOrders'
import { errorCodeOf, userMessageOf } from '../../services/api/userErrorMessage'

export type PayWhat = 'resume' | 'interview' | 'scan'

export const PAY_SERVICE_KEY: Record<PayWhat, ServiceOrderKey> = {
  resume: 'resume_optimize',
  interview: 'mock_interview',
  scan: 'scan',
}

/** 稿 213 行。服务单视图里也有 serviceName，读不到时用这里的。 */
export const PAY_SERVICE_NAME: Record<PayWhat, string> = {
  resume: 'AI 简历优化',
  interview: 'AI 模拟面试',
  scan: '扫描',
}

/**
 * 付成后去哪（next）、返回去哪（back）。只认表里的名字，地址都是站内固定路径；
 * 查不到的名字用第一项，绝不把查询串里的地址原样拿去跳。
 */
const PAY_TARGETS: Record<PayWhat, { next: Readonly<Record<string, string>>; back: Readonly<Record<string, string>> }> = {
  resume: {
    next: { optimize: '/resume/optimize', compare: '/resume/optimize/compare' },
    back: { report: '/resume/report' },
  },
  interview: {
    next: { setup: '/interview?stage=setup' },
    back: { setup: '/interview?stage=setup' },
  },
  scan: {
    next: { settings: '/scan?stage=settings', device: '/scan?stage=device-settings' },
    back: { how: '/scan?stage=how' },
  },
}

function pick(table: Readonly<Record<string, string>>, name: string | null): string {
  if (name && Object.prototype.hasOwnProperty.call(table, name)) return table[name] as string
  return Object.values(table)[0] as string
}

/** 付款屏地址。next / back 给表里的名字；不给就用第一项。 */
export function payServicePath(what: PayWhat, options?: { next?: string; back?: string }): string {
  const query = new URLSearchParams()
  if (options?.next) query.set('next', options.next)
  if (options?.back) query.set('back', options.back)
  const search = query.toString()
  return `/pay/${what}${search ? `?${search}` : ''}`
}

export function resolvePayTargets(what: PayWhat, search: string): { next: string; back: string } {
  const query = new URLSearchParams(search)
  return {
    next: pick(PAY_TARGETS[what].next, query.get('next')),
    back: pick(PAY_TARGETS[what].back, query.get('back')),
  }
}

// ── 句子 ────────────────────────────────────────────────────────────────

const CHANNEL = '到账时间以支付渠道为准'
export const PAY_BACK = `自动退回原付款账户，${CHANNEL}`
export const PAY_TIMEOUT_FULL = `没收到这一次的钱；万一已经扣了，会${PAY_BACK}。`
export const PAY_WAIT_BACK = `返回后，万一已经付了，会${PAY_BACK}。`
export const PAY_CHECK_LINE = '正在向支付渠道核实这一次的结果。这一次还没有确认到账。'

export const PAY_TRIP: Record<PayWhat, string> = {
  resume: '付一次管这一趟：这一趟的改写都包含，不再另收费。打印另按页计价。',
  interview: '付一次管这一趟：这一场练习包含，不再另收费。',
  scan: '付一次管这一趟：这一次扫描包含，不再另收费。打印另按页计价。',
}

const MISS: Record<PayWhat, string> = { resume: '没生成出来', interview: '没练成', scan: '没扫成' }

export function payMissLine(what: PayWhat): string {
  return `要是${MISS[what]}，可以免费再试一次；不试了或再不成，钱${PAY_BACK}。`
}

/** 稿 619 行：服务名以 A 开头时前面空一格。 */
export function payFailLine(name: string): string {
  const gap = name.startsWith('A') ? ' ' : ''
  return `钱没有扣。没付成就不会开始${gap}${name}。可以再出一张码，或返回。返回之后这一次还没开始。`
}

export const PAY_TIMEOUT_LINE = `${PAY_TIMEOUT_FULL}可以再出一张码，或返回。`

/** 退款几态（稿里没有）：用稿的退回句，退款卡住时补标准句 1。 */
export function payRefundLine(phase: ServiceOrderPhase | null): string {
  if (phase === 'refunded') return `这一次没有开始。钱已经退回原付款账户，${CHANNEL}。可以再出一张码，或返回。`
  if (phase === 'refund_failed') return `这一次没有开始。钱会退回原付款账户，${CHANNEL}。${helpNeededLine()}。可以再出一张码，或返回。`
  return `这一次没有开始。钱${PAY_BACK}。可以再出一张码，或返回。`
}

/**
 * 没出成码时的一句（裁决第 10 条：用无人值守标准句）。没有单，所以钱没有扣。
 * 没有收款通道时不用打印那句「请改用其他支付方式」：这一项只收线上，换不了方式。
 */
export function payCreateErrorLine(error: unknown): string {
  if (errorCodeOf(error) === 'ONLINE_PAYMENT_DISABLED') return `这台机器暂时不能收款，这一项现在办不了。${helpNeededLine()}。`
  return userMessageOf(error, `这一次暂时出不了付款码。${helpNeededLine()}。`)
}

/** 本机记着一张单却查不到它（多半是网络）：不说钱扣没扣，只说离开以后万一付了会退。 */
export function payLookupErrorLine(error: unknown): string {
  const reason = userMessageOf(error, '暂时查不到这一次的付款结果，可以稍后再查一次。')
  return `${reason.replace(/[。.]?$/, '。')}${PAY_WAIT_BACK}`
}

/** 渠道照实写（裁决第 1 条）。 */
export function payChannelHead(provider: string | null | undefined): string {
  if (provider === 'wechat') return '请用微信扫这张码'
  if (provider === 'sandbox') return '测试支付通道 · 非真实收款'
  return '请扫这张码'
}

export function formatYuan(cents: number): string {
  return `${(cents / 100).toFixed(2)} 元`
}

/** 剩余时间写成「m:ss」，和稿「还剩 5:00」同一种写法。 */
export function formatRemain(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

// ── 每一态的顶栏、底栏 ──────────────────────────────────────────────────

/** error：没出成码（没有单，钱没有扣）。lookup：本机记着一张单，但这会儿查不到它的结果。 */
export type PayScreen = 'loading' | 'wait' | 'check' | 'ok' | 'fail' | 'timeout' | 'refund' | 'free' | 'error' | 'lookup'

export interface PayChrome {
  eyebrow: string
  title: string
  sub?: string
  status: { text: string; tone: 'ok' | 'warn' | 'reading' }
  /** 左键：close 是关单后返回，back 是只返回，null 不画。 */
  left: { label: string; close: boolean } | null
  ask: boolean
  primary: string
}

export function payChrome(screen: PayScreen, name: string, refundPhase: ServiceOrderPhase | null = null): PayChrome {
  const eyebrow = `这一次 · ${name}`
  const abort = { label: '不付了，返回', close: true }
  const leave = { label: '返回', close: false }
  switch (screen) {
    case 'loading':
      return { eyebrow, title: '请完成这一次支付', sub: '正在出这一次的付款码', status: { text: '正在出码', tone: 'reading' }, left: leave, ask: true, primary: '刷新付款结果' }
    case 'wait':
    case 'check':
      return { eyebrow, title: '请完成这一次支付', sub: '付好了才会开始', status: { text: '付好了才会开始', tone: 'ok' }, left: abort, ask: true, primary: '刷新付款结果' }
    case 'ok':
      return { eyebrow, title: '付好了，马上开始', sub: '这一次已经付好', status: { text: '这一次已经付好', tone: 'ok' }, left: leave, ask: true, primary: '马上开始' }
    case 'fail':
      return { eyebrow, title: '这次没付成', sub: '没付成，钱没有扣', status: { text: '没付成，钱没有扣', tone: 'warn' }, left: abort, ask: true, primary: '再出一张码' }
    case 'timeout':
      return { eyebrow, title: '等了 5 分钟，这一次没有付成', sub: '没收到这一次的钱', status: { text: '没收到这一次的钱', tone: 'warn' }, left: abort, ask: true, primary: '再出一张码' }
    case 'refund': {
      const sub = refundPhase === 'refunded' ? '钱已经退回' : '钱会退回原付款账户'
      return { eyebrow, title: '这一次没有开始', sub, status: { text: sub, tone: 'warn' }, left: leave, ask: true, primary: '再出一张码' }
    }
    case 'free':
      return { eyebrow: '这一次', title: '这台机器这项服务免费，不用付款', status: { text: '不收费', tone: 'ok' }, left: null, ask: false, primary: '马上开始' }
    case 'lookup':
      return { eyebrow, title: '暂时查不到这一次的付款结果', sub: '先别重复付款', status: { text: '先别重复付款', tone: 'warn' }, left: leave, ask: true, primary: '再查一次' }
    case 'error':
    default:
      return { eyebrow, title: '这一次暂时出不了付款码', sub: '没有出码，钱没有扣', status: { text: '没有出码，钱没有扣', tone: 'warn' }, left: leave, ask: true, primary: '再试一次' }
  }
}

/** 服务单阶段 → 付款屏的哪一态。待付与核实由调用方再按本地时间和核实标记细分。 */
export function screenForPhase(phase: ServiceOrderPhase): PayScreen | 'renew' {
  switch (phase) {
    case 'awaiting':
      return 'wait'
    case 'checking':
      return 'check'
    case 'paid':
    case 'retry_free':
    case 'in_use':
    case 'done':
      return 'ok'
    case 'not_paid':
      return 'fail'
    case 'timed_out':
      return 'timeout'
    case 'refunding':
    case 'refunded':
    case 'refund_failed':
    case 'retry_expired':
      return 'refund'
    case 'closed':
    default:
      // 自己取消、清场、出码失败关掉的单：作废，再建一张。
      return 'renew'
  }
}

/** 本机价目里这一项是不是 0 元（公共就业点位、总开关关闭、机构付均算免费）。读不到、读不准都不算免费，照常建单。 */
export function pricingSaysFree(config: unknown, serviceKey: ServiceOrderKey): boolean {
  if (!config || typeof config !== 'object') return false
  const pricing = (config as { pricing?: unknown }).pricing
  if (!pricing || typeof pricing !== 'object') return false
  const record = pricing as {
    isPublicSite?: unknown
    personalChargeEnabled?: unknown
    userChargeMode?: unknown
    effective?: unknown
  }
  if (record.isPublicSite === true) return true
  if (record.personalChargeEnabled === false) return true
  if (record.userChargeMode === 'org_pays') return true
  const effective = record.effective
  if (!effective || typeof effective !== 'object') return false
  const value = (effective as Record<string, unknown>)[serviceKey]
  return typeof value === 'number' && Number.isInteger(value) && value === 0
}
