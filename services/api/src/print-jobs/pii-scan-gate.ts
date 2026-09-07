import { BadRequestException, ConflictException } from '@nestjs/common'
import type { AuditService } from '../audit/audit.service'
import type { PrismaService } from '../prisma/prisma.service'

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u

export const PII_SCAN_REQUIRED_PURPOSES = new Set(['resume_upload', 'resume_scan', 'print_doc', 'id_scan'])

type PiiGateArgs = {
  prisma: PrismaService
  audit?: AuditService
  fileId: string
  requireCompleted: boolean
  actorRole?: string
  missingMessage: string
  pendingMessage: string
  pendingCode?: string
}

/**
 * Shared print PII gate. A completed scan is bound to the exact server SHA-256
 * captured in DocumentProcessTask.paramsJson; a missing SHA is deliberately
 * stale, including direct COS uploads above the server sniffing threshold.
 */
export async function assertPiiScanned(args: PiiGateArgs): Promise<void> {
  const file = await args.prisma.fileObject.findUnique({
    where: { id: args.fileId },
    select: { purpose: true, assetCategory: true, sha256: true },
  })
  if (!file) return

  const isDerived = file.assetCategory === 'derived' || file.assetCategory === 'optimized'
  if (isDerived || !PII_SCAN_REQUIRED_PURPOSES.has(file.purpose)) return

  const scan = await args.prisma.documentProcessTask.findFirst({
    where: { sourceFileId: args.fileId, kind: 'pii_scan', status: 'completed' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, paramsJson: true },
  })
  const pendingFindings = scan
    ? await args.prisma.piiFinding.count({ where: { taskId: scan.id, action: 'pending' } })
    : 0

  if (scan && pendingFindings === 0) {
    const scanSha = readPiiScanSourceSha256(scan.paramsJson)
    if (!SHA256_HEX_PATTERN.test(file.sha256) || file.sha256 !== scanSha) {
      throw new ConflictException({
        error: {
          code: 'PII_SCAN_STALE',
          message: '文件在隐私检查后又被改过，请重新检查后再打印',
        },
      })
    }
    return
  }

  if (!args.requireCompleted) {
    await args.audit?.write({
      actorId: null,
      actorRole: args.actorRole ?? 'kiosk',
      action: 'print_job.pii_scan_bypassed',
      targetType: 'file_object',
      targetId: args.fileId,
      payload: {
        reason: !scan ? 'PII_SCAN_MISSING' : 'PII_DECISIONS_PENDING',
        purpose: file.purpose,
        assetCategory: file.assetCategory,
        pendingFindings,
      },
    })
    return
  }

  throw new BadRequestException({
    error: {
      code: scan && pendingFindings > 0 ? (args.pendingCode ?? 'PRINT_PII_SCAN_REQUIRED') : 'PRINT_PII_SCAN_REQUIRED',
      message: scan && pendingFindings > 0 ? args.pendingMessage : args.missingMessage,
    },
  })
}

function readPiiScanSourceSha256(paramsJson: string | null): string {
  try {
    const parsed = JSON.parse(paramsJson || '{}') as { sourceSha256?: unknown }
    return typeof parsed.sourceSha256 === 'string' ? parsed.sourceSha256 : ''
  } catch {
    return ''
  }
}
