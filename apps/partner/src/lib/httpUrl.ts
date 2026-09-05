/** 与后端 normalizeOptionalHttpUrl / isAbsoluteHttpUrl 同口径：必须带 http(s) 协议。 */
export function isAbsoluteHttpUrl(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  try {
    const url = new URL(trimmed)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
