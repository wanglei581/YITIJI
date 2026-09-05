import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { FilesService } from '../files/files.service'
import { verifyContractReportAbandonToken } from '../files/signing'
import { PrismaService } from '../prisma/prisma.service'
import { ContractReviewReportFileService } from './contract-review-report-file.service'
import { ContractReviewReportPdfService } from './contract-review-report-pdf.service'
import type {
  ContractReviewReportView,
  ContractReviewResult,
  ContractReviewTaskRow,
} from './contract-review.types'

export const CONTRACT_REVIEW_REPORT_ENABLED = Symbol('CONTRACT_REVIEW_REPORT_ENABLED')
const SOURCE_DELETE_REASON = 'contract_review_report_generated'
const LOSING_REPORT_DELETE_REASON = 'contract_review_report_race_loser'
// 覆盖 5 分钟 Kiosk 建单交互窗口与 30 分钟 Agent 下载签名窗口。
const MIN_REPORT_REMAINING_MS = 35 * 60 * 1000

@Injectable()
export class ContractReviewReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: ContractReviewReportPdfService,
    private readonly reportFiles: ContractReviewReportFileService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    @Inject(CONTRACT_REVIEW_REPORT_ENABLED)
    private readonly enabled: boolean,
  ) {}

  async create(args: {
    task: ContractReviewTaskRow
    result: ContractReviewResult
  }): Promise<ContractReviewReportView> {
    if (!this.enabled) throw reportUnavailable(false)
    const now = new Date()
    this.assertReady(args.task, now)

    const existing = await this.resolveExisting(args.task)
    if (existing) {
      await this.deleteSource(args.task.sourceFileId)
      await this.auditReport(args.task, existing, true)
      return existing
    }

    const rendered = await this.pdf.render({
      taskId: args.task.id,
      result: args.result,
      generatedAt: now,
    })
    const candidate = await this.reportFiles.create({
      buffer: rendered.buffer,
      pageCount: rendered.pageCount,
      endUserId: args.task.endUserId,
      sourceFileId: args.task.sourceFileId,
      expiresAt: args.task.expiresAt,
    })

    let won = false
    try {
      const attached = await this.prisma.contractReviewTask.updateMany({
        where: {
          id: args.task.id,
          status: 'completed',
          resultFileId: null,
          expiresAt: { gt: now },
        },
        data: { resultFileId: candidate.fileId },
      })
      won = attached.count === 1
      if (!won) {
        await this.deleteCandidate(candidate.fileId)
        const raced = await this.prisma.contractReviewTask.findUnique({
          where: { id: args.task.id },
          select: {
            id: true,
            status: true,
            expiresAt: true,
            resultFileId: true,
            sourceFileId: true,
            endUserId: true,
          },
        })
        if (!raced || raced.status !== 'completed' || raced.expiresAt.getTime() <= Date.now()) {
          throw invalidState()
        }
        if (!raced.resultFileId) throw reportUnavailable(true)
        const winner = await this.reportFiles.getAvailable({
          fileId: raced.resultFileId,
          endUserId: raced.endUserId,
          sourceFileId: raced.sourceFileId,
        })
        if (!winner) throw reportUnavailable(true)
        await this.deleteSource(raced.sourceFileId)
        await this.auditReport(args.task, winner, true)
        return winner
      }

      await this.deleteSource(args.task.sourceFileId)
      await this.auditReport(args.task, candidate, false)
      return candidate
    } catch (error) {
      // 已赢得 CAS 的报告必须保留：源合同删除失败时，下一次请求会复用报告并重试删除。
      // 只有尚未挂到任务上的候选文件才允许补偿清理。
      if (!won) await this.deleteCandidate(candidate.fileId)
      throw error
    }
  }

  async abandon(
    fileId: string,
    token: string | null,
  ): Promise<{ fileId: string; deleted: boolean; protectedByPrintTask: boolean }> {
    let tokenValid = false
    try {
      tokenValid = Boolean(
        fileId && fileId.length <= 128 && token && token.length <= 256 &&
        verifyContractReportAbandonToken(fileId, token),
      )
    } catch {
      tokenValid = false
    }
    if (!tokenValid) throw reportNotFound()

    const report = await this.prisma.fileObject.findUnique({
      where: { id: fileId },
      select: { id: true, purpose: true, deletedAt: true },
    })
    if (!report || report.purpose !== 'contract_review_report') throw reportNotFound()
    if (report.deletedAt) {
      return { fileId, deleted: true, protectedByPrintTask: false }
    }
    const printTask = await this.prisma.printTask.findFirst({
      where: { fileId },
      select: { id: true },
    })
    if (printTask) {
      return { fileId, deleted: false, protectedByPrintTask: true }
    }
    try {
      await this.files.systemDeleteSensitive(fileId, 'contract_review_report_abandoned')
    } catch (error) {
      if (!(error instanceof HttpException) || error.getStatus() !== 404) {
        throw reportUnavailable(true)
      }
    }
    await this.audit.write({
      actorId: null,
      actorRole: 'anonymous_report_capability',
      action: 'contract_review.report_abandoned',
      targetType: 'file_object',
      targetId: null,
      payload: { deleted: true },
    })
    return { fileId, deleted: true, protectedByPrintTask: false }
  }

  private async resolveExisting(task: ContractReviewTaskRow): Promise<ContractReviewReportView | null> {
    if (!task.resultFileId) return null
    const available = await this.reportFiles.getAvailable({
      fileId: task.resultFileId,
      endUserId: task.endUserId,
      sourceFileId: task.sourceFileId,
    })
    if (available) return available

    const detached = await this.prisma.contractReviewTask.updateMany({
      where: { id: task.id, status: 'completed', resultFileId: task.resultFileId },
      data: { resultFileId: null },
    })
    if (detached.count === 1) return null
    const raced = await this.prisma.contractReviewTask.findUnique({
      where: { id: task.id },
      select: { resultFileId: true, sourceFileId: true, endUserId: true },
    })
    if (!raced?.resultFileId) return null
    return this.reportFiles.getAvailable({
      fileId: raced.resultFileId,
      endUserId: raced.endUserId,
      sourceFileId: raced.sourceFileId,
    })
  }

  private assertReady(task: ContractReviewTaskRow, now: Date): void {
    if (task.status !== 'completed' || task.expiresAt.getTime() <= now.getTime()) {
      throw invalidState()
    }
    if (task.expiresAt.getTime() - now.getTime() < MIN_REPORT_REMAINING_MS) {
      throw reportUnavailable(false)
    }
  }

  private async deleteSource(sourceFileId: string): Promise<void> {
    try {
      await this.files.systemDeleteSensitive(sourceFileId, SOURCE_DELETE_REASON)
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 404) return
      throw new ServiceUnavailableException({
        error: {
          code: 'CONTRACT_REVIEW_SOURCE_DELETE_RETRY',
          message: '风险提示报告已生成，原合同清理暂未完成，请稍后重试',
          retryable: true,
        },
      })
    }
  }

  private async deleteCandidate(fileId: string): Promise<void> {
    try {
      await this.files.systemDeleteSensitive(fileId, LOSING_REPORT_DELETE_REASON)
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 404) return
      // 文件生命周期任务仍会按短期 expiresAt 回收；不覆盖主错误，也不记录 fileId。
    }
  }

  private async auditReport(
    task: ContractReviewTaskRow,
    report: ContractReviewReportView,
    reused: boolean,
  ): Promise<void> {
    await this.audit.write({
      actorId: null,
      actorRole: task.endUserId ? 'member' : 'anonymous',
      action: 'contract_review.report_generated',
      targetType: 'contract_review_task',
      targetId: task.id,
      payload: { endUserId: task.endUserId, reused, pages: report.pages, sourceDeleted: true },
    })
  }
}

function reportUnavailable(retryable: boolean): ServiceUnavailableException {
  return new ServiceUnavailableException({
    error: {
      code: 'REPORT_NOT_AVAILABLE',
      message: '合同审查报告暂不可用',
      retryable,
    },
  })
}

function invalidState(): ConflictException {
  return new ConflictException({
    error: {
      code: 'CONTRACT_REVIEW_REPORT_STATE_INVALID',
      message: '当前合同审查任务不能生成报告',
    },
  })
}

function reportNotFound(): HttpException {
  return new HttpException({
    error: { code: 'CONTRACT_REVIEW_REPORT_NOT_FOUND', message: '风险提示报告不存在或已失效' },
  }, 404)
}
