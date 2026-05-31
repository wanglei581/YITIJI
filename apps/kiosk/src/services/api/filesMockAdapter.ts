import type { FileUploadResponse, FilePurpose } from '@ai-job-print/shared'

let nextId = 1

export const filesMockAdapter = {
  async kioskUpload(file: File, _purpose: FilePurpose): Promise<FileUploadResponse> {
    await new Promise((r) => setTimeout(r, 600))
    const fileId = `mock-file-${Date.now()}-${nextId++}`
    const now = Date.now()
    return {
      fileId,
      filename: file.name,
      sizeBytes: file.size,
      mimeType: file.type || 'application/octet-stream',
      sha256: 'mock-sha256-' + fileId,
      signedUrl: `/mock/files/${fileId}/content`,
      signedUrlExpiresAt: new Date(now + 5 * 60 * 1000).toISOString(),
      fileExpiresAt: new Date(now + 60 * 60 * 1000).toISOString(),
    }
  },
}

