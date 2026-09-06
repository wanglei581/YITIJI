/** 屏幕展示用掩码。导出文件仍用原文，不得走这里。 */
export function maskPhone(raw: string): string {
  const value = raw.trim()
  if (!value) return value
  const masked = value.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
  if (masked !== value) return masked
  if (value.length <= 4) return `${value.slice(0, 1)}**`
  return `${value.slice(0, 2)}***${value.slice(-2)}`
}

export function maskEmail(raw: string): string {
  const value = raw.trim()
  if (!value) return value
  const [name, domain] = value.split('@')
  if (!name || !domain) return value
  return `${name.slice(0, 1)}***@${domain}`
}

export function maskSnippet(type: string, snippet: string | null): string {
  if (!snippet) return '未提供片段'
  const value = snippet.trim()
  if (!value) return '未提供片段'
  if (type === 'phone') return maskPhone(value)
  if (type === 'email') return maskEmail(value)
  if (value.length <= 4) return `${value.slice(0, 1)}**`
  return `${value.slice(0, 2)}***${value.slice(-2)}`
}
