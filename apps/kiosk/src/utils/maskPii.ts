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

/** 18 位（末位可为 X）或 15 位旧号。调用方只传入一整段号码。 */
export function maskIdCard(raw: string): string {
  const value = raw.trim().toUpperCase()
  if (value.length <= 8) return `${value.slice(0, 1)}***`
  return `${value.slice(0, 6)}${'*'.repeat(value.length - 10)}${value.slice(-4)}`
}

/** 16–19 位连续数字。调用方只传入一整段卡号。 */
export function maskBankCard(raw: string): string {
  const value = raw.trim()
  if (value.length <= 8) return `${value.slice(0, 1)}***`
  return `${value.slice(0, 4)}${'*'.repeat(value.length - 8)}${value.slice(-4)}`
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const ID18_RE = /(?<!\d)(\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx])(?!\d)/g
const ID15_RE = /(?<!\d)(\d{6}\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3})(?!\d)/g
const BANK_RE = /(?<!\d)(\d{16,19})(?!\d)/g
const PHONE_RE = /(?<!\d)(1\d{10})(?!\d)/g

/**
 * 一段展示文字里的手机、邮箱、身份证、银行卡。
 * 先认身份证，避免 18 位证件被当成银行卡。
 */
export function maskPii(text: string): string {
  return text
    .replace(EMAIL_RE, (hit) => maskEmail(hit))
    .replace(ID18_RE, (hit) => maskIdCard(hit))
    .replace(ID15_RE, (hit) => maskIdCard(hit))
    .replace(BANK_RE, (hit) => maskBankCard(hit))
    .replace(PHONE_RE, (hit) => maskPhone(hit))
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
