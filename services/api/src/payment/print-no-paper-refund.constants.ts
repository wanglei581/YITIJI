/** 已付款、明确没出纸时自动原路退的退款原因。同一单用这个原因只退一次。 */
export const PAID_NO_PAPER_AUTO_REASON = 'paid_no_paper_auto'

/** 自动退款失败后的派生告警类型。名字里不能带英文 refund，告警页门禁会扫这两个文件。 */
export const PRINT_RETURN_MANUAL_TYPE = 'print_return_manual' as const

/** 渠道明确拒绝后给管理员看的失败原因。 */
export const PRINT_REFUND_FAILED_DETAIL = '渠道退款没有成功，需要人工处理'
