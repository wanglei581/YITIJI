/** 屏上复印只保存履约元数据；不包含文件、路径、内容或控制令牌。 */
export const COPY_JOB_STATES = [
  'ready', 'scanning', 'page_ready', 'scanned', 'confirmed',
  'dispatching', 'spooled', 'handed', 'unconfirmed', 'cancelled', 'expired', 'failed',
] as const
export type CopyJobState = (typeof COPY_JOB_STATES)[number]
export const COPY_SOURCES = ['flatbed', 'feeder'] as const
export type CopySource = (typeof COPY_SOURCES)[number]
export const COPY_COLOR_MODES = ['black_white', 'color'] as const
export type CopyColorMode = (typeof COPY_COLOR_MODES)[number]
export const COPY_DUPLEX_MODES = ['simplex', 'duplex_long_edge', 'duplex_short_edge'] as const
export type CopyDuplex = (typeof COPY_DUPLEX_MODES)[number]
export const COPY_PRICE_KEYS = ['copy_bw_page', 'copy_color_page'] as const
export type CopyPriceKey = (typeof COPY_PRICE_KEYS)[number]

export interface CopyPriceInput {
  pageCount: number
  copies: number
  colorMode: CopyColorMode
  duplex: CopyDuplex
}

export interface CopyPriceRow {
  serviceKey: string
  active: boolean
  unit: string
  unitCents: number
}

/** quoteSnapshot 序列化后的白名单内容；无文件与内容标识。 */
export interface CopyPriceQuote {
  serviceKey: CopyPriceKey
  unitCents: number
  pageCount: number
  copies: number
  colorMode: CopyColorMode
  duplex: CopyDuplex
  billableSides: number
  amountCents: number
}

export type CopyQuoteResult =
  | { quotable: true; quote: CopyPriceQuote }
  | { quotable: false; code: 'COPY_PRICE_UNAVAILABLE' | 'COPY_PRICE_INVALID' | 'COPY_INVALID_PARAMETERS' }

/** cs-copy-set 的份数步进器与钳位均为 1–99。 */
export const COPY_MAX_COPIES = 99
export type CopyPrintResultState = 'handed' | 'failed' | 'unconfirmed'
export interface CreateCopyJobInput {
  terminalId: string
  requestKey: string
  source: CopySource
  copies: number
  colorMode: CopyColorMode
  duplex: CopyDuplex
}
export interface CopyJobView extends CopyPriceInput {
  copyId: string
  terminalId: string
  source: CopySource
  state: CopyJobState
  generation: number
  authorizationVersion: number
  expiresAt: string
  orderId: string | null
  resultCode: string | null
  quote: CopyPriceQuote | null
  quoteVersion: string | null
  quoteError: string | null
}
/** 非签名材料；Agent 每次派发前在线查证，并在本机按单号/代次持久化至多一次派发。 */
export interface CopyPermit {
  allowed: boolean
  reason: string | null
  copyId: string
  op: 'scan' | 'print'
  generation: number
  authorizationVersion: number
  expiresAt: string
  parameters: CopyPriceInput & { source: CopySource; maxPages: number; maxCopies: number }
}
