import { isWordDocument } from '../../../services/api/documentConversion'
import type { PrintFileState as PrintFile } from '../printMaterialSession'

export function previewKindForFile(file: PrintFile): 'pdf' | 'image' | 'word' | 'unsupported' | 'unavailable' {
  if (isWordDocument({ fileName: file.name, mimeType: file.mimeType })) return 'word'
  if (!file.fileUrl || file.fileUrl.startsWith('/mock/')) return 'unavailable'
  const mimeType = file.mimeType?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  const extension = file.name.toLowerCase().match(/\.([^.]+)$/)?.[1] ?? ''
  if (mimeType === 'application/pdf' || extension === 'pdf') return 'pdf'
  if (mimeType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp'].includes(extension)) return 'image'
  return 'unsupported'
}

