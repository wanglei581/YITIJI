import { ConflictException } from '@nestjs/common'
import type { PrismaService } from '../prisma/prisma.service'
import { isPrintableFileRecord } from './print-page-count.service'
import {
  PARTIAL_OUTPUT_ERROR_CODE,
  PRINT_JOB_UNCONFIRMED_ERROR_CODE,
} from './paid-anomaly-disposition'

/**
 * 会员重新提交和管理员重试共用的资格。管理员另有终端退役、订单 taskStatus
 * 序列点和审计，不在这里。
 *
 * 顺序：失败态、未确认、只出一部分、退款、未付款、文件仍可打印。
 * 退款先于「不是 paid」，这样管理员仍能返回退款错误码。
 */
export type PaidReprintBlockReason =
  | 'not_failed'
  | 'unconfirmed'
  | 'partial_output'
  | 'refunding'
  | 'not_paid'
  | 'file_unavailable'

const REFUND_PAY_STATUSES = new Set(['refunding', 'partial_refunded', 'refunded'])

export function paidReprintBlockReason(input: {
  status: string
  errorCode?: string | null
  payStatus?: string | null
  file: { status?: string | null; deletedAt?: Date | null; expiresAt?: Date | null } | null
}): PaidReprintBlockReason | null {
  if (input.status !== 'failed') return 'not_failed'
  if (input.errorCode === PRINT_JOB_UNCONFIRMED_ERROR_CODE) return 'unconfirmed'
  if (input.errorCode === PARTIAL_OUTPUT_ERROR_CODE) return 'partial_output'
  if (input.payStatus != null && REFUND_PAY_STATUSES.has(input.payStatus)) return 'refunding'
  if (input.payStatus !== 'paid') return 'not_paid'
  if (!isPrintableFileRecord(input.file)) return 'file_unavailable'
  return null
}

export async function loadPaidReprintBlock(
  prisma: PrismaService,
  task: { id: string; status: string; errorCode?: string | null },
  file: { status?: string | null; deletedAt?: Date | null; expiresAt?: Date | null } | null,
): Promise<PaidReprintBlockReason | null> {
  const order = await prisma.order.findFirst({
    where: { printTaskId: task.id },
    select: { payStatus: true },
  })
  return paidReprintBlockReason({
    status: task.status,
    errorCode: task.errorCode,
    payStatus: order?.payStatus ?? null,
    file,
  })
}

/** 会员端两条「未付款 / 退款」都沿用原来的 PRINT_RETRY_NOT_PAID。 */
export function throwIfMemberReprintBlocked(reason: PaidReprintBlockReason | null): void {
  if (reason === null) return
  if (reason === 'not_failed') {
    throw new ConflictException({
      error: { code: 'PRINT_RETRY_INVALID_STATE', message: '仅失败的打印任务可以重新提交' },
    })
  }
  if (reason === 'partial_output') {
    throw new ConflictException({
      error: {
        code: 'PRINT_RETRY_PARTIAL_OUTPUT_FORBIDDEN',
        message: '只出了一部分，不能自动重打或自动退款，请联系工作人员',
      },
    })
  }
  if (reason === 'unconfirmed') {
    throw new ConflictException({
      error: {
        code: 'PRINT_RETRY_UNCONFIRMED_FORBIDDEN',
        message: '打印结果未确认，不能重新提交，请联系工作人员核查',
      },
    })
  }
  if (reason === 'not_paid' || reason === 'refunding') {
    throw new ConflictException({
      error: { code: 'PRINT_RETRY_NOT_PAID', message: '未完成支付的打印任务不能重新提交' },
    })
  }
  throw new ConflictException({
    error: { code: 'PRINT_RETRY_FILE_UNAVAILABLE', message: '打印文件已按保存策略清理，无法重新提交' },
  })
}

/**
 * 管理员错误码与会员端分开。partial_output 必须单独分支：
 * 删掉这一支时，已付款的「只出一部分」会落到后面的重试写入。
 */
export function throwIfAdminReprintBlocked(reason: PaidReprintBlockReason | null): void {
  if (reason === null) return
  if (reason === 'not_failed') {
    throw new ConflictException({
      error: { code: 'PRINT_SCAN_ACTION_INVALID_STATE', message: '仅失败状态的打印任务可以重试' },
    })
  }
  if (reason === 'unconfirmed') {
    throw new ConflictException({
      error: {
        code: 'PRINT_SCAN_RETRY_UNCONFIRMED_FORBIDDEN',
        message: '打印结果未确认，禁止重新排队；请前往订单管理核查并按需退款',
      },
    })
  }
  if (reason === 'partial_output') {
    throw new ConflictException({
      error: {
        code: 'PRINT_SCAN_RETRY_PARTIAL_OUTPUT_FORBIDDEN',
        message: '只出了一部分，不能重新排队',
      },
    })
  }
  if (reason === 'refunding') {
    throw new ConflictException({
      error: { code: 'PRINT_SCAN_RETRY_REFUNDED', message: '该任务的订单已退款或退款中，不能重试出纸' },
    })
  }
  if (reason === 'not_paid') {
    throw new ConflictException({
      error: { code: 'PRINT_SCAN_RETRY_NOT_PAID', message: '未完成支付的打印任务不能重试' },
    })
  }
  if (reason === 'file_unavailable') {
    throw new ConflictException({
      error: { code: 'PRINT_SCAN_RETRY_FILE_UNAVAILABLE', message: '打印文件已按隐私策略清理，无法重试' },
    })
  }
}
