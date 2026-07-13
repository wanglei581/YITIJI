/**
 * 文件元数据 + 签名 URL 契约(BE-1 / COS 接入)。
 *
 * 服务端落地于 services/api/src/files,数据库表 FileObject。
 * 三端前端只从这里 import 类型,严禁自造结构。
 *
 * **SSOT**:本文件为契约源,后端副本 services/api/src/files/file.types.ts
 * 必须与此同步(任何字段变更同时改两处)。
 *
 * 合规约束(CLAUDE.md §11):
 *   - 文件 URL 必须为短期签名 URL(本地 HMAC 代理 / COS 预签名,TTL ≤ 30 分钟)
 *   - 敏感文件设有效期,过期由 cron 自动清理
 *   - 管理员访问 / 清理动作必须落 AuditLog
 *   - 前端绝不出现 COS SecretId / SecretKey
 */

/** 文件用途。决定默认 sensitiveLevel + 默认 TTL + objectKey 前缀。 */
export type FilePurpose =
  // ── 既有(BE-1)─────────────────────────────────────────────
  | 'resume_upload'    // 求职者上传简历(高敏)
  | 'resume_scan'      // Kiosk 扫描纸质简历(高敏)
  | 'id_scan'          // 身份证 / 证件照(高敏)
  | 'print_doc'        // 通用打印文档(普通)
  | 'fair_material'    // 招聘会 / 模板素材(普通)
  | 'cover_letter'     // 求职信 / 推荐信(敏感)
  // ── COS 接入新增 ────────────────────────────────────────────
  | 'partner_profile'      // 机构资料图片
  | 'partner_image'        // 岗位图片
  | 'partner_video'        // 机构视频素材
  | 'job_fair_material'    // 招聘会资料 PDF/图片
  | 'screensaver_material' // 待机宣传屏素材
  | 'admin_upload'         // 管理员通用上传
  | 'temp'                 // 临时 / 匿名上传
  | 'signature_image'      // 签名/印章图片(高敏,锁定系统短期,不进"我的文档")

/** 敏感等级。决定默认有效期。 */
export type FileSensitiveLevel = 'normal' | 'sensitive' | 'highly_sensitive'

/** owner 维度(授权 + objectKey 前缀)。 */
export type FileOwnerType = 'user' | 'partner' | 'admin' | 'system'

/** 可见性。默认 private(合规安全)。 */
export type FileVisibility = 'private' | 'internal' | 'public'

/** 文件状态。 */
export type FileStatus = 'uploading' | 'active' | 'quarantined' | 'deleted'

/** 文件资产分类。 */
export type FileAssetCategory = 'original' | 'optimized' | 'derived'

/** 文件保存策略。 */
export type FileRetentionPolicy = 'months_3' | 'months_6' | 'long_term' | 'system_short'

/** 文件保存策略设置来源。 */
export type FileRetentionSetBy = 'system' | 'user' | 'admin'

/** 当前延长保存期限用户确认条款版本。 */
export const FILE_RETENTION_CONSENT_VERSION = 'file-retention-v1'

/** 默认有效期(小时),与 services/api/src/files/files.service.ts 保持一致。 */
export const FILE_DEFAULT_TTL_HOURS: Record<FileSensitiveLevel, number> = {
  normal: 24,
  sensitive: 6,
  highly_sensitive: 1,
}

/** 单条文件元数据(列表 / 详情返回)。 */
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
  assetCategory?: FileAssetCategory
  sourceFileId?: string | null
  retentionPolicy?: FileRetentionPolicy | null
  retentionSetBy?: FileRetentionSetBy | null
  retentionConsentAt?: string | null
  retentionConsentVersion?: string | null
  retentionLockedReason?: string | null
  uploaderId: string | null
  endUserId: string | null
  createdBy: string | null
  expiresAt: string | null  // ISO; null 表示长期保存
  deletedAt: string | null
  deletedBy: string | null
  deleteReason: string | null
  createdAt: string
}

/** 上传成功响应。signedUrl 短 TTL,前端用过即弃,需要再访问通过 /files/:id/url 重签。 */
export interface FileUploadResponse {
  fileId: string
  filename: string
  sizeBytes: number
  mimeType: string
  sha256: string
  signedUrl: string
  signedUrlExpiresAt: string  // ISO
  fileExpiresAt: string | null       // ISO; null 表示长期保存
}

/** 仅返回签名 URL(用于已有 fileId 的二次访问)。 */
export interface SignedUrlResponse {
  fileId: string
  signedUrl: string
  expiresAt: string  // ISO
  purpose?: FilePurpose
}

/** 下载 / 预览 URL 响应。 */
export interface FileAccessUrlResponse {
  fileId: string
  url: string
  /** 系统 HMAC content URL，供 /print/jobs 与签章类内部文件变换端点（/print/sign/*）作访问凭证；url 只用于预览/下载。 */
  printFileUrl?: string
  expiresAt: string  // ISO
  disposition: 'inline' | 'attachment'
}

/** 创建上传意图请求(直传模式)。 */
export interface UploadIntentRequest {
  purpose: FilePurpose
  filename: string
  mimeType: string
  sizeBytes?: number
  sensitiveLevel?: FileSensitiveLevel
  sha256?: string
}

/** 创建上传意图响应。 */
export interface UploadIntentResponse {
  fileId: string
  bucket: string
  region: string
  objectKey: string
  uploadUrl: string
  uploadMethod: 'PUT'
  uploadHeaders: Record<string, string>
  uploadUrlExpiresAt: string  // ISO
  direct: boolean
}

/** 直传完成确认响应。 */
export interface CompleteUploadResponse {
  fileId: string
  status: FileStatus
  sizeBytes: number
  sha256: string
  fileExpiresAt: string | null  // ISO; null 表示长期保存
}

/** 更新文件保存期限请求。 */
export interface FileRetentionUpdateRequest {
  retentionPolicy: Extract<FileRetentionPolicy, 'months_3' | 'months_6' | 'long_term'>
  consentVersion?: string
}

/** 更新文件保存期限响应。 */
export interface FileRetentionUpdateResponse {
  file: FileMetadata
  allowedPolicies: FileRetentionPolicy[]
}

/** Admin 文件生命周期策略分布项。 */
export interface FileLifecyclePolicyCount {
  key: FileRetentionPolicy | null
  count: number
}

/** Admin 文件生命周期设置来源分布项。 */
export interface FileLifecycleSetByCount {
  key: FileRetentionSetBy | null
  count: number
}

/** Admin 文件生命周期只读统计响应。 */
export interface FileLifecycleSummaryResponse {
  totalActive: number
  longTermCount: number
  expiringWithin7Days: number
  expiringWithin30Days: number
  expiredPendingCleanup: number
  byRetentionPolicy: FileLifecyclePolicyCount[]
  byRetentionSetBy: FileLifecycleSetByCount[]
  generatedAt: string  // ISO
}

/** Admin 强制清理过期文件响应。 */
export interface FileCleanupResponse {
  deletedCount: number
  deletedFileIds: string[]
  triggeredBy: 'manual' | 'cron'
  triggeredAt: string  // ISO
}
