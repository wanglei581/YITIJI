/**
 * 文件元数据 + 签名 URL 契约(BE-1)。
 *
 * 服务端落地于 services/api/src/files,数据库表 FileObject。
 * 三端前端只从这里 import 类型,严禁自造结构。
 *
 * 合规约束(CLAUDE.md §11):
 *   - 文件 URL 必须为 HMAC 签名 + 短 TTL(默认 5 分钟)
 *   - 敏感文件设有效期,过期由 cron 自动清理
 *   - 管理员强制清理动作必须落 AuditLog
 */

/** 文件用途。决定默认 sensitiveLevel + 默认 TTL。 */
export type FilePurpose =
  | 'resume_upload'    // 求职者上传简历(高敏)
  | 'resume_scan'      // Kiosk 扫描纸质简历(高敏)
  | 'id_scan'          // 身份证 / 证件照(高敏)
  | 'print_doc'        // 通用打印文档(普通)
  | 'fair_material'    // 招聘会 / 模板素材(普通)
  | 'cover_letter'     // 求职信 / 推荐信(普通)

/** 敏感等级。决定默认有效期。 */
export type FileSensitiveLevel = 'normal' | 'sensitive' | 'highly_sensitive'

/** 默认有效期(小时),与 services/api/src/files/files.service.ts 保持一致。 */
export const FILE_DEFAULT_TTL_HOURS: Record<FileSensitiveLevel, number> = {
  normal: 24,
  sensitive: 6,
  highly_sensitive: 1,
}

/** 单条文件元数据(列表 / 详情返回)。 */
export interface FileMetadata {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  sha256: string
  purpose: FilePurpose
  sensitiveLevel: FileSensitiveLevel
  uploaderId: string | null
  expiresAt: string  // ISO
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
  fileExpiresAt: string       // ISO,过期后元数据软删 + 物理清理
}

/** 仅返回签名 URL(用于已有 fileId 的二次访问)。 */
export interface SignedUrlResponse {
  fileId: string
  signedUrl: string
  expiresAt: string  // ISO
}

/** Admin 强制清理过期文件响应。 */
export interface FileCleanupResponse {
  deletedCount: number
  deletedFileIds: string[]
  triggeredBy: 'manual' | 'cron'
  triggeredAt: string  // ISO
}
