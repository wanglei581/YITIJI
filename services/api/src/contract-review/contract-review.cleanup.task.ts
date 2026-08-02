import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { createHash } from 'crypto'
import { FilesService } from '../files/files.service'
import { PrismaService } from '../prisma/prisma.service'

const CONTRACT_REVIEW_CLEANUP_BATCH_SIZE = 100
const CONTRACT_REVIEW_DELETE_REASON = 'contract_review_expired'

type CleanupTaskRow = {
  id: string
  status: string
  expiresAt: Date
  sourceFileId: string
  resultFileId: string | null
}

export type ContractReviewCleanupResult = {
  scanned: number
  deletedTasks: number
  deletedFiles: number
  sharedFiles: number
  failedTasks: number
}

@Injectable()
export class ContractReviewCleanupTask {
  private readonly logger = new Logger(ContractReviewCleanupTask.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleHourly(): Promise<void> {
    try {
      await this.runOnce()
    } catch {
      this.logger.warn('code=CONTRACT_REVIEW_CLEANUP_BATCH_FAILED')
    }
  }

  async runOnce(now = new Date()): Promise<ContractReviewCleanupResult> {
    const tasks = await this.prisma.contractReviewTask.findMany({
      where: { expiresAt: { lte: now } },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: CONTRACT_REVIEW_CLEANUP_BATCH_SIZE,
      select: {
        id: true,
        status: true,
        expiresAt: true,
        sourceFileId: true,
        resultFileId: true,
      },
    })
    const result: ContractReviewCleanupResult = {
      scanned: tasks.length,
      deletedTasks: 0,
      deletedFiles: 0,
      sharedFiles: 0,
      failedTasks: 0,
    }

    for (const task of tasks) {
      if (!(await this.ensureExpired(task, now))) continue
      const cleanup = await this.cleanupFiles(task, now)
      result.deletedFiles += cleanup.deletedFiles
      result.sharedFiles += cleanup.sharedFiles
      if (!cleanup.complete) {
        result.failedTasks += 1
        continue
      }

      const deleted = await this.prisma.contractReviewTask.deleteMany({
        where: { id: task.id, status: 'expired', expiresAt: { lte: now } },
      })
      result.deletedTasks += deleted.count
    }

    this.logger.log(
      `code=CONTRACT_REVIEW_CLEANUP_COMPLETE scanned=${result.scanned} tasks=${result.deletedTasks} files=${result.deletedFiles} shared=${result.sharedFiles} failed=${result.failedTasks}`
    )
    return result
  }

  private async ensureExpired(task: CleanupTaskRow, now: Date): Promise<boolean> {
    if (task.status === 'expired') return true
    const updated = await this.prisma.contractReviewTask.updateMany({
      where: { id: task.id, status: task.status, expiresAt: { lte: now } },
      data: { status: 'expired' },
    })
    return updated.count === 1
  }

  private async cleanupFiles(
    task: CleanupTaskRow,
    now: Date
  ): Promise<{ complete: boolean; deletedFiles: number; sharedFiles: number }> {
    const fileIds = [...new Set([task.sourceFileId, task.resultFileId].filter(isFileId))]
    let complete = true
    let deletedFiles = 0
    let sharedFiles = 0

    for (const fileId of fileIds) {
      let outcome: 'complete' | 'deleted' | 'shared' | 'failed'
      try {
        outcome = await this.cleanupFile(task.id, fileId, now)
      } catch {
        this.logFileFailure(task.id)
        outcome = 'failed'
      }
      if (outcome === 'deleted') deletedFiles += 1
      if (outcome === 'shared') sharedFiles += 1
      if (outcome === 'failed') complete = false
    }
    return { complete, deletedFiles, sharedFiles }
  }

  private async cleanupFile(
    taskId: string,
    fileId: string,
    now: Date
  ): Promise<'complete' | 'deleted' | 'shared' | 'failed'> {
    const before = await this.prisma.fileObject.findUnique({
      where: { id: fileId },
      select: { id: true, deletedAt: true },
    })
    if (!before || before.deletedAt) return 'complete'

    const shared = await this.prisma.contractReviewTask.findFirst({
      where: {
        id: { not: taskId },
        expiresAt: { gt: now },
        OR: [{ sourceFileId: fileId }, { resultFileId: fileId }],
      },
      select: { id: true },
    })
    if (shared) return 'shared'

    try {
      await this.files.systemDeleteSensitive(fileId, CONTRACT_REVIEW_DELETE_REASON)
      return 'deleted'
    } catch {
      const after = await this.prisma.fileObject.findUnique({
        where: { id: fileId },
        select: { id: true, deletedAt: true },
      })
      if (after?.deletedAt) return 'deleted'
      this.logFileFailure(taskId)
      return 'failed'
    }
  }

  private logFileFailure(taskId: string): void {
    this.logger.warn(`code=CONTRACT_REVIEW_CLEANUP_FILE_FAILED task=${digestIdentifier(taskId)}`)
  }
}

function isFileId(value: string | null): value is string {
  return typeof value === 'string' && value.length > 0
}

function digestIdentifier(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}
