import type { FileUploadResponse, FilePurpose } from '@ai-job-print/shared'
import { isMemberSessionInvalidError, notifyMemberSessionExpired } from '../auth/memberSessionEvents'
import { API_BASE_URL } from './client'
import { ApiHttpError } from './httpAdapter'

interface ResponseEnvelope<T> { success?: boolean; data?: T; error?: { code?: string; message?: string } }

export const filesHttpAdapter = {
  /**
   * Kiosk 匿名上传文件到 BE-1。
   * 走 POST /api/v1/files/kiosk-upload(无 JWT)。
   */
  async kioskUpload(file: File, purpose: FilePurpose, token?: string | null): Promise<FileUploadResponse> {
    const form = new FormData()
    form.append('file', file, file.name)
    form.append('purpose', purpose)

    const res = await fetch(`${API_BASE_URL}/files/kiosk-upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
      credentials: 'include',
    })
    if (!res.ok) {
      let code = 'UNKNOWN_ERROR'
      let message = `HTTP ${res.status}`
      try {
        const body = (await res.json()) as ResponseEnvelope<unknown>
        code = body.error?.code ?? code
        message = body.error?.message ?? message
      } catch { /* keep defaults */ }
      if (isMemberSessionInvalidError(res.status, code, Boolean(token))) notifyMemberSessionExpired(token ?? undefined)
      throw new ApiHttpError(code, message, res.status)
    }
    const body = (await res.json()) as ResponseEnvelope<FileUploadResponse>
    if (!body.data) {
      throw new ApiHttpError('FILE_UPLOAD_EMPTY', '上传返回数据为空', res.status)
    }
    return body.data
  },
}
