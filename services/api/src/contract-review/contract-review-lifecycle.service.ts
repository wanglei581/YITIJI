import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { ContractReviewCleanupTask } from './contract-review.cleanup.task'
import { ContractReviewQueueService } from './contract-review.queue'
import { ContractReviewService } from './contract-review.service'
import { ContractReviewTaskAccess } from './contract-review-task-access'
import { mapContractReviewTaskView } from './contract-review-task-view.mapper'
import {
  CONTRACT_REVIEW_CLOCK,
  type ContractReviewClock,
  type ContractReviewConfirmInput,
  type ContractReviewCreateInput,
  type ContractReviewCreatedTask,
  type ContractReviewRequester,
  type ContractReviewTaskRow,
  type ContractReviewTaskView,
  type ContractType,
} from './contract-review.types'

const CREATE_PROCESSING_STATUSES = [
  'uploaded', 'queued', 'extracting', 'awaiting_confirmation',
] as const
const CONTRACT_TYPES = new Set<ContractType>([
  'labor_contract', 'internship_agreement', 'non_compete', 'offer',
])
const SHA256 = /^[a-f0-9]{64}$/u

const TASK_SELECT = {
  id: true,
  endUserId: true,
  accessTokenHash: true,
  contractType: true,
  status: true,
  analyzedPages: true,
  totalPages: true,
  truncated: true,
  ocrConfidence: true,
  expiresAt: true,
  resultJson: true,
  extractionFingerprint: true,
  confirmedAt: true,
} as const

@Injectable()
export class ContractReviewLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly taskPersistence: ContractReviewService,
    private readonly queue: ContractReviewQueueService,
    private readonly access: ContractReviewTaskAccess,
    private readonly cleanup: ContractReviewCleanupTask,
    @Optional()
    @Inject(CONTRACT_REVIEW_CLOCK)
    private readonly clock?: ContractReviewClock,
  ) {}

  async createAndEnqueue(
    input: ContractReviewCreateInput,
    requester: ContractReviewRequester,
  ): Promise<ContractReviewCreatedTask> {
    const created = await this.taskPersistence.create(input, requester)
    try {
      await this.queue.enqueueExtract(created.id)
    } catch {
      try {
        await this.expireFailedCreate(created.id)
      } catch {
        // The fail-closed CAS is deliberately attempted once; never leak its storage failure.
      }
      throw queueUnavailable()
    }
    if (requester.endUserId !== null) {
      return { id: created.id, status: created.status, expiresAt: created.expiresAt }
    }
    if (typeof created.accessToken !== 'string' || created.accessToken.length === 0) {
      throw new InternalServerErrorException({
        error: {
          code: 'CONTRACT_REVIEW_CREATE_FAILED',
          message: '合同审查任务创建失败，请稍后重试',
        },
      })
    }
    return created
  }

  async get(
    id: string,
    requester: ContractReviewRequester,
  ): Promise<ContractReviewTaskView> {
    const task = await this.loadOwnedTask(id, requester)
    return this.safeTaskView(task)
  }

  async confirmAndEnqueue(
    id: string,
    input: ContractReviewConfirmInput,
    requester: ContractReviewRequester,
  ): Promise<ContractReviewTaskView> {
    let task = await this.loadOwnedTask(id, requester)
    this.assertConfirmation(input, task)

    if (task.status === 'awaiting_confirmation') {
      const confirmedAt = this.now()
      const updated = await this.prisma.contractReviewTask.updateMany({
        where: { id: task.id, status: 'awaiting_confirmation', confirmedAt: null },
        data: { status: 'rule_checking', confirmedAt, contractType: input.contractType },
      })
      task = await this.loadOwnedTask(id, requester)
      if (updated.count === 0) this.assertConfirmedRetry(input, task)
    } else {
      this.assertConfirmedRetry(input, task)
    }

    try {
      await this.queue.enqueueAnalyze(task.id)
    } catch {
      throw queueUnavailable()
    }
    return this.safeTaskView(await this.loadOwnedTask(id, requester))
  }

  async remove(
    id: string,
    requester: ContractReviewRequester,
  ): Promise<{ id: string; deleted: true }> {
    const task = await this.loadOwnedTask(id, requester)
    const now = this.now()
    const expired = await this.prisma.contractReviewTask.updateMany({
      where: { id: task.id, status: task.status },
      data: { status: 'expired', expiresAt: now },
    })
    if (expired.count === 0) {
      const raced = await this.loadTask(id)
      if (!raced) return { id, deleted: true }
      this.access.requireOwnedTask(raced, requester)
      if (raced.status !== 'expired' || raced.expiresAt.getTime() > now.getTime()) {
        throw deleteRetry()
      }
    }

    let purged
    try {
      purged = await this.cleanup.purgeExpiredTaskById(id, now)
    } catch {
      throw deleteRetry()
    }
    if (!purged.deleted) throw deleteRetry()
    return { id, deleted: true }
  }

  async createReport(id: string, requester: ContractReviewRequester): Promise<never> {
    await this.loadOwnedTask(id, requester)
    throw new ServiceUnavailableException({
      error: {
        code: 'REPORT_NOT_AVAILABLE',
        message: '合同审查报告暂不可用',
        retryable: false,
      },
    })
  }

  private async expireFailedCreate(id: string): Promise<void> {
    await this.prisma.contractReviewTask.updateMany({
      where: { id, status: { in: [...CREATE_PROCESSING_STATUSES] } },
      data: { status: 'expired', expiresAt: this.now() },
    })
  }

  private async loadOwnedTask(
    id: string,
    requester: ContractReviewRequester,
  ): Promise<ContractReviewTaskRow> {
    return this.access.requireOwnedTask(await this.loadTask(id), requester)
  }

  private async loadTask(id: string): Promise<ContractReviewTaskRow | null> {
    if (typeof id !== 'string' || id.length === 0 || id.length > 128) return null
    return this.prisma.contractReviewTask.findUnique({
      where: { id },
      select: TASK_SELECT,
    }) as Promise<ContractReviewTaskRow | null>
  }

  private assertConfirmation(
    input: ContractReviewConfirmInput,
    task: ContractReviewTaskRow,
  ): void {
    const validNumbers =
      Number.isSafeInteger(input.totalPages) && input.totalPages >= 1 &&
      Number.isSafeInteger(input.analyzedPages) && input.analyzedPages >= 0
    const matchesExtraction =
      input.totalPages === task.totalPages &&
      input.analyzedPages === task.analyzedPages &&
      input.truncated === task.truncated
    if (
      !CONTRACT_TYPES.has(input.contractType) ||
      !validNumbers ||
      !matchesExtraction ||
      input.ocrCoverageConfirmed !== true ||
      input.personalUseConfirmed !== true ||
      !SHA256.test(task.extractionFingerprint ?? '')
    ) {
      throw invalidConfirmation()
    }
    if (task.status !== 'awaiting_confirmation' && task.status !== 'rule_checking') {
      throw invalidConfirmState()
    }
  }

  private assertConfirmedRetry(
    input: ContractReviewConfirmInput,
    task: ContractReviewTaskRow,
  ): void {
    if (
      task.status !== 'rule_checking' ||
      !(task.confirmedAt instanceof Date) ||
      !Number.isFinite(task.confirmedAt.getTime()) ||
      task.contractType !== input.contractType
    ) {
      throw invalidConfirmState()
    }
  }

  private safeTaskView(task: ContractReviewTaskRow): ContractReviewTaskView {
    try {
      return mapContractReviewTaskView(task)
    } catch {
      throw new InternalServerErrorException({
        error: {
          code: 'CONTRACT_REVIEW_RESULT_INVALID',
          message: '合同审查结果暂不可用',
        },
      })
    }
  }

  private now(): Date {
    const nowMs = this.clock?.now() ?? Date.now()
    if (!Number.isFinite(nowMs)) throw new Error('CONTRACT_REVIEW_CLOCK_INVALID')
    return new Date(nowMs)
  }
}

function invalidConfirmation(): BadRequestException {
  return new BadRequestException({
    error: { code: 'CONTRACT_REVIEW_CONFIRMATION_INVALID', message: '合同完整性确认无效' },
  })
}

function invalidConfirmState(): ConflictException {
  return new ConflictException({
    error: { code: 'CONTRACT_REVIEW_CONFIRM_STATE_INVALID', message: '当前任务状态不可确认' },
  })
}

function queueUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    error: {
      code: 'CONTRACT_REVIEW_QUEUE_UNAVAILABLE',
      message: '合同审查任务暂无法排队，请稍后重试',
      retryable: true,
    },
  })
}

function deleteRetry(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    error: {
      code: 'CONTRACT_REVIEW_DELETE_RETRY',
      message: '合同材料正在安全删除，请稍后重试',
      retryable: true,
    },
  })
}
