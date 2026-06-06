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
  // ── 既有(BE-1)─────────────────────────────────────────────
  | 'resume_upload'
  | 'resume_scan'
  | 'id_scan'
  | 'print_doc'
  | 'fair_material'
  | 'cover_letter'
  // ── COS 接入新增(统一文件资产)──────────────────────────────
  | 'partner_profile'      // 机构资料图片
  | 'partner_image'        // 岗位图片
  | 'partner_video'        // 机构视频素材
  | 'job_fair_material'    // 招聘会资料 PDF/图片
  | 'screensaver_material' // 待机宣传屏素材
  | 'admin_upload'         // 管理员通用上传
  | 'temp'                 // 临时 / 匿名上传

export type FileSensitiveLevel = 'normal' | 'sensitive' | 'highly_sensitive'

/** owner 维度(授权 + objectKey 前缀)。 */
export type FileOwnerType = 'user' | 'partner' | 'admin' | 'system'

/** 可见性。默认 private(合规安全)。 */
export type FileVisibility = 'private' | 'internal' | 'public'

/** 文件状态。直传意图创建后为 uploading,确认后 active。 */
export type FileStatus = 'uploading' | 'active' | 'quarantined' | 'deleted'

export const FILE_DEFAULT_TTL_HOURS: Record<FileSensitiveLevel, number> = {
  normal: 24,
  sensitive: 6,
  highly_sensitive: 1,
}

export interface FileMetadata {
  id: string
  bucket: string
  region: string
  objectKey: string
  filename: string
  mimeType: string
  sizeBytes: number
  sha256: string
  purpose: FilePurpose
  sensitiveLevel: FileSensitiveLevel
  ownerType: FileOwnerType | null
  ownerId: string | null
  visibility: FileVisibility
  status: FileStatus
  uploaderId: string | null
  endUserId: string | null
  createdBy: string | null
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

/** 下载 / 预览 URL 响应。 */
export interface FileAccessUrlResponse {
  fileId: string
  url: string
  expiresAt: string
  /** 'inline'(预览)| 'attachment'(下载)。 */
  disposition: 'inline' | 'attachment'
}

/** 创建上传意图请求。 */
export interface UploadIntentRequest {
  purpose: FilePurpose
  filename: string
  mimeType: string
  /** 客户端声明的字节数(用于上限预校验;以最终 complete 实测为准)。 */
  sizeBytes?: number
  sensitiveLevel?: FileSensitiveLevel
  /** 可选:客户端预算 sha256(直传时服务端无法就 buffer 计算)。 */
  sha256?: string
}

/** 创建上传意图响应。 */
export interface UploadIntentResponse {
  fileId: string
  bucket: string
  region: string
  objectKey: string
  /** 直传 URL(COS 预签名 PUT;本地为 API 代理 PUT)。 */
  uploadUrl: string
  uploadMethod: 'PUT'
  /** 直传时应带的请求头(如 Content-Type)。 */
  uploadHeaders: Record<string, string>
  uploadUrlExpiresAt: string
  /** true=直传 COS;false=回 API 代理写入(本地后端)。 */
  direct: boolean
}

/** 直传完成确认响应。 */
export interface CompleteUploadResponse {
  fileId: string
  status: FileStatus
  sizeBytes: number
  sha256: string
  fileExpiresAt: string
}

export interface FileCleanupResponse {
  deletedCount: number
  deletedFileIds: string[]
  triggeredBy: 'manual' | 'cron'
  triggeredAt: string
}
