import type { FileUploadResponse, FilePurpose } from '@ai-job-print/shared'

/**
 * 按 purpose 推断默认过期(与后端 FilesService.DEFAULT_SENSITIVE_BY_PURPOSE 一致)。
 * 让 mock 行为对齐真后端,UI 在 mock 模式下也能看到"简历 1h 自动清理"的真实呈现。
 */
const TTL_HOURS_BY_PURPOSE: Record<FilePurpose, number> = {
  resume_upload:   1,
  resume_scan:     1,
  id_scan:         1,
  print_doc:      24,
  fair_material:  24,
  cover_letter:   24,
}

let nextId = 1

export const filesMockAdapter = {
  async kioskUpload(file: File, purpose: FilePurpose): Promise<FileUploadResponse> {
    await new Promise((r) => setTimeout(r, 600))
    const fileId = `mock-file-${Date.now()}-${nextId++}`
    const now = Date.now()
    const ttlMs = TTL_HOURS_BY_PURPOSE[purpose] * 60 * 60 * 1000
    return {
      fileId,
      filename: file.name,
      sizeBytes: file.size,
      mimeType: file.type || 'application/octet-stream',
      sha256: `mock-sha256-${purpose}-${fileId}`,
      signedUrl: `/mock/files/${fileId}/content?purpose=${purpose}`,
      signedUrlExpiresAt: new Date(now + 5 * 60 * 1000).toISOString(),
      fileExpiresAt: new Date(now + ttlMs).toISOString(),
    }
  },
}

