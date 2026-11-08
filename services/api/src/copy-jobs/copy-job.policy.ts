import { HttpException } from '@nestjs/common'
import { SCAN_DEVICE_OTHER_MAX_PAGES } from '../files/file-validation'
import { COPY_MAX_COPIES, type CopyPriceInput } from './copy-job.types'

export const COPY_MAX_PAGES = SCAN_DEVICE_OTHER_MAX_PAGES
export const COPY_LIFETIME_MS = 10 * 60_000
export const COPY_PERMIT_MS = 30_000
export const COPY_ENDED = ['handed', 'failed', 'unconfirmed', 'cancelled', 'expired']

export function copyError(status: number, code: string, details?: unknown): never {
  throw new HttpException({ error: { code, message: code, ...(details ? { details } : {}) } }, status)
}

export function assertCopyLimits(input: Pick<CopyPriceInput, 'copies' | 'pageCount'>) {
  if (!Number.isSafeInteger(input.copies) || input.copies < 1 || input.copies > COPY_MAX_COPIES
    || !Number.isSafeInteger(input.pageCount) || input.pageCount < 1 || input.pageCount > COPY_MAX_PAGES) {
    copyError(413, 'COPY_LIMIT_EXCEEDED')
  }
}

export function assertCopyCombination(input: CopyPriceInput) {
  assertCopyLimits(input)
  if (input.duplex !== 'simplex' && input.copies > 1 && input.pageCount % 2 === 1
    && process.env['COPY_ALLOW_ODD_DUPLEX_MULTICOPY'] !== 'true') {
    copyError(409, 'COPY_ODD_DUPLEX_MULTICOPY_DISABLED')
  }
}
