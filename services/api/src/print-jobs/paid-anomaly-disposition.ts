/**
 * 已付款之后的异常去向。文件失效单独标待退款；其余不自动退款、不自动重派。
 *
 * 不新建订单状态。待退款复用 Order.refundReason=PAID_UNFULFILLED_PENDING_REFUND
 * （payStatus 保持 paid）。打印结果未确认复用 errorCode=PRINT_JOB_UNCONFIRMED。
 */

export const PARTIAL_OUTPUT_ERROR_CODE = 'PARTIAL_OUTPUT'
export const PAPER_EMPTY_ERROR_CODE = 'PAPER_EMPTY'
export const PRINT_JOB_UNCONFIRMED_ERROR_CODE = 'PRINT_JOB_UNCONFIRMED'
export const PRINTING_REPORT_LOST_ERROR_CODE = 'PRINTING_REPORT_LOST'

/** 纸可能已经出来，或只出了一部分：禁止自动重打。缺纸不在此列（补纸后由用户重试）。 */
const NO_AUTOMATIC_REPRINT = new Set<string>([
  PRINT_JOB_UNCONFIRMED_ERROR_CODE,
  PARTIAL_OUTPUT_ERROR_CODE,
])

export function forbidsAutomaticReprint(errorCode: string | null | undefined): boolean {
  return typeof errorCode === 'string' && NO_AUTOMATIC_REPRINT.has(errorCode)
}
