import type { FileUploadResponse, FilePurpose } from '@ai-job-print/shared'
import { API_MODE } from './client'
import { filesHttpAdapter } from './filesHttpAdapter'
import { filesMockAdapter } from './filesMockAdapter'

export interface FilesServiceInterface {
  kioskUpload(file: File, purpose: FilePurpose): Promise<FileUploadResponse>
}

const adapter: FilesServiceInterface =
  API_MODE === 'http' ? filesHttpAdapter : filesMockAdapter

/** Kiosk 匿名上传(无登录态)。purpose 必须是白名单内的 Kiosk 业务场景。 */
export const kioskUploadFile = (file: File, purpose: FilePurpose): Promise<FileUploadResponse> =>
  adapter.kioskUpload(file, purpose)
