import type { FileUploadResponse, FilePurpose } from '@ai-job-print/shared'
import { API_MODE } from './client'
import { filesHttpAdapter } from './filesHttpAdapter'
import { filesMockAdapter } from './filesMockAdapter'

export interface FilesServiceInterface {
  kioskUpload(file: File, purpose: FilePurpose, token?: string | null): Promise<FileUploadResponse>
}

const adapter: FilesServiceInterface =
  API_MODE === 'http' ? filesHttpAdapter : filesMockAdapter

/** Kiosk 上传。无 token 时匿名；有 C 端会员 token 时后端绑定 EndUser。 */
export const kioskUploadFile = (file: File, purpose: FilePurpose, token?: string | null): Promise<FileUploadResponse> =>
  adapter.kioskUpload(file, purpose, token)
