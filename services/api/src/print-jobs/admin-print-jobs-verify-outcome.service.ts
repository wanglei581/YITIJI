import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import {
  markPaidUnfulfilledRefundRequired,
  shouldSignalPaidUnfulfilledRefund,
  PAID_UNFULFILLED_PENDING_REFUND_REASON,
} from '../payment/pending-refund-signal'

export const PRINT_JOB_UNCONFIRMED_ERROR_CODE = 'PRINT_JOB_UNCONFIRMED'
export const PRINT_OUTCOME_PRINTED = 'printed'
export const PRINT_OUTCOME_NOT_PRINTED = 'not_printed'

const CONFIRM_PRINTED = 'VERIFY_PRINTED'
const CONFIRM_NOT_PRINTED = 'VERIFY_NOT_PRINTED'

export type PrintOutcomeValue = typeof PRINT_OUTCOME_PRINTED | typeof PRINT_OUTCOME_NOT_PRINTED

export interface VerifyPrintOutcomeResult {
  taskId: string
  orderId: string | null
  printOutcome: PrintOutcomeValue
  idempotent: boolean
  verifiedAt: string
  /** 核查为未出纸且订单已付款有实收时为 true。只是待退款信号，不会自动出款。 */
  refundRequired: boolean
}

@Injectable()
export class AdminPrintJobsVerifyOutcomeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async verifyOutcome(
    taskId: string,
    input: { outcome?: unknown; confirm?: unknown },
    operatorId: string,
  ): Promise<VerifyPrintOutcomeResult> {
    const outcome = parseOutcome(input.outcome)
    const expectedConfirm = outcome === PRINT_OUTCOME_PRINTED ? CONFIRM_PRINTED : CONFIRM_NOT_PRINTED
    if (typeof input.confirm !== 'string' || input.confirm.trim() !== expectedConfirm) {
      throw new BadRequestException({
        error: {
          code: 'PRINT_OUTCOME_CONFIRM_REQUIRED',
          message: `必须输入确认短语 ${expectedConfirm}`,
        },
      })
    }

    const operator = await this.prisma.user.findUnique({
      where: { id: operatorId },
      select: { id: true, role: true, enabled: true },
    })
    if (!operator || operator.role !== 'admin' || !operator.enabled) {
      throw new ForbiddenException({
        error: { code: 'ADMIN_OPERATOR_REQUIRED', message: '仅已启用的管理员可核查出纸结果' },
      })
    }

    const task = await this.prisma.printTask.findUnique({
      where: { id: taskId },
      include: {
        order: {
          select: {
            id: true,
            payStatus: true,
            taskStatus: true,
            amountCents: true,
            discountCents: true,
            refundReason: true,
          },
        },
      },
    })
    if (!task) {
      throw new NotFoundException({
        error: { code: 'PRINT_TASK_NOT_FOUND', message: `打印任务 ${taskId} 不存在` },
      })
    }

    if (task.printOutcome === outcome) {
      let refundRequired = false
      if (outcome === PRINT_OUTCOME_NOT_PRINTED && task.order && shouldSignalPaidUnfulfilledRefund(task.order)) {
        refundRequired = await markPaidUnfulfilledRefundRequired(this.prisma, task.order)
      }
      return {
        taskId: task.id,
        orderId: task.order?.id ?? null,
        printOutcome: outcome,
        idempotent: true,
        verifiedAt: task.updatedAt.toISOString(),
        refundRequired,
      }
    }
    if (task.printOutcome === PRINT_OUTCOME_PRINTED || task.printOutcome === PRINT_OUTCOME_NOT_PRINTED) {
      throw new ConflictException({
        error: {
          code: 'PRINT_OUTCOME_ALREADY_VERIFIED',
          message: '该任务已有不同的核查结论，禁止覆盖',
        },
      })
    }
    if (task.status !== 'failed' || task.errorCode !== PRINT_JOB_UNCONFIRMED_ERROR_CODE) {
      throw new BadRequestException({
        error: {
          code: 'PRINT_OUTCOME_NOT_UNCONFIRMED',
          message: '只有未确认出纸的失败任务可以核查',
        },
      })
    }
    if (!task.order || task.order.payStatus !== 'paid') {
      throw new BadRequestException({
        error: {
          code: 'PRINT_OUTCOME_ORDER_NOT_PAID',
          message: '只有已支付订单的未确认任务可以核查',
        },
      })
    }

    const verifiedAt = new Date()
    const logCode = outcome === PRINT_OUTCOME_PRINTED ? 'PRINT_OUTCOME_PRINTED' : 'PRINT_OUTCOME_NOT_PRINTED'
    const refundRequired =
      outcome === PRINT_OUTCOME_NOT_PRINTED &&
      Boolean(task.order && shouldSignalPaidUnfulfilledRefund(task.order))

    await this.prisma.$transaction(async (tx) => {
      const cas = await tx.printTask.updateMany({
        where: {
          id: task.id,
          status: 'failed',
          errorCode: PRINT_JOB_UNCONFIRMED_ERROR_CODE,
          printOutcome: null,
        },
        data: { printOutcome: outcome },
      })
      if (cas.count !== 1) {
        throw new ConflictException({
          error: {
            code: 'PRINT_TASK_STATE_CONFLICT',
            message: '任务状态在核查期间发生变化，请刷新后重试',
          },
        })
      }

      await tx.printTaskStatusLog.create({
        data: {
          taskId: task.id,
          fromStatus: 'failed',
          toStatus: 'failed',
          errorCode: logCode,
        },
      })

      if (refundRequired && task.order) {
        await markPaidUnfulfilledRefundRequired(tx, task.order)
      }

      await this.audit.writeRequired(tx, {
        actorId: operatorId,
        actorRole: 'admin',
        action: 'print_job.admin_verify_outcome',
        targetType: 'print_task',
        targetId: task.id,
        payload: {
          printOutcome: outcome,
          orderId: task.order?.id ?? null,
          orderPayStatus: task.order?.payStatus ?? null,
          errorCode: task.errorCode,
          refundRequired,
          refundReason: refundRequired ? PAID_UNFULFILLED_PENDING_REFUND_REASON : null,
          autoRefund: false,
        },
      })
    })

    return {
      taskId: task.id,
      orderId: task.order.id,
      printOutcome: outcome,
      idempotent: false,
      verifiedAt: verifiedAt.toISOString(),
      refundRequired,
    }
  }
}

function parseOutcome(value: unknown): PrintOutcomeValue {
  if (value === PRINT_OUTCOME_PRINTED || value === PRINT_OUTCOME_NOT_PRINTED) return value
  throw new BadRequestException({
    error: { code: 'PRINT_OUTCOME_INVALID', message: 'outcome 只能是 printed 或 not_printed' },
  })
}
