/**
 * 后台订单只读视图的行类型、查询字段与纯函数推导（从 admin-orders-readonly.service.ts 拆出，口径不变）。
 */
import {
  isAdminRefundRequired,
  isOnlineCollectedPendingRefund,
} from '../payment/pending-refund-signal'
import type { AdminOrderReadonlyItem, AdminOrderReadonlyPrintSummary } from './admin-orders-readonly.types'

export interface OrderRow {
  id: string
  orderNo: string
  type: string
  printTaskId: string | null
  sourceFileId: string | null
  sourceFileName: string | null
  printParamsJson: string | null
  endUserId: string | null
  terminalId: string | null
  amountCents: number
  billablePages: number | null
  currency: string
  payStatus: string
  taskStatus: string
  channel: string | null
  pickupStatus: string
  pickupCodeExpiresAt: Date | null
  refundReason: string | null
  refundedAt: Date | null
  discountCents: number
  refundedAmountCents: number
  createdAt: Date
  updatedAt: Date
  copyJob: { state: string; resultCode: string | null } | null
  printTask: {
    id: string
    terminalId: string | null
    paramsJson: string
    status: string
    errorCode: string | null
    printOutcome: string | null
    createdAt: Date
    completedAt: Date | null
  } | null
}

export interface LabelMaps {
  userLabels: Map<string, string | null>
  terminalCodes: Map<string, string>
}

const PRINT_JOB_UNCONFIRMED_ERROR_CODE = 'PRINT_JOB_UNCONFIRMED'

function parsePrintOutcome(value: string | null | undefined): AdminOrderReadonlyItem['printOutcome'] {
  if (value === 'printed' || value === 'not_printed') return value
  return null
}

export function deriveAftercare(
  row: OrderRow,
  channelAcceptedUnconfirmed: boolean,
  paperRefundFailed = false,
  printReturnManual = false,
): Pick<
  AdminOrderReadonlyItem,
  | 'aftercareStatus'
  | 'refundEligible'
  | 'retryForbidden'
  | 'printOutcome'
  | 'refundRequired'
  | 'opsAttention'
  | 'opsAttentionCode'
> {
  if (row.type === 'copy') {
    const unconfirmed = row.copyJob?.state === 'unconfirmed'
    return { printOutcome: null, aftercareStatus: unconfirmed ? 'manual_check_required' : null,
      refundEligible: false, retryForbidden: true, refundRequired: false,
      opsAttention: unconfirmed, opsAttentionCode: unconfirmed ? 'copy_result_unconfirmed' : null }
  }
  const printOutcome = parsePrintOutcome(row.printTask?.printOutcome)
  const unconfirmedFailure =
    row.type === 'print' &&
    row.taskStatus === 'failed' &&
    row.printTask?.status === 'failed' &&
    row.printTask.errorCode === PRINT_JOB_UNCONFIRMED_ERROR_CODE
  const manualCheckRequired =
    unconfirmedFailure && row.payStatus === 'paid' && printOutcome === null

  return {
    printOutcome,
    aftercareStatus: manualCheckRequired ? 'manual_check_required' : null,
    // 已确认出纸禁止退款；RefundService 仍是最终写入门禁。迟到回调待退未转 paid，但可退。
    refundEligible:
      (row.payStatus === 'paid' || row.payStatus === 'partial_refunded' || isOnlineCollectedPendingRefund(row)) && printOutcome !== 'printed',
    // 未确认历史原因仍在时禁止重打，核查后同样禁止。
    retryForbidden: unconfirmedFailure,
    refundRequired: isAdminRefundRequired(row),
    ...deriveOpsAttention(row, channelAcceptedUnconfirmed, paperRefundFailed, printReturnManual),
  }
}

function deriveOpsAttention(
  row: Pick<OrderRow, 'payStatus' | 'refundReason'>,
  channelAcceptedUnconfirmed: boolean,
  paperRefundFailed: boolean,
  printReturnManual: boolean,
): Pick<AdminOrderReadonlyItem, 'opsAttention' | 'opsAttentionCode'> {
  const refundRequired = isAdminRefundRequired(row)
  let opsAttentionCode: AdminOrderReadonlyItem['opsAttentionCode'] = null
  if (channelAcceptedUnconfirmed) opsAttentionCode = 'channel_accepted_unconfirmed'
  else if (refundRequired) opsAttentionCode = 'refund_required'
  else if (row.payStatus === 'refunding') opsAttentionCode = 'refunding'
  else if (row.payStatus === 'partial_refunded') opsAttentionCode = 'partial_refunded'
  else if (paperRefundFailed) opsAttentionCode = 'paper_refund_failed'
  else if (printReturnManual) opsAttentionCode = 'print_return_manual'
  return {
    opsAttention: opsAttentionCode !== null,
    opsAttentionCode,
  }
}

const DUPLEX_MODES = ['simplex', 'duplex_long_edge', 'duplex_short_edge'] as const

const EMPTY_PRINT_SUMMARY: AdminOrderReadonlyPrintSummary = {
  fileName: null,
  copies: null,
  colorMode: null,
  duplex: null,
  paperSize: null,
  pageRange: null,
}

export function parseSafePrintSummary(paramsJson: string | null | undefined): AdminOrderReadonlyPrintSummary {
  if (!paramsJson) return { ...EMPTY_PRINT_SUMMARY }
  let raw: unknown
  try {
    raw = JSON.parse(paramsJson)
  } catch {
    return { ...EMPTY_PRINT_SUMMARY }
  }
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_PRINT_SUMMARY }
  const p = raw as Record<string, unknown>
  const stringValue = (key: string): string | null =>
    typeof p[key] === 'string' && (p[key] as string).trim().length > 0 ? (p[key] as string).trim() : null
  const copies =
    typeof p['copies'] === 'number' && Number.isInteger(p['copies']) && p['copies'] >= 1 && p['copies'] <= 99
      ? p['copies']
      : null
  return {
    fileName: stringValue('fileName'),
    copies,
    colorMode: p['colorMode'] === 'black_white' || p['colorMode'] === 'color' ? p['colorMode'] : null,
    duplex: DUPLEX_MODES.includes(p['duplex'] as (typeof DUPLEX_MODES)[number])
      ? (p['duplex'] as (typeof DUPLEX_MODES)[number])
      : null,
    paperSize: stringValue('paperSize'),
    pageRange: stringValue('pageRange'),
  }
}

export function orderSelect() {
  return {
    id: true,
    orderNo: true,
    type: true,
    printTaskId: true,
    sourceFileId: true,
    sourceFileName: true,
    printParamsJson: true,
    endUserId: true,
    terminalId: true,
    amountCents: true,
    billablePages: true,
    currency: true,
    payStatus: true,
    taskStatus: true,
    channel: true,
    pickupStatus: true,
    pickupCodeExpiresAt: true,
    refundReason: true,
    refundedAt: true,
    discountCents: true,
    refundedAmountCents: true,
    createdAt: true,
    updatedAt: true,
    copyJob: { select: { state: true, resultCode: true } },
    printTask: {
      select: {
        id: true,
        terminalId: true,
        paramsJson: true,
        status: true,
        errorCode: true,
        printOutcome: true,
        createdAt: true,
        completedAt: true,
      },
    },
  } as const
}
