import { Injectable } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { FilesService } from '../files/files.service'
import { MemberDataExportFileService } from '../files/member-data-export-file.service'
import { PrismaService } from '../prisma/prisma.service'
import {
  MemberDataExportLimitError,
  MemberDataExportMapper,
} from './member-data-export.mapper'

export const MEMBER_EXPORT_MAX_BYTES = 10 * 1024 * 1024
export const MEMBER_EXPORT_RETENTION_MS = 23 * 60 * 60 * 1000
export const MEMBER_EXPORT_HANDLING_LEASE_MS = 10 * 60 * 1000

type ExportFailureCode = 'EXPORT_ARTIFACT_MISSING' | 'EXPORT_TOO_LARGE' | 'EXPORT_CLEANUP_FAILED'
type ExportExecutionResult =
  | { status: 'ready'; fileId: string; sizeBytes: number }
  | { status: 'noop'; requestStatus: string }

type ExportRequest = {
  id: string
  endUserId: string
  requestType: string
  status: string
  executionVersion: number
  exportFileId: string | null
  exportExpiresAt: Date | null
  lastAttemptAt: Date | null
}

class ExportExecutionError extends Error {
  constructor(readonly code: ExportFailureCode) {
    super(code)
  }
}

@Injectable()
export class MemberDataExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mapper: MemberDataExportMapper,
    private readonly exportFiles: MemberDataExportFileService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  async execute(requestId: string, executionVersion: number): Promise<ExportExecutionResult> {
    this.assertExecutionInput(requestId, executionVersion)
    const now = new Date()
    const request = await this.getRequest(requestId)
    if (!request || request.requestType !== 'export') throw new ExportExecutionError('EXPORT_ARTIFACT_MISSING')
    if (request.status === 'ready') return this.verifyReadyArtifact(request)
    if (this.isIdempotentTerminal(request.status)) return { status: 'noop', requestStatus: request.status }
    if (request.executionVersion !== executionVersion) return { status: 'noop', requestStatus: request.status }

    const claimed = await this.prisma.userDataRequest.updateMany({
      where: {
        id: requestId,
        requestType: 'export',
        executionVersion,
        status: { in: ['pending', 'failed'] },
        exportFileId: null,
        OR: [{ failureCode: null }, { failureCode: { not: 'EXPORT_CLEANUP_FAILED' } }],
      },
      data: {
        status: 'handling',
        executionStep: 'export_building',
        lastAttemptAt: now,
        failureCode: null,
        failureMessage: null,
      },
    })
    if (claimed.count !== 1) await this.claimStaleHandling(requestId, executionVersion, now)

    let pendingFileId: string | null = null
    let cleanupAttempted = false
    try {
      const claimedRequest = await this.getRequest(requestId)
      if (!claimedRequest || claimedRequest.executionVersion !== executionVersion) {
        throw new ExportExecutionError('EXPORT_ARTIFACT_MISSING')
      }
      if (claimedRequest.status === 'ready') return this.verifyReadyArtifact(claimedRequest)
      if (this.isIdempotentTerminal(claimedRequest.status)) {
        return { status: 'noop', requestStatus: claimedRequest.status }
      }
      if (claimedRequest.status !== 'handling') throw new ExportExecutionError('EXPORT_ARTIFACT_MISSING')

      const envelope = await this.mapper.build({
        endUserId: claimedRequest.endUserId,
        requestId,
        generatedAt: now,
      })
      const buffer = Buffer.from(JSON.stringify(envelope), 'utf8')
      if (buffer.length > MEMBER_EXPORT_MAX_BYTES) throw new MemberDataExportLimitError()

      const expiresAt = new Date(now.getTime() + MEMBER_EXPORT_RETENTION_MS)
      const file = await this.exportFiles.create({ buffer, endUserId: claimedRequest.endUserId, expiresAt })
      pendingFileId = file.fileId
      const ready = await this.persistReady(requestId, executionVersion, file.fileId, expiresAt)
      if (!ready) {
        try {
          await this.files.systemDelete(file.fileId, 'member_data_export_orphan_ready_cas_failed')
          pendingFileId = null
        } catch {
          cleanupAttempted = true
          throw new ExportExecutionError('EXPORT_CLEANUP_FAILED')
        }
        const current = await this.getRequest(requestId)
        if (current?.status === 'ready') return this.verifyReadyArtifact(current)
        if (current && this.isIdempotentTerminal(current.status)) {
          return { status: 'noop', requestStatus: current.status }
        }
        throw new ExportExecutionError('EXPORT_ARTIFACT_MISSING')
      }
      pendingFileId = null
      return { status: 'ready', fileId: file.fileId, sizeBytes: file.sizeBytes }
    } catch (error) {
      let failureCode = this.failureCode(error)
      if (pendingFileId && !cleanupAttempted) {
        cleanupAttempted = true
        try {
          await this.files.systemDelete(pendingFileId, 'member_data_export_generation_failed')
          pendingFileId = null
        } catch {
          failureCode = 'EXPORT_CLEANUP_FAILED'
        }
      }
      await this.persistFailure(
        requestId,
        executionVersion,
        failureCode,
        failureCode === 'EXPORT_CLEANUP_FAILED' ? pendingFileId : null,
      )
      if (
        (error instanceof ExportExecutionError || error instanceof MemberDataExportLimitError)
        && failureCode === this.failureCode(error)
      ) {
        throw error
      }
      throw new ExportExecutionError(failureCode)
    }
  }

  private async persistReady(
    requestId: string,
    executionVersion: number,
    fileId: string,
    expiresAt: Date,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const readyCas = await tx.userDataRequest.updateMany({
        where: {
          id: requestId,
          requestType: 'export',
          status: 'handling',
          executionVersion,
          exportFileId: null,
        },
        data: {
          status: 'ready',
          executionStep: null,
          exportFileId: fileId,
          exportExpiresAt: expiresAt,
          failureCode: null,
          failureMessage: null,
        },
      })
      if (readyCas.count !== 1) return false
      const auditRef = await this.audit.writeRequired(tx, {
        actorId: null,
        actorRole: 'system',
        action: 'member_data_export.ready',
        targetType: 'user_data_request',
        targetId: requestId,
        payload: { executionVersion },
      })
      await tx.userDataRequest.update({ where: { id: requestId }, data: { auditRef } })
      return true
    })
  }

  private async persistFailure(
    requestId: string,
    executionVersion: number,
    failureCode: ExportFailureCode,
    orphanFileId: string | null,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const failedCas = await tx.userDataRequest.updateMany({
        where: {
          id: requestId,
          requestType: 'export',
          status: 'handling',
          executionVersion,
          exportFileId: null,
        },
        data: {
          status: 'failed',
          executionStep: failureCode === 'EXPORT_CLEANUP_FAILED' ? 'orphan_cleanup_pending' : null,
          ...(orphanFileId ? { exportFileId: orphanFileId } : {}),
          failureCode,
          failureMessage: this.failureMessage(failureCode),
          lastAttemptAt: new Date(),
        },
      })
      if (failedCas.count !== 1) return
      const auditRef = await this.audit.writeRequired(tx, {
        actorId: null,
        actorRole: 'system',
        action: 'member_data_export.failed',
        targetType: 'user_data_request',
        targetId: requestId,
        payload: { executionVersion, failureCode },
      })
      await tx.userDataRequest.update({ where: { id: requestId }, data: { auditRef } })
    })
  }

  private async verifyReadyArtifact(request: ExportRequest): Promise<ExportExecutionResult> {
    if (request.exportExpiresAt && request.exportExpiresAt.getTime() <= Date.now()) {
      return { status: 'noop', requestStatus: request.status }
    }
    const inspection = request.exportFileId
      ? await this.exportFiles.inspect(request.exportFileId, request.endUserId)
      : { status: 'missing' as const, tracked: false }
    if (inspection.status === 'available') {
      return { status: 'noop', requestStatus: request.status }
    }

    const failureCode: ExportFailureCode = inspection.tracked
      ? 'EXPORT_CLEANUP_FAILED'
      : 'EXPORT_ARTIFACT_MISSING'
    await this.prisma.$transaction(async (tx) => {
      const auditRef = await this.audit.writeRequired(tx, {
        actorId: null,
        actorRole: 'system',
        action: 'member_data_export.failed',
        targetType: 'user_data_request',
        targetId: request.id,
        payload: { executionVersion: request.executionVersion, failureCode },
      })
      const cas = await tx.userDataRequest.updateMany({
        where: {
          id: request.id,
          requestType: 'export',
          status: 'ready',
          executionVersion: request.executionVersion,
          exportFileId: request.exportFileId,
        },
        data: {
          status: 'failed',
          executionStep: inspection.tracked ? 'orphan_cleanup_pending' : null,
          ...(!inspection.tracked ? { exportFileId: null, exportExpiresAt: null } : {}),
          failureCode,
          failureMessage: this.failureMessage(failureCode),
          lastAttemptAt: new Date(),
          auditRef,
        },
      })
      if (cas.count !== 1) throw new ExportExecutionError('EXPORT_ARTIFACT_MISSING')
    })
    throw new ExportExecutionError('EXPORT_ARTIFACT_MISSING')
  }

  private async claimStaleHandling(requestId: string, executionVersion: number, now: Date): Promise<void> {
    const current = await this.getRequest(requestId)
    if (!current) throw new ExportExecutionError('EXPORT_ARTIFACT_MISSING')
    if (this.isIdempotentTerminal(current.status) || current.executionVersion !== executionVersion) return
    if (current.status !== 'handling') throw new ExportExecutionError('EXPORT_ARTIFACT_MISSING')
    const leaseCutoff = new Date(now.getTime() - MEMBER_EXPORT_HANDLING_LEASE_MS)
    if (current.lastAttemptAt && current.lastAttemptAt > leaseCutoff) {
      const error = new Error('DATA_REQUEST_IN_PROGRESS') as Error & { code: string }
      error.code = 'DATA_REQUEST_IN_PROGRESS'
      throw error
    }
    const reclaimed = await this.prisma.userDataRequest.updateMany({
      where: {
        id: requestId,
        requestType: 'export',
        status: 'handling',
        executionVersion,
        OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lte: leaseCutoff } }],
      },
      data: { executionStep: 'export_building', lastAttemptAt: now },
    })
    if (reclaimed.count !== 1) {
      const error = new Error('DATA_REQUEST_IN_PROGRESS') as Error & { code: string }
      error.code = 'DATA_REQUEST_IN_PROGRESS'
      throw error
    }
  }

  private getRequest(id: string): Promise<ExportRequest | null> {
    return this.prisma.userDataRequest.findUnique({
      where: { id },
      select: {
        id: true,
        endUserId: true,
        requestType: true,
        status: true,
        executionVersion: true,
        exportFileId: true,
        exportExpiresAt: true,
        lastAttemptAt: true,
      },
    })
  }

  private isIdempotentTerminal(status: string): boolean {
    return status === 'completed'
      || status === 'expired'
      || status === 'rejected'
      || status === 'cancelled'
  }

  private failureCode(error: unknown): ExportFailureCode {
    if (error instanceof MemberDataExportLimitError) return 'EXPORT_TOO_LARGE'
    if (error instanceof ExportExecutionError) return error.code
    return 'EXPORT_ARTIFACT_MISSING'
  }

  private failureMessage(code: ExportFailureCode): string {
    if (code === 'EXPORT_TOO_LARGE') return 'export exceeded configured limits'
    if (code === 'EXPORT_CLEANUP_FAILED') return 'export orphan cleanup failed'
    return 'export artifact generation failed'
  }

  private assertExecutionInput(requestId: string, executionVersion: number): void {
    if (!requestId || requestId.length > 128 || !Number.isSafeInteger(executionVersion) || executionVersion < 0) {
      throw new ExportExecutionError('EXPORT_ARTIFACT_MISSING')
    }
  }
}
