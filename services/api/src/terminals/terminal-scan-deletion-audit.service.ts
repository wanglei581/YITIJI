import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type { ReportScanDeletionAuditDto } from './dto/report-scan-deletion-audit.dto'

const ALLOWED_TRANSITIONS: Record<ReportScanDeletionAuditDto['result'], ReportScanDeletionAuditDto['result'][]> = {
  pending_delete: ['pending_delete', 'delete_failed', 'deleted'],
  delete_failed: ['delete_failed', 'deleted'],
  deleted: ['deleted'],
}

@Injectable()
export class TerminalScanDeletionAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async persist(
    terminalId: string,
    dto: ReportScanDeletionAuditDto,
  ): Promise<{ acknowledged: true; eventId: string }> {
    this.assertPayloadState(dto)

    await this.prisma.$transaction(async (tx) => {
      const key = { terminalId_eventId: { terminalId, eventId: dto.eventId } }
      const eventCreatedAt = new Date(dto.createdAt)
      const lastDeleteAttemptAt = new Date(dto.lastDeleteAttemptAt)
      const deletedAt = dto.deletedAt ? new Date(dto.deletedAt) : null
      const existing = await tx.terminalScanDeletionAudit.upsert({
        where: key,
        create: {
          terminalId,
          eventId: dto.eventId,
          reasonCode: dto.reasonCode,
          identifierHash: dto.identifierHash,
          eventCreatedAt,
          deletedAt,
          result: dto.result,
          deleteAttempts: dto.deleteAttempts,
          lastDeleteAttemptAt,
          lastErrorCode: dto.lastErrorCode ?? null,
        },
        update: {},
      })

      if (
        existing.reasonCode !== dto.reasonCode ||
        existing.identifierHash !== dto.identifierHash ||
        existing.eventCreatedAt.getTime() !== eventCreatedAt.getTime()
      ) {
        this.fail('SCAN_DELETION_AUDIT_EVENT_CONFLICT', '删除审计事件标识冲突')
      }

      const exactReplay =
        existing.result === dto.result &&
        existing.deleteAttempts === dto.deleteAttempts &&
        existing.lastDeleteAttemptAt.getTime() === lastDeleteAttemptAt.getTime() &&
        (existing.deletedAt?.getTime() ?? null) === (deletedAt?.getTime() ?? null) &&
        existing.lastErrorCode === (dto.lastErrorCode ?? null)
      if (exactReplay) return

      if (!ALLOWED_TRANSITIONS[existing.result as ReportScanDeletionAuditDto['result']]?.includes(dto.result)) {
        this.fail('SCAN_DELETION_AUDIT_STATE_REGRESSION', '删除审计状态不能回退')
      }
      if (dto.deleteAttempts < existing.deleteAttempts) {
        this.fail('SCAN_DELETION_AUDIT_ATTEMPTS_REGRESSION', '删除尝试次数不能回退')
      }
      if (lastDeleteAttemptAt < existing.lastDeleteAttemptAt) {
        this.fail('SCAN_DELETION_AUDIT_ATTEMPT_TIME_REGRESSION', '最后删除尝试时间不能回退')
      }

      await tx.terminalScanDeletionAudit.update({
        where: key,
        data: {
          deletedAt,
          result: dto.result,
          deleteAttempts: dto.deleteAttempts,
          lastDeleteAttemptAt,
          lastErrorCode: dto.lastErrorCode ?? null,
        },
      })
    })

    // The acknowledgement is constructed only after the transaction commits.
    return { acknowledged: true, eventId: dto.eventId }
  }

  private assertPayloadState(dto: ReportScanDeletionAuditDto): void {
    const eventCreatedAt = new Date(dto.createdAt)
    const lastDeleteAttemptAt = new Date(dto.lastDeleteAttemptAt)
    const deletedAt = dto.deletedAt ? new Date(dto.deletedAt) : null
    const lastErrorCode = dto.lastErrorCode ?? null
    const validState =
      (dto.result === 'pending_delete' && deletedAt === null && lastErrorCode === null) ||
      (dto.result === 'deleted' && deletedAt !== null && lastErrorCode === null) ||
      (dto.result === 'delete_failed' && deletedAt === null && lastErrorCode !== null)
    const validTimeline =
      lastDeleteAttemptAt >= eventCreatedAt &&
      (deletedAt === null || deletedAt >= lastDeleteAttemptAt)
    if (!validState || !validTimeline) {
      this.fail(
        'SCAN_DELETION_AUDIT_STATE_INVALID',
        '删除审计状态与时间或错误码不一致',
      )
    }
  }

  private fail(code: string, message: string): never {
    throw new BadRequestException({ error: { code, message } })
  }
}
