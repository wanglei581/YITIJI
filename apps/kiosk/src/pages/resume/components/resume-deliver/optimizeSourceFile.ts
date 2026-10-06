/** 这次办理带过来的上传原件。只认路由状态里的文件编号和临时签名地址，不另要接口。 */

export interface OptimizeSourceFile {
  fileId: string
  fileUrl: string
  name: string
  format?: string
  mimeType?: string
}

export const SOURCE_MISSING_REASON = '这次办理没带上原件，回到简历来源可以重新选'

/** 对照页来回时把原件编号和临时签名地址原样带上。没有就不加字段。 */
export function carryOptimizeSource(state: unknown): { fileId: string; file: unknown } | Record<string, never> {
  const file = readOptimizeSourceFile(state)
  if (!file || !state || typeof state !== 'object') return {}
  const record = state as Record<string, unknown>
  if (!record.file || typeof record.file !== 'object') return {}
  return { fileId: file.fileId, file: record.file }
}

export function readOptimizeSourceFile(state: unknown): OptimizeSourceFile | null {
  if (!state || typeof state !== 'object') return null
  const record = state as Record<string, unknown>
  const fileId = typeof record.fileId === 'string' ? record.fileId.trim() : ''
  const file = record.file
  if (!fileId || !file || typeof file !== 'object') return null
  const fileRecord = file as Record<string, unknown>
  const fileUrl = typeof fileRecord.fileUrl === 'string' ? fileRecord.fileUrl.trim() : ''
  if (!fileUrl) return null
  const name = typeof fileRecord.name === 'string' && fileRecord.name.trim()
    ? fileRecord.name.trim()
    : '上传的简历'
  const format = typeof fileRecord.format === 'string' ? fileRecord.format : undefined
  const mimeType = typeof fileRecord.mimeType === 'string' ? fileRecord.mimeType : undefined
  return { fileId, fileUrl, name, format, mimeType }
}
