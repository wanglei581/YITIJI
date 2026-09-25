/** 核销回执里的文件名：保留首字与扩展名，其余打码。不含正文。 */
export function maskPickupFileName(name: string | null | undefined): string | null {
  if (!name) return null
  const trimmed = name.trim()
  if (!trimmed) return null
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  const baseName = slash >= 0 ? trimmed.slice(slash + 1) : trimmed
  const dot = baseName.lastIndexOf('.')
  const ext = dot > 0 && dot < baseName.length - 1 ? baseName.slice(dot) : ''
  const stem = ext ? baseName.slice(0, baseName.length - ext.length) : baseName
  const head = Array.from(stem)[0] ?? ''
  if (!head) return `***${ext}`
  return `${head}***${ext}`
}
