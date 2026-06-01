// ============================================================
// Kiosk File Upload API — W7
//
// POST /api/v1/files/kiosk-upload
//   - Multipart form upload (anonymous, no JWT)
//   - purpose defaults to 'print_doc'
//   - Returns signedUrl (5-min HMAC TTL), sha256, fileId
//
// Callers should use the returned sha256 as fileMd5 when submitting a print job.
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
