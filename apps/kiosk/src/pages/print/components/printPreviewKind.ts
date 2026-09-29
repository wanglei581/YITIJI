import { isWordDocument } from '../../../services/api/documentConversion'
import type { PrintFileState as PrintFile } from '../printMaterialSession'

/** 材料检查认出加密 PDF 后给用户的原句。 */
export const ENCRYPTED_PDF_BLOCK_COPY =
  '这份 PDF 设置了打开密码，本机没法读取。请在手机或电脑上去掉密码后重新上传'

/**
 * 体检消息里这些码表示文件加了打开密码。
 * 当前服务端把 pdf.js 的 PasswordException 收成 PDF_PAGE_COUNT_NOT_DETECTED，
 * 隐私扫描收成 mode=degraded，都没有单独的加密码。页数未识别本身不算加密。
 */
const ENCRYPTED_PDF_CODES = new Set(['PDF_ENCRYPTED', 'PII_REDACT_ENCRYPTED', 'encrypted'])

export function inspectionSignalsEncrypted(codes: readonly string[]): boolean {
  return codes.some((code) => ENCRYPTED_PDF_CODES.has(code))
}

export function previewKindForFile(file: PrintFile): 'pdf' | 'image' | 'word' | 'unsupported' | 'unavailable' {
  if (isWordDocument({ fileName: file.name, mimeType: file.mimeType })) return 'word'
  if (!file.fileUrl || file.fileUrl.startsWith('/mock/')) return 'unavailable'
  const mimeType = file.mimeType?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  const extension = file.name.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? ''
  if (mimeType === 'application/pdf' || extension === 'pdf') return 'pdf'
  if (mimeType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp'].includes(extension)) return 'image'
  return 'unsupported'
}

