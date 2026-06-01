/**
 * 文件契约本地副本。
 *
 * **契约源**:packages/shared/src/types/file.ts
 *
 * 为什么不直接 import @ai-job-print/shared:
 *   services/api 走 commonjs + node moduleResolution,而 packages/shared 是
 *   ESM-only,exports 字段直接指向 .ts。两者互操作复杂,decision 是把类型
 *   本地副本化、严格遵守 SSOT 注释,任何改动同步两处。
 *
 * 任何字段变更必须同时改两处:
 *   1. packages/shared/src/types/file.ts(前端 SSOT)
 *   2. 本文件(后端副本)
 * 改完搜 git diff 确认两边一致。
 */

export type FilePurpose =
  | 'resume_upload'
  | 'resume_scan'
  | 'id_scan'
  | 'print_doc'
  | 'fair_material'
  | 'cover_letter'

export type FileSensitiveLevel = 'normal' | 'sensitive' | 'highly_sensitive'

export const FILE_DEFAULT_TTL_HOURS: Record<FileSensitiveLevel, number> = {
  normal: 24,
  sensitive: 6,
  highly_sensitive: 1,
}

export interface FileMetadata {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  sha256: string
  purpose: FilePurpose
  sensitiveLevel: FileSensitiveLevel
  uploaderId: string | null
  expiresAt: string
  deletedAt: string | null
  deletedBy: string | null
  deleteReason: string | null
  createdAt: string
}

export interface FileUploadResponse {
  fileId: string
  filename: string
  sizeBytes: number
  mimeType: string
  sha256: string
  signedUrl: string
  signedUrlExpiresAt: string
  fileExpiresAt: string
}

export interface SignedUrlResponse {
  fileId: string
  signedUrl: string
  expiresAt: string
  purpose: FilePurpose
}

export interface FileCleanupResponse {
  deletedCount: number
  deletedFileIds: string[]
  triggeredBy: 'manual' | 'cron'
  triggeredAt: string
}
