// ============================================================
// Kiosk File Upload API — W7
//
// POST /api/v1/files/kiosk-upload
//   - Multipart form upload (anonymous, no JWT)
//   - purpose defaults to 'print_doc'
//   - Returns signedUrl (5-min HMAC TTL), sha256, fileId
//
// 哈希说明（方案②）：后端计算的是 **SHA-256**（sha256 字段）。提交打印任务时，
// 调用方把它放进 createPrintJob 的 `fileMd5` 字段（wire 字段名暂未改名以避免跨端
// rename + Prisma migration）。Terminal Agent 据此用 SHA-256 重算并比对。
// 后续 fileSha256 命名清理时再统一改名。
// ============================================================

import { API_BASE_URL } from '../api/client'

export interface KioskUploadResult {
  fileId:             string
  filename:           string
  sizeBytes:          number
  mimeType:           string
  sha256:             string
  signedUrl:          string
  signedUrlExpiresAt: string
  fileExpiresAt:      string
}

export async function kioskUploadFile(file: File): Promise<KioskUploadResult> {
  const form = new FormData()
  form.append('file', file)
  form.append('purpose', 'print_doc')

  const res = await fetch(`${API_BASE_URL}/files/kiosk-upload`, {
    method: 'POST',
    body: form,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`kiosk-upload failed: ${res.status} ${text}`)
  }

  const json = (await res.json()) as { data: KioskUploadResult }
  return json.data
}
