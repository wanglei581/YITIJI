import { isRegisteredScreen, type PrintConfirmScreen as RegisteredScreen } from './printConfirmQuery'

/**
 * 确认页的屏。地址栏能登记的只有 printConfirmQuery 那 8 个；`ordered`（这一份已经建过单）
 * 只由交接上下文的建单标记进入，不能从地址栏指定。
 */
export type PrintConfirmScreen = RegisteredScreen | 'ordered'

export const COLOR_MODE_LABEL: Record<string, string> = {
  black_white: '黑白',
  color: '彩色',
}

export const DUPLEX_LABEL: Record<string, string> = {
  simplex: '单面',
  duplex_long_edge: '双面（长边翻转）',
  duplex_short_edge: '双面（短边翻转）',
}

export const ORIENTATION_LABEL: Record<string, string> = {
  auto: '自动',
  portrait: '纵向',
  landscape: '横向',
}

export const PILL: Record<PrintConfirmScreen, { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }> = {
  'missing-context': { tone: 'warn', label: '没有待确认的任务' },
  'invalid-context': { tone: 'bad', label: '交接内容未通过核对' },
  quoting: { tone: 'unknown', label: '正在计算本次费用' },
  quoted: { tone: 'ok', label: '报价已返回 · 请核对' },
  'quote-failed': { tone: 'bad', label: '报价失败 · 未建单' },
  // 9/29 定稿（稿 14）：本机没开通的彩色 / 双面不再拦截，按能打的参数照常报价。状态键不改。
  'capability-invalid-params': { tone: 'warn', label: '已按本机能用的参数报价' },
  'benefit-unverified': { tone: 'warn', label: '权益未核销 · 按原价' },
  'zero-amount': { tone: 'ok', label: '免费试运营 · 本单 0 元' },
  ordered: { tone: 'ok', label: '这一单已提交' },
}

/**
 * 稿 14 小青区：标题分三段 [前, 强调, 后]，强调段按稿渲染成翡翠色 <em>；拼起来就是整句。
 * doing 是一句话说明本屏在做什么，只描述本机已经知道的事实，不预告任何金额。
 * 有真实报价时说「以实际结果为准」；静态稿里的「排版演示」三屏不会出现在这一页。
 */
export const ASK: Record<PrintConfirmScreen, { title: readonly [string, string, string]; doing: string }> = {
  'missing-context': {
    title: ['这一页', '没有任务', '。'],
    doing: '没有选好的文件和参数，我没法要价。回上一步重新走一遍。',
  },
  'invalid-context': {
    title: ['这一单', '没法确认', '。'],
    doing: '交接内容没通过登记核对：我不猜是哪一份文件，也不会退回默认那一份。',
  },
  quoting: {
    title: ['先看', '价格', '，再决定。'],
    doing: '核对打印内容与费用，确认后再付款、领取打印件。',
  },
  quoted: {
    title: ['这笔', '多少钱', '，以实际结果为准。'],
    doing: '金额和计费页数都以这一单的报价为准。优惠券不在这一页抵扣。',
  },
  'quote-failed': {
    title: ['暂时', '无法获取报价', '。'],
    doing: '文件和参数已保留，本次没有创建订单。',
  },
  'capability-invalid-params': {
    title: ['已按', '本机能用的参数', '报价。'],
    doing: '本机暂未开通的项已改成能打的参数。价格以这组参数为准。',
  },
  'benefit-unverified': {
    title: ['核销没通过时', '按原价', '显示。'],
    doing: '本机不会先按抵扣后的价格显示。没核销过就按原价走。',
  },
  'zero-amount': {
    title: ['免费试运营，', '本单 0 元', '。'],
    doing: '这次不用付款。确认后直接开始打印，纸从出纸口出来。',
  },
  ordered: {
    title: ['这一单', '已经提交', '。'],
    doing: '同一份文件不会再建第二单。要改参数或换文件，请重新发起打印。',
  },
}

export type QuoteView =
  | { status: 'demo' }
  | { status: 'loading' }
  | { status: 'ready'; amountCents: number; billablePages: number; unitCents: number; quantity: number }
  | { status: 'unavailable'; reason: string; code?: string }

export function derivePrintConfirmScreen(input: {
  queryInvalid: boolean
  requestedState: string | null
  hasFile: boolean
  /** 交接失效（归属不符、过期、被替换、写不进……）：不猜是哪一份。 */
  handoffInvalid: boolean
  /** 这一份交接已经建过单：只看状态，不能再建第二单。 */
  ordered: boolean
  /** 本机能力还在加载、而参数里有彩色或双面：先别报价。 */
  waitingCapability: boolean
  /** 参数已按本机能力改过（不拦截，按改后的参数报价并逐项说明）。 */
  adjusted: boolean
  quote: QuoteView
  benefitsError: boolean
}): PrintConfirmScreen {
  if (input.queryInvalid || input.requestedState === 'invalid-context') return 'invalid-context'
  if (input.requestedState !== null && input.requestedState !== '' && !isRegisteredScreen(input.requestedState)) {
    return 'invalid-context'
  }
  if (input.handoffInvalid) return 'invalid-context'
  if (!input.hasFile) return 'missing-context'
  if (input.ordered) return 'ordered'
  if (input.waitingCapability) return 'quoting'
  if (input.quote.status === 'loading' || input.quote.status === 'demo') return 'quoting'
  if (input.quote.status === 'unavailable') return 'quote-failed'
  if (input.adjusted) return 'capability-invalid-params'
  if (input.quote.status === 'ready' && input.quote.amountCents === 0) return 'zero-amount'
  if (input.quote.status === 'ready' && input.benefitsError) return 'benefit-unverified'
  return 'quoted'
}

/** 哪些屏的主按钮能建单。参数被收口（capability-invalid-params）照常可点：用户按下就是对屏上价格的确认。 */
export function confirmScreenAllowsOrder(screen: PrintConfirmScreen): boolean {
  return screen === 'quoted' || screen === 'capability-invalid-params' || screen === 'zero-amount' || screen === 'benefit-unverified'
}
