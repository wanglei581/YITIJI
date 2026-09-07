import { ConflictException } from '@nestjs/common'
import { createHash } from 'crypto'
import type { PrismaService } from '../prisma/prisma.service'
import type { StorageService } from '../storage/storage.service'

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u
const DIRECT_UPLOAD_COMPLETE_ACTION = 'file.direct_upload_completed'

/**
 * COS pre-signed PUT URLs cannot be revoked by this API after issuance. Instead,
 * every server-controlled read, download grant, and print path rechecks the
 * server SHA-256 baseline recorded by completeUpload before using the object.
 */
export async function assertFileContentIntegrity(args: {
  prisma: PrismaService
  storage: StorageService
  fileId: string
}): Promise<void> {
  const baseline = await args.prisma.auditLog.findFirst({
    where: {
      action: DIRECT_UPLOAD_COMPLETE_ACTION,
      targetType: 'file',
      targetId: args.fileId,
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  // Proxy uploads are immutable through the API CAS path and pre-date this
  // direct-upload baseline. Only completed direct uploads need this recheck.
  if (!baseline) return

  const record = await args.prisma.fileObject.findUnique({
    where: { id: args.fileId },
    select: { id: true, storageKey: true, bucket: true, sha256: true, status: true, deletedAt: true },
  })
  if (!record || record.deletedAt || record.status !== 'active') return

  let changed = !SHA256_HEX_PATTERN.test(record.sha256)
  if (!changed) {
    const bytes = await args.storage.getObject(record.storageKey, record.bucket)
    changed = createHash('sha256').update(bytes).digest('hex') !== record.sha256
  }
  if (!changed) return

  await args.prisma.fileObject.updateMany({
    where: { id: record.id, status: 'active', deletedAt: null },
    data: { status: 'quarantined' },
  })
  await args.prisma.auditLog.create({
    data: {
      actorId: null,
      actorRole: 'system',
      action: 'file.content_tampered',
      targetType: 'file',
      targetId: record.id,
      payloadJson: JSON.stringify({ source: 'direct_upload', baselinePresent: true }),
    },
  }).catch(() => undefined)
  throw new ConflictException({
    error: {
      code: 'FILE_CONTENT_CHANGED',
      message: '文件内容已变化，已停止使用，请重新上传',
    },
  })
}

export { DIRECT_UPLOAD_COMPLETE_ACTION }
