import { isRegisteredScreen, type PrintConfirmScreen } from './printConfirmQuery'

export type { PrintConfirmScreen }

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
  quoted: { tone: 'unknown', label: '等待服务端报价确认' },
  'quote-failed': { tone: 'bad', label: '报价失败 · 未建单' },
  'capability-invalid-params': { tone: 'bad', label: '打印参数暂不可用' },
  'benefit-unverified': { tone: 'warn', label: '权益未核销 · 按原价' },
  'zero-amount': { tone: 'unknown', label: '零元单 · 仍须先建单' },
}

export const ASK: Record<PrintConfirmScreen, { title: string; doing: string }> = {
  'missing-context': {
    title: '这一页没有任务。',
    doing: '没有选好的文件和参数，我没法要价。回上一步重新走一遍。',
  },
  'invalid-context': {
    title: '这一单没法确认。',
    doing: '交接内容没通过登记核对：我不猜是哪一份文件，也不会退回默认那一份。',
  },
  quoting: {
    title: '正在计算本次费用。',
    doing: '金额确认前不会创建订单，也不会扣款。金额和计费页数都由服务端返回。',
  },
  quoted: {
    title: '这笔多少钱，服务端说了算。',
    doing: '金额和计费页数都由服务端返回。本机不估价、不打折、不替你承诺优惠。',
  },
  'quote-failed': {
    title: '暂时无法获取报价。',
    doing: '文件和参数已保留，本次没有创建订单。',
  },
  'capability-invalid-params': {
    title: '这些参数暂不可用。',
    doing: '请改为黑白、单面后重新获取报价。参数已按本机已验证能力收口。',
  },
  'benefit-unverified': {
    title: '核销没通过时按原价显示。',
    doing: '本机不会先按抵扣后的价格显示。没核销过就按服务端原价走。',
  },
  'zero-amount': {
    title: '零元单也要先建单。',
    doing: '确认后仍会创建打印订单，再进入打印流程。不存在不建单直接出纸的路径。',
  },
}

export type QuoteView =
  | { status: 'demo' }
  | { status: 'loading' }
  | { status: 'ready'; amountCents: number; billablePages: number; unitCents: number; quantity: number }
  | { status: 'unavailable'; reason: string }

export function derivePrintConfirmScreen(input: {
  queryInvalid: boolean
  requestedState: string | null
  hasFile: boolean
  paramsWereRestricted: boolean
  quote: QuoteView
  benefitsError: boolean
}): PrintConfirmScreen {
  if (input.queryInvalid || input.requestedState === 'invalid-context') return 'invalid-context'
  if (input.requestedState !== null && input.requestedState !== '' && !isRegisteredScreen(input.requestedState)) {
    return 'invalid-context'
  }
  if (!input.hasFile) return 'missing-context'
  if (input.paramsWereRestricted) return 'capability-invalid-params'
  if (input.quote.status === 'loading' || input.quote.status === 'demo') return 'quoting'
  if (input.quote.status === 'unavailable') return 'quote-failed'
  if (input.quote.status === 'ready' && input.quote.amountCents === 0) return 'zero-amount'
  if (input.quote.status === 'ready' && input.benefitsError) return 'benefit-unverified'
  return 'quoted'
}
