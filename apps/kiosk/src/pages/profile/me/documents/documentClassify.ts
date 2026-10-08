import type { MemberDocumentItem } from '@ai-job-print/shared'
import { isDocumentReprintable } from '../components/documentReprint'

export type DocumentListFilter = 'all' | 'printable' | 'scan'

export function isScannedDocument(doc: { purpose: string }): boolean {
  return doc.purpose === 'resume_scan' || doc.purpose === 'id_scan'
}

/** 与 MyDocumentsPage 打印键上的 MIME 白名单是同一组字面量。 */
export function isPrintableDocumentMime(mimeType: string): boolean {
  return mimeType === 'application/pdf' || mimeType === 'image/jpeg' || mimeType === 'image/png'
}

export function matchesDocumentFilter(doc: MemberDocumentItem, filter: DocumentListFilter): boolean {
  if (filter === 'scan') return isScannedDocument(doc)
  if (filter === 'printable') return isPrintableDocumentMime(doc.mimeType) && isDocumentReprintable(doc)
  return true
}

/**
 * 角色只从 purpose、assetCategory 来。
 * 列表接口没有能证明「签过名」的字段（服务端 derivationKind 不下发），这里不返回「已签名文件」。
 */
export function documentRoleLabel(doc: { purpose: string; assetCategory: string }): { label: string; tone: 'teal' | 'clay' | '' } | null {
  if (isScannedDocument(doc)) return { label: '扫描件', tone: 'clay' }
  if (doc.assetCategory === 'optimized' || doc.assetCategory === 'derived') return { label: '生成的材料', tone: 'teal' }
  if (doc.assetCategory === 'original') return { label: '最近保存', tone: '' }
  return null
}

const MIME_LABEL: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/tiff': 'TIFF',
  'image/webp': 'WEBP',
  'application/zip': 'ZIP',
  'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
}

/** pageCount 不是数字时只写格式，不把「还没识别」显示成 0 页。 */
export function documentFormatTag(doc: { mimeType: string; purpose: string; pageCount?: number | null }): string {
  if (isScannedDocument(doc) && typeof doc.pageCount === 'number') return `扫描 ${doc.pageCount} 页`
  const label = MIME_LABEL[doc.mimeType] ?? fallbackMime(doc.mimeType)
  if (typeof doc.pageCount === 'number') return `${label} · ${doc.pageCount} 页`
  return label
}

function fallbackMime(mimeType: string): string {
  const sub = mimeType.split('/')[1]
  if (!sub) return '文件'
  return sub.replace(/^vnd\./, '').slice(0, 12).toUpperCase()
}

/** 没有 expiresAt 不算过期。过期只认返回的时间已经过去。 */
export function accessLinkExpired(expiresAt: string | null | undefined, now = Date.now()): boolean {
  if (!expiresAt) return false
  const time = new Date(expiresAt).getTime()
  return Number.isFinite(time) && time <= now
}
