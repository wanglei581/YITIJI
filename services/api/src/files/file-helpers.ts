/**
 * 文件模块纯工具函数 — 无 NestJS DI 依赖，可在任意层安全 import。
 */
import { createHash } from 'crypto'
import type {
  FileAssetCategory,
  FileMetadata,
  FileOwnerType,
  FilePurpose,
  FileRetentionPolicy,
  FileRetentionSetBy,
  FileSensitiveLevel,
  FileStatus,
} from './file.types'
import type { UserRole } from '../common/decorators/roles.decorator'

/**
 * COS 直传 completeUpload 阶段允许整读回嗅探的对象大小上限。
 * StorageService 暂无 Range 读取，超过此值的对象跳过嗅探，避免把数百 MB 读进内存。
 */
export const DIRECT_UPLOAD_SNIFF_MAX_BYTES = 32 * 1024 * 1024

/**
 * 文件请求者（下载 / 预览 / 删除鉴权用）。
 *   - user:  后台 User(admin / partner / kiosk)，来自 User JWT。
 *   - member: C 端求职者(EndUser)，来自 member token。
 */
export type FileRequester =
  | { kind: 'user'; userId: string; role: UserRole; orgId: string | null }
  | { kind: 'member'; endUserId: string }

/** fileId SHA-256 前 12 位摘要，用于日志脱敏。 */
export function digestFileId(fileId: string): string {
  return createHash('sha256').update(fileId).digest('hex').slice(0, 12)
}

/** 归属判定。member 只能访问 endUserId 匹配；User 按角色 / 上传者 / 机构。 */
export function canAccessFile(
  record: {
    uploaderId: string | null
    endUserId: string | null
    ownerType: string | null
    ownerId: string | null
  },
  requester: FileRequester
): boolean {
  if (requester.kind === 'member') {
    return Boolean(record.endUserId) && record.endUserId === requester.endUserId
  }
  // requester.kind === 'user'
  if (requester.role === 'admin') return true
  if (record.uploaderId && record.uploaderId === requester.userId) return true
  // 合作机构只能访问本机构(partner)文件，绝不能访问用户简历(ownerType='user')
  if (
    requester.role === 'partner' &&
    record.ownerType === 'partner' &&
    record.ownerId &&
    requester.orgId &&
    record.ownerId === requester.orgId
  ) {
    return true
  }
  return false
}

/** 由上传上下文推断 ownerType / ownerId。 */
export function deriveOwner(args: {
  endUserId: string | null
  role: UserRole | null
  uploaderId: string | null
  orgId: string | null
}): {
  ownerType: FileOwnerType
  ownerId: string | null
} {
  if (args.endUserId) return { ownerType: 'user', ownerId: args.endUserId }
  if (args.role === 'admin') return { ownerType: 'admin', ownerId: args.uploaderId }
  if (args.role === 'partner') return { ownerType: 'partner', ownerId: args.orgId }
  return { ownerType: 'system', ownerId: null }
}

/** Prisma 行 → FileMetadata DTO 转换（member_data_export 路径做字段遮蔽）。 */
export function toMetadata(r: {
  id: string
  bucket: string
  region: string
  storageKey: string
  filename: string
  mimeType: string
  sizeBytes: number
  sha256: string
  purpose: string
  sensitiveLevel: string
  ownerType: string | null
  ownerId: string | null
  visibility: string
  status: string
  assetCategory: string
  sourceFileId: string | null
  retentionPolicy: string | null
  retentionSetBy: string | null
  retentionConsentAt: Date | null
  retentionConsentVersion: string | null
  retentionLockedReason: string | null
  uploaderId: string | null
  endUserId: string | null
  createdBy: string | null
  expiresAt: Date | null
  deletedAt: Date | null
  deletedBy: string | null
  deleteReason: string | null
  createdAt: Date
}): FileMetadata {
  const protectedExport = r.purpose === 'member_data_export'
  return {
    id: r.id,
    bucket: protectedExport ? '' : r.bucket,
    region: protectedExport ? '' : r.region,
    objectKey: protectedExport ? '' : r.storageKey,
    filename: r.filename,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    sha256: protectedExport ? '' : r.sha256,
    purpose: r.purpose as FilePurpose,
    sensitiveLevel: r.sensitiveLevel as FileSensitiveLevel,
    ownerType: r.ownerType as FileOwnerType | null,
    ownerId: r.ownerId,
    visibility: r.visibility as FileMetadata['visibility'],
    status: r.status as FileStatus,
    assetCategory: r.assetCategory as FileAssetCategory,
    sourceFileId: r.sourceFileId,
    retentionPolicy: r.retentionPolicy as FileRetentionPolicy | null,
    retentionSetBy: r.retentionSetBy as FileRetentionSetBy | null,
    retentionConsentAt: r.retentionConsentAt?.toISOString() ?? null,
    retentionConsentVersion: r.retentionConsentVersion,
    retentionLockedReason: r.retentionLockedReason,
    uploaderId: r.uploaderId,
    endUserId: r.endUserId,
    createdBy: r.createdBy,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    deletedAt: r.deletedAt?.toISOString() ?? null,
    deletedBy: r.deletedBy,
    deleteReason: r.deleteReason,
    createdAt: r.createdAt.toISOString(),
  }
}
