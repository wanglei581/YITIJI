/**
 * 打印扫描运维列表的「出纸未确认」筛选（GET /admin/print-scan/tasks?unconfirmed=1）。
 *
 * 口径与「核查出纸」动作的前提一致：errorCode 为未确认出纸，且管理员还没有给出核查结论。
 * 这类任务核查前不能重新排队（见 paid-reprint-eligibility.ts），所以不再按状态过滤。
 * 单独成文件是因为 admin-print-scan.service.ts 已超过 800 行，不再往里堆新逻辑。
 */
import { BadRequestException } from '@nestjs/common'
import { PRINT_JOB_UNCONFIRMED_ERROR_CODE } from '../print-jobs/paid-anomaly-disposition'

export function assertUnconfirmedOnlyForPrint(type: string, unconfirmed: boolean | undefined): void {
  if (!unconfirmed || type === 'print') return
  throw new BadRequestException({
    error: { code: 'PRINT_SCAN_UNCONFIRMED_PRINT_ONLY', message: '出纸未确认只适用于打印任务' },
  })
}

export function unconfirmedPrintWhere(): Record<string, unknown> {
  return { errorCode: PRINT_JOB_UNCONFIRMED_ERROR_CODE, OR: [{ printOutcome: null }, { printOutcome: '' }] }
}
