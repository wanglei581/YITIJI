import type { CopyJobView } from '../../services/api/copyJobs'
import type { CopySession } from './copySession'

export function copySheetCount(pages: number, copies: number, duplex: string): number {
  return (duplex === 'simplex' ? pages : Math.ceil(pages / 2)) * copies
}
export function copyPriceLabel(amountCents: number | null | undefined): string {
  if (amountCents === 0) return '本机构免费'
  return Number.isSafeInteger(amountCents) && Number(amountCents) > 0 ? `¥${(Number(amountCents) / 100).toFixed(2)}` : '报价暂时无法确认'
}
export function validCopyJob(job: CopyJobView, session: CopySession): boolean {
  return job.copyId === session.copyId && job.terminalId === session.input.terminalId && job.generation === session.generation
    && Number.isSafeInteger(job.pageCount) && job.pageCount > 0 && Date.parse(job.expiresAt) > Date.now()
    && Number.isSafeInteger(job.authorizationVersion) && job.authorizationVersion > 0
    && job.source === session.input.source && job.copies === session.input.copies
    && job.colorMode === session.input.colorMode && job.duplex === session.input.duplex
}
/** 复印没有自己的价目行（11/08 计费口径）：报价键就是同色打印的键，后端 readPrintUnitPrice 与打印共用。 */
export function copyQuoteServiceKey(colorMode: string): 'print_color_page' | 'print_bw_page' {
  return colorMode === 'color' ? 'print_color_page' : 'print_bw_page'
}
export function canConfirmCopy(job: CopyJobView | null): boolean {
  if (!job || job.state !== 'scanned' || !job.quote || !/^[a-f0-9]{64}$/.test(job.quoteVersion ?? '') || job.quoteError) return false
  const q = job.quote
  return q.amountCents === 0 && q.unitCents === 0 && q.pageCount === job.pageCount && q.copies === job.copies
    && q.serviceKey === copyQuoteServiceKey(job.colorMode)
    && q.duplex === job.duplex && q.colorMode === job.colorMode && q.billableSides === job.pageCount * job.copies
}
/** 复印与打印共用三条免费额度：确认时超额回 429，错误码与打印相同，只按码判断，不读文案。 */
export const COPY_QUOTA_CODES = ['PRINT_TERMINAL_DAILY_QUOTA_REACHED', 'PRINT_MEMBER_DAILY_QUOTA_REACHED', 'PRINT_GUEST_ORDER_QUOTA_EXCEEDED'] as const
export type CopyQuotaCode = typeof COPY_QUOTA_CODES[number]
export function copyQuotaCode(code: string | null | undefined): CopyQuotaCode | null {
  return COPY_QUOTA_CODES.find((item) => item === code) ?? null
}
/** 只认 details.limit 为正整数；拿不到就不写面数。 */
export function copyQuotaLimit(error: unknown): number | null {
  const details = error && typeof error === 'object' && 'details' in error ? (error as { details?: unknown }).details : undefined
  const limit = details && typeof details === 'object' && 'limit' in details ? (details as { limit?: unknown }).limit : undefined
  return typeof limit === 'number' && Number.isSafeInteger(limit) && limit > 0 ? limit : null
}
export type CopyDevicePhase = 'starting' | 'scan' | 'more' | 'finishing' | 'check' | 'confirmed' | 'stopped' | 'unknown'
  | 'printing' | 'done' | 'unconfirmed' | 'error' | 'off' | 'quota'
export function copyPhaseFromLocal(state: string, source: string): CopyDevicePhase {
  if (state === 'starting') return 'starting'
  if (state === 'scanning') return 'scan'
  if (state === 'page_ready') return source === 'flatbed' ? 'more' : 'finishing'
  if (state === 'composing' || state === 'scanned') return 'finishing'
  return 'unknown'
}
