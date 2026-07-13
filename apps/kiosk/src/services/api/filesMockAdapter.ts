import { FILE_DEFAULT_TTL_HOURS, type FileUploadResponse, type FilePurpose, type FileSensitiveLevel } from '@ai-job-print/shared'

/**
 * Mock 仅能根据 purpose + token 近似模拟后端默认保存策略:
 * - 登录会员的简历类账号资产默认 90 天;
 * - 匿名/证件/系统文件保持 system_short 的 24h/6h/1h。
 * 真实归属仍以后端 ownerType/endUserId 判断为准。
 */
const MEMBER_DEFAULT_PURPOSES = new Set<FilePurpose>(['resume_upload', 'resume_scan', 'cover_letter'])

const SENSITIVE_BY_PURPOSE: Record<FilePurpose, FileSensitiveLevel> = {
  resume_upload: 'highly_sensitive',
  resume_scan: 'highly_sensitive',
  id_scan: 'highly_sensitive',
  print_doc: 'normal',
  fair_material: 'normal',
  cover_letter: 'sensitive',
  partner_profile: 'normal',
  partner_image: 'normal',
  partner_video: 'normal',
  job_fair_material: 'normal',
  screensaver_material: 'normal',
  admin_upload: 'normal',
  temp: 'sensitive',
  signature_source: 'sensitive',
}

let nextId = 1

function computeMockFileExpiresAt(purpose: FilePurpose, token: string | null | undefined, now: number): string {
  if (token && MEMBER_DEFAULT_PURPOSES.has(purpose)) {
    return new Date(now + 90 * 24 * 60 * 60 * 1000).toISOString()
  }
  const sensitiveLevel = SENSITIVE_BY_PURPOSE[purpose]
  const ttlHours = FILE_DEFAULT_TTL_HOURS[sensitiveLevel]
  return new Date(now + ttlHours * 60 * 60 * 1000).toISOString()
}

export const filesMockAdapter = {
  async kioskUpload(file: File, purpose: FilePurpose, token?: string | null): Promise<FileUploadResponse> {
    await new Promise((r) => setTimeout(r, 600))
    const fileId = `mock-file-${Date.now()}-${nextId++}`
    const now = Date.now()
    return {
      fileId,
      filename: file.name,
      sizeBytes: file.size,
      mimeType: file.type || 'application/octet-stream',
      sha256: `mock-sha256-${purpose}-${fileId}`,
      signedUrl: `/mock/files/${fileId}/content?purpose=${purpose}`,
      signedUrlExpiresAt: new Date(now + 5 * 60 * 1000).toISOString(),
      fileExpiresAt: computeMockFileExpiresAt(purpose, token, now),
    }
  },
}
