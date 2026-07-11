import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

/**
 * 本次预生产 KSK-001 冻结的开始时间（UTC）。
 *
 * 此服务不是通用取消打印能力：只允许处置此时刻前已存在、匿名、未领取且未支付的
 * 历史 pending PrintTask。常规打印任务必须走其各自的业务/支付/履约流程。
 */
export const LEGACY_PENDING_PRINT_TASK_CUTOFF = new Date('2026-07-11T13:39:31.000Z')

const LEGACY_DISPOSITION_ERROR_CODE = 'LEGACY_PENDING_TASK_DISPOSED'
const MAX_TASKS_PER_DISPOSITION = 10

type DisposeLegacyPendingPrintTasksInput = {
  taskIds: string[]
  operatorId: string
  reason: string
}

type DisposeLegacyPendingPrintTasksResult = {
  disposedTaskIds: string[]
  alreadyDisposedTaskIds: string[]
}

function badRequest(code: string, message: string): BadRequestException {
  return new BadRequestException({ error: { code, message } })
}

/**
 * 仅供版本化维护命令调用的历史任务受控处置服务。
 *
 * 该服务故意不暴露 HTTP controller，避免把一次性预生产收口需求扩展成常规运营功能。
 * 每一项写入同一 transaction：PrintTask、Order.taskStatus、PrintTaskStatusLog、AuditLog。
 */
@Injectable()
export class AdminLegacyPendingPrintTaskDispositionService {
  constructor(private readonly prisma: PrismaService) {}

  async dispose(
    input: DisposeLegacyPendingPrintTasksInput
  ): Promise<DisposeLegacyPendingPrintTasksResult> {
    const taskIds = [...new Set(input.taskIds.map((id) => id.trim()).filter(Boolean))]
    const reason = input.reason.trim()
    if (!taskIds.length)
      throw badRequest('LEGACY_TASK_IDS_REQUIRED', '必须提供至少一个历史打印任务 ID')
    if (taskIds.length > MAX_TASKS_PER_DISPOSITION) {
      throw badRequest(
        'LEGACY_TASK_BATCH_TOO_LARGE',
        `单次最多处置 ${MAX_TASKS_PER_DISPOSITION} 个历史任务`
      )
    }
    if (!input.operatorId.trim())
      throw badRequest('ADMIN_OPERATOR_REQUIRED', '必须提供管理员操作员 ID')
    if (!reason) throw badRequest('LEGACY_TASK_REASON_REQUIRED', '必须填写历史任务处置原因')
    if (reason.length > 500)
      throw badRequest('LEGACY_TASK_REASON_TOO_LONG', '历史任务处置原因不能超过 500 个字符')

    return this.prisma.$transaction(async (tx) => {
      const operator = await tx.user.findUnique({
        where: { id: input.operatorId.trim() },
        select: { id: true, role: true, enabled: true },
      })
      if (!operator || operator.role !== 'admin' || !operator.enabled) {
        throw new ForbiddenException({
          error: { code: 'ADMIN_OPERATOR_REQUIRED', message: '仅已启用管理员可以处置历史打印任务' },
        })
      }

      const tasks = await tx.printTask.findMany({
        where: { id: { in: taskIds } },
        include: { order: { select: { id: true, payStatus: true, taskStatus: true } } },
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

        if (task.status === 'cancelled' && task.errorCode === LEGACY_DISPOSITION_ERROR_CODE) {
          alreadyDisposedTaskIds.push(taskId)
          continue
        }

        if (
          task.status !== 'pending' ||
          task.createdAt >= LEGACY_PENDING_PRINT_TASK_CUTOFF ||
          task.endUserId !== null ||
          task.claimedAt !== null ||
          task.claimExpiry !== null
        ) {
          throw badRequest('PRINT_TASK_NOT_LEGACY_PENDING', '任务不符合历史未领取打印任务处置条件')
        }
        if (task.order && !['unpaid', 'closed'].includes(task.order.payStatus)) {
          throw badRequest('PRINT_TASK_PAYMENT_PROTECTED', '关联订单已支付或处于不可处置支付状态')
        }
        if (task.order && task.order.taskStatus !== 'pending') {
          throw badRequest(
            'PRINT_TASK_ORDER_STATE_MISMATCH',
            '关联订单任务状态不是 pending，拒绝处置'
          )
        }

        const disposedAt = new Date()
        const update = await tx.printTask.updateMany({
          where: {
            id: task.id,
            status: 'pending',
            endUserId: null,
            claimedAt: null,
            claimExpiry: null,
            createdAt: { lt: LEGACY_PENDING_PRINT_TASK_CUTOFF },
          },
          data: {
            status: 'cancelled',
            completedAt: disposedAt,
            errorCode: LEGACY_DISPOSITION_ERROR_CODE,
            errorMessage: '历史未领取打印任务已由管理员受控关闭',
          },
        })
        if (update.count !== 1) {
          throw badRequest('PRINT_TASK_STATE_CONFLICT', '任务状态在处置期间发生变化，未执行处置')
        }

        if (task.order) {
          const orderUpdate = await tx.order.updateMany({
            where: {
              id: task.order.id,
              taskStatus: 'pending',
              payStatus: { in: ['unpaid', 'closed'] },
            },
            data: { taskStatus: 'cancelled' },
          })
          if (orderUpdate.count !== 1) {
            throw badRequest(
              'PRINT_TASK_ORDER_STATE_CONFLICT',
              '关联订单状态在处置期间发生变化，未执行处置'
            )
          }
        }

        await tx.printTaskStatusLog.create({
          data: {
            taskId: task.id,
            fromStatus: 'pending',
            toStatus: 'cancelled',
            errorCode: LEGACY_DISPOSITION_ERROR_CODE,
          },
        })
        await tx.auditLog.create({
          data: {
            actorId: operator.id,
            actorRole: 'admin',
            action: 'print_task.legacy_pending_disposed',
            targetType: 'print_task',
            targetId: task.id,
            payloadJson: JSON.stringify({
              reason,
              cutoff: LEGACY_PENDING_PRINT_TASK_CUTOFF.toISOString(),
              fromStatus: 'pending',
              toStatus: 'cancelled',
              orderPayStatus: task.order?.payStatus ?? null,
            }),
          },
        })
        disposedTaskIds.push(task.id)
      }

      return { disposedTaskIds, alreadyDisposedTaskIds }
    })
  }
}
