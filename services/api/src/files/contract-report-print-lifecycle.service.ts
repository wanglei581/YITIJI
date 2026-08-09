import { HttpException, Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { createHash } from 'node:crypto'
import { PrismaService } from '../prisma/prisma.service'
import { FilesService } from './files.service'

const ACTIVE_PRINT_STATUSES = ['pending', 'claimed', 'printing'] as const
const TERMINAL_PRINT_STATUSES = ['completed', 'failed', 'cancelled', 'abandoned'] as const
const CLEANUP_BATCH_SIZE = 100

/**
 * 合同风险提示报告进入 PrintTask 后的专用生命周期。
 *
 * - 活跃打印任务存在时，报告即使超过合同会话 TTL 也必须保留给 Agent 下载。
 * - 打印进入终态后立即尝试物理删除；失败由十分钟 reconciler 与通用 TTL 再次收口。
 * - 不记录报告 fileId、文件名或对象存储 key。
 */
@Injectable()
export class ContractReportPrintLifecycleService {
  private readonly logger = new Logger(ContractReportPrintLifecycleService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  async cleanupTerminalTask(taskId: string): Promise<void> {
    try {
      const task = await this.prisma.printTask.findUnique({
        where: { id: taskId },
        select: { status: true, fileId: true },
      })
      if (
        !task?.fileId ||
        !TERMINAL_PRINT_STATUSES.includes(
          task.status as (typeof TERMINAL_PRINT_STATUSES)[number],
        )
      ) return
      await this.cleanupFile(task.fileId)
    } catch (error) {
      this.logFailure('terminal', taskId, error)
    }
  }

  @Cron('*/10 * * * *')
  async handleReconcile(): Promise<void> {
    try {
      const candidates = await this.prisma.fileObject.findMany({
        where: {
          purpose: 'contract_review_report',
          deletedAt: null,
          printTasks: { some: { status: { in: [...TERMINAL_PRINT_STATUSES] } } },
        },
        orderBy: { createdAt: 'asc' },
        take: CLEANUP_BATCH_SIZE,
        select: { id: true },
      })
      for (const candidate of candidates) await this.cleanupFile(candidate.id)
    } catch (error) {
      this.logFailure('batch', 'contract-report-print-reconcile', error)
    }
  }

  private async cleanupFile(fileId: string): Promise<void> {
    const file = await this.prisma.fileObject.findUnique({
      where: { id: fileId },
      select: { purpose: true, deletedAt: true },
    })
    if (!file || file.deletedAt || file.purpose !== 'contract_review_report') return
    const active = await this.prisma.printTask.findFirst({
      where: { fileId, status: { in: [...ACTIVE_PRINT_STATUSES] } },
      select: { id: true },
    })
    if (active) return
    try {
      await this.files.systemDeleteSensitive(fileId, 'contract_review_report_print_terminal')
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 404) return
      this.logFailure('file', fileId, error)
    }
  }

  private logFailure(stage: string, identifier: string, error: unknown): void {
    const errorType = error instanceof Error && error.name ? error.name : typeof error
    this.logger.warn(
      `code=CONTRACT_REPORT_PRINT_CLEANUP_FAILED stage=${stage} ref=${digest(identifier)} errorType=${errorType}`,
    )
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12)
}
