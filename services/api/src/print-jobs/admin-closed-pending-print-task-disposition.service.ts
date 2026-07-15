import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

export const CLOSED_PENDING_PRINT_TASK_DISPOSITION_ERROR_CODE =
  'CLOSED_PENDING_PRINT_TASK_DISPOSED'

const CLOSED_PENDING_PRINT_TASK_DISPOSITION_ACTION = 'print_task.closed_pending_disposed'
const MAX_TASKS_PER_DISPOSITION = 10
const MIN_REASON_LENGTH = 10
const MAX_REASON_LENGTH = 500
const PROTECTED_PAYMENT_ATTEMPT_STATUSES = ['created', 'pending', 'success'] as const

type DisposeClosedPendingPrintTasksInput = {
  taskIds: string[]
  operatorId: string
  reason: string
}

type DisposeClosedPendingPrintTasksResult = {
  disposedTaskIds: string[]
  alreadyDisposedTaskIds: string[]
}

function badRequest(code: string, message: string): BadRequestException {
  return new BadRequestException({ error: { code, message } })
}

/**
 * 仅供版本化维护命令收敛“订单已关闭但打印任务仍 pending”的异常遗留状态。
 *
 * 这不是通用取消能力：只接受匿名、未领取、closed/pending 且没有可入账支付尝试的任务。
 * PrintTask、Order 镜像、状态日志和审计必须在同一个 transaction 内提交。
 */
@Injectable()
export class AdminClosedPendingPrintTaskDispositionService {
  constructor(private readonly prisma: PrismaService) {}

  async dispose(
    input: DisposeClosedPendingPrintTasksInput
  ): Promise<DisposeClosedPendingPrintTasksResult> {
    const taskIds = [...new Set(input.taskIds.map((id) => id.trim()).filter(Boolean))]
    const operatorId = input.operatorId.trim()
    const reason = input.reason.trim()

    if (taskIds.length === 0) {
      throw badRequest('CLOSED_PENDING_TASK_IDS_REQUIRED', '必须提供至少一个已关闭订单遗留打印任务 ID')
    }
    if (taskIds.length > MAX_TASKS_PER_DISPOSITION) {
      throw badRequest(
        'CLOSED_PENDING_TASK_BATCH_TOO_LARGE',
        `单次最多处置 ${MAX_TASKS_PER_DISPOSITION} 个已关闭订单遗留打印任务`
      )
    }
    if (!operatorId) {
      throw badRequest('ADMIN_OPERATOR_REQUIRED', '必须提供管理员操作员 ID')
    }
    if (reason.length < MIN_REASON_LENGTH || reason.length > MAX_REASON_LENGTH) {
      throw badRequest(
        'CLOSED_PENDING_TASK_REASON_INVALID',
        `处置原因长度必须为 ${MIN_REASON_LENGTH} 至 ${MAX_REASON_LENGTH} 个字符`
      )
    }

    return this.prisma.$transaction(async (tx) => {
      const operator = await tx.user.findUnique({
        where: { id: operatorId },
        select: { id: true, role: true, enabled: true },
      })
      if (!operator || operator.role !== 'admin' || !operator.enabled) {
        throw new ForbiddenException({
          error: { code: 'ADMIN_OPERATOR_REQUIRED', message: '仅已启用管理员可以处置已关闭订单遗留打印任务' },
        })
      }

      const tasks = await tx.printTask.findMany({
        where: { id: { in: taskIds } },
        include: {
          order: {
            select: {
              id: true,
              printTaskId: true,
              payStatus: true,
              taskStatus: true,
              paymentAttempts: { select: { id: true, status: true } },
            },
          },
        },
      })
      const tasksById = new Map(tasks.map((task) => [task.id, task]))
      const disposedTaskIds: string[] = []
      const alreadyDisposedTaskIds: string[] = []

      for (const taskId of taskIds) {
        const task = tasksById.get(taskId)
        if (!task) {
          throw new NotFoundException({
            error: { code: 'PRINT_TASK_NOT_FOUND', message: `打印任务 ${taskId} 不存在` },
          })
        }

        if (
          task.status === 'cancelled' &&
          task.errorCode === CLOSED_PENDING_PRINT_TASK_DISPOSITION_ERROR_CODE &&
          task.order?.payStatus === 'closed' &&
          task.order.taskStatus === 'cancelled'
        ) {
          alreadyDisposedTaskIds.push(taskId)
          continue
        }

        if (
          task.status !== 'pending' ||
          task.endUserId !== null ||
          task.claimedAt !== null ||
          task.claimExpiry !== null ||
          !task.order ||
          task.order.payStatus !== 'closed' ||
          task.order.taskStatus !== 'pending'
        ) {
          throw badRequest(
            'PRINT_TASK_NOT_CLOSED_PENDING',
            '任务不符合已关闭订单遗留 pending 打印任务处置条件'
          )
        }

        if (
          task.order.paymentAttempts.some((attempt) =>
            PROTECTED_PAYMENT_ATTEMPT_STATUSES.includes(
              attempt.status as (typeof PROTECTED_PAYMENT_ATTEMPT_STATUSES)[number]
            )
          )
        ) {
          throw badRequest(
            'PRINT_TASK_PAYMENT_ATTEMPT_PROTECTED',
            '关联订单存在支付中或成功的支付尝试，拒绝处置'
          )
        }

        const disposedAt = new Date()
        const taskUpdate = await tx.printTask.updateMany({
          where: {
            id: task.id,
            status: 'pending',
            endUserId: null,
            claimedAt: null,
            claimExpiry: null,
          },
          data: {
            status: 'cancelled',
            completedAt: disposedAt,
            errorCode: CLOSED_PENDING_PRINT_TASK_DISPOSITION_ERROR_CODE,
            errorMessage: '已关闭订单关联的匿名未领取打印任务已由管理员受控关闭',
          },
        })
        if (taskUpdate.count !== 1) {
          throw new ConflictException({
            error: { code: 'PRINT_TASK_STATE_CONFLICT', message: '任务状态在处置期间发生变化，未执行处置' },
          })
        }

        const orderUpdate = await tx.order.updateMany({
          where: {
            id: task.order.id,
            printTaskId: task.id,
            payStatus: 'closed',
            taskStatus: 'pending',
            paymentAttempts: {
              none: { status: { in: [...PROTECTED_PAYMENT_ATTEMPT_STATUSES] } },
            },
          },
          data: { taskStatus: 'cancelled' },
        })
        if (orderUpdate.count !== 1) {
          throw new ConflictException({
            error: {
              code: 'PRINT_TASK_ORDER_STATE_CONFLICT',
              message: '关联订单或支付尝试在处置期间发生变化，未执行处置',
            },
          })
        }

        await tx.printTaskStatusLog.create({
          data: {
            taskId: task.id,
            fromStatus: 'pending',
            toStatus: 'cancelled',
            errorCode: CLOSED_PENDING_PRINT_TASK_DISPOSITION_ERROR_CODE,
          },
        })
        await tx.auditLog.create({
          data: {
            actorId: operator.id,
            actorRole: 'admin',
            action: CLOSED_PENDING_PRINT_TASK_DISPOSITION_ACTION,
            targetType: 'print_task',
            targetId: task.id,
            payloadJson: JSON.stringify({
              reason,
              fromStatus: 'pending',
              toStatus: 'cancelled',
              orderPayStatus: 'closed',
              paymentAttemptStatuses: task.order.paymentAttempts.map((attempt) => attempt.status),
            }),
          },
        })
        disposedTaskIds.push(task.id)
      }

      return { disposedTaskIds, alreadyDisposedTaskIds }
    })
  }
}
