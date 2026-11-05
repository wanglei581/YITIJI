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
export function canConfirmCopy(job: CopyJobView | null): boolean {
  if (!job || job.state !== 'scanned' || !job.quote || !/^[a-f0-9]{64}$/.test(job.quoteVersion ?? '') || job.quoteError) return false
  const q = job.quote
  return q.amountCents === 0 && q.unitCents === 0 && q.pageCount === job.pageCount && q.copies === job.copies
    && q.serviceKey === (job.colorMode === 'color' ? 'copy_color_page' : 'copy_bw_page')
    && q.duplex === job.duplex && q.colorMode === job.colorMode && q.billableSides === job.pageCount * job.copies
}
export type CopyDevicePhase = 'starting' | 'scan' | 'more' | 'finishing' | 'check' | 'confirmed' | 'stopped' | 'unknown'
export function copyPhaseFromLocal(state: string, source: string): CopyDevicePhase {
  if (state === 'starting') return 'starting'
  if (state === 'scanning') return 'scan'
  if (state === 'page_ready') return source === 'flatbed' ? 'more' : 'finishing'
  if (state === 'composing' || state === 'scanned') return 'finishing'
  return 'unknown'
}
