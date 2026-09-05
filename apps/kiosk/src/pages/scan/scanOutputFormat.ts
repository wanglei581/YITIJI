/**
 * 扫描结果格式展示。服务端 deliverScanFile 原样保存 Agent 回传的 jpg/png/pdf，
 * 不做格式转换；页面必须按真实 mimeType 派生文案，不得写死「PDF」。
 */

/** 文件尚未回传时：只能说明保存策略，不能预告具体格式。 */
export const SCAN_OUTPUT_FORMAT_PENDING = '设备回传原格式（服务端不转换）'

export function formatLabelFromMime(mimeType: string | null | undefined): string {
  const mime = (mimeType ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (!mime) return '未知格式'
  if (mime === 'application/pdf') return 'PDF'
  if (mime === 'image/jpeg') return 'JPEG'
  if (mime === 'image/png') return 'PNG'
  if (mime === 'image/webp') return 'WEBP'
  if (mime === 'image/tiff' || mime === 'image/tif') return 'TIFF'
  if (mime.startsWith('image/')) return mime.slice('image/'.length).toUpperCase()
  return mime
}
