import type {
  FileAssetCategory,
  FileMetadata,
  FileOwnerType,
  FilePurpose,
  FileRetentionPolicy,
  FileSensitiveLevel,
  FileStatus,
} from './file.types'

/**
 * 管理端文件元数据映射。
 *
 * 从 files.service.ts 拆出：该文件已超过 1000 行，只能净减少。
 * 文档页数要写进上传落库路径，这段纯映射不能继续留在原文件里。
 * 这里不带 pageCount。会员文档列表单独映射，避免管理端元数据多出存储字段。
 */

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
    retentionSetBy: r.retentionSetBy as FileMetadata['retentionSetBy'],
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
