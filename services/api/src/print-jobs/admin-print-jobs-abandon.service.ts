// ============================================================
// AdminPrintJobsAbandonService
//
// Admin 受控处置单条历史 pending 打印任务（未被 Terminal Agent 领取的孤单）。
//
// 设计约束：
//   - 只允许 status==='pending' 且 claimedAt===null 的任务（真正历史遗孤）
//   - 处置状态写为 'abandoned'（与 Terminal Agent 失败路径的 'failed'/'cancelled' 明确区分）
//   - PrintTask + Order.taskStatus 镜像 + PrintTaskStatusLog + AuditLog 四项在同一事务提交
//   - 乐观锁：updateMany 带全部条件，count!=1 则冲突拒绝，避免竟态
// ============================================================

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'

export const ADMIN_ABANDON_ERROR_CODE = 'ADMIN_ABANDONED'

export interface AbandonPrintJobResult {
  taskId: string
  previousStatus: string
  newStatus: 'abandoned'
  orderId: string | null
  abandonedAt: string
}

@Injectable()
export class AdminPrintJobsAbandonService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async abandonPending(
    taskId: string,
    operatorId: string,
  ): Promise<AbandonPrintJobResult> {
    // 校验 operator 为有效 admin（防止 token 欺骗，二次确认 DB 身份）
    const operator = await this.prisma.user.findUnique({
      where: { id: operatorId },
      select: { id: true, role: true, enabled: true },
    })
    if (!operator || operator.role !== 'admin' || !operator.enabled) {
      throw new ForbiddenException({
        error: {
          code: 'ADMIN_OPERATOR_REQUIRED',
          message: '仅已启用的管理员可处置历史打印孤单',
        },
      })
    }

    const task = await this.prisma.printTask.findUnique({
      where: { id: taskId },
      include: {
        order: { select: { id: true, payStatus: true, taskStatus: true } },
      },
    })
    if (!task) {
      throw new NotFoundException({
        error: { code: 'PRINT_TASK_NOT_FOUND', message: `打印任务 ${taskId} 不存在` },
      })
    }

    // 已是终态 abandoned → 幂等返回
    if (task.status === 'abandoned' && task.errorCode === ADMIN_ABANDON_ERROR_CODE) {
      return {
        taskId: task.id,
        previousStatus: 'abandoned',
        newStatus: 'abandoned',
        orderId: task.order?.id ?? null,
        abandonedAt: (task.completedAt ?? task.updatedAt).toISOString(),
      }
    }

    // 只允许处置 pending + claimedAt===null 的真孤单
    if (task.status !== 'pending') {
      throw new BadRequestException({
        error: {
          code: 'PRINT_TASK_NOT_PENDING',
          message: `只能处置 pending 状态的任务，当前状态为 ${task.status}`,
        },
      })
    }
    if (task.claimedAt !== null) {
      throw new BadRequestException({
        error: {
          code: 'PRINT_TASK_ALREADY_CLAIMED',
          message: '任务已被 Terminal Agent 领取，不可通过此入口处置',
        },
      })
    }

    const abandonedAt = new Date()

    // 事务内：PrintTask + Order镜像 + StatusLog + AuditLog
    const { updatedTask } = await this.prisma.$transaction(async (tx) => {
      // 乐观锁：带全部前置条件
      const taskUpdate = await tx.printTask.updateMany({
        where: {
          id: task.id,
          status: 'pending',
          claimedAt: null,
        },
        data: {
          status: 'abandoned',
          completedAt: abandonedAt,
          errorCode: ADMIN_ABANDON_ERROR_CODE,
          errorMessage: '该历史打印任务已由管理员受控废弃',
        },
      })
      if (taskUpdate.count !== 1) {
        throw new ConflictException({
          error: {
            code: 'PRINT_TASK_STATE_CONFLICT',
            message: '任务状态在处置期间发生变化，请刷新后重试',
          },
        })
      }

      // 同步 Order.taskStatus 镜像（仅当 order 仍处于 pending）
      if (task.order) {
        await tx.order.updateMany({
          where: {
            id: task.order.id,
            taskStatus: 'pending',
          },
          data: { taskStatus: 'abandoned' },
        })
      }

      await tx.printTaskStatusLog.create({
        data: {
          taskId: task.id,
          fromStatus: 'pending',
          toStatus: 'abandoned',
          errorCode: ADMIN_ABANDON_ERROR_CODE,
        },
      })

      const updatedTask = await tx.printTask.findUniqueOrThrow({
        where: { id: task.id },
        include: { order: { select: { id: true } } },
      })
      return { updatedTask }
    })

    // 审计日志（事务外，写失败不回滚业务）
    await this.audit.write({
      actorId: operatorId,
      actorRole: 'admin',
      action: 'print_job.admin_abandon',
      targetType: 'print_task',
      targetId: task.id,
      payload: {
        fromStatus: 'pending',
        toStatus: 'abandoned',
        orderId: task.order?.id ?? null,
        orderPayStatus: task.order?.payStatus ?? null,
      },
    })

    return {
      taskId: updatedTask.id,
      previousStatus: 'pending',
      newStatus: 'abandoned',
      orderId: updatedTask.order?.id ?? null,
      abandonedAt: abandonedAt.toISOString(),
    }
  }
}
