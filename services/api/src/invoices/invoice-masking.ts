/**
 * 会员接口里的税号、邮箱只回打码后的样子。
 *
 * 会员接口一体机带会员令牌也能调，而一体机永远不该拿到完整税号和邮箱；完整值只在后台订单详情里给管理员开票用。
 * 退回原因是管理员手写的，可能抄了邮箱或统一社会信用代码，回给会员前同样打码。
 */
const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
// 18 位统一社会信用代码（大小写不敏感）与 15/17/20 位旧税号；须含至少一位数字避免误伤纯英文长词，
// 并排除前后以连字符拼接的订单号（如 ORD-110108123456789、110108123456789-01）、日期和短数字。
const CREDIT_CODE_IN_TEXT =
  /(?<![0-9A-Za-z])(?<![0-9A-Za-z]-)(?=[A-Za-z]*\d)(?:[0-9A-Za-z]{20}|[0-9A-Za-z]{18}|[0-9A-Za-z]{17}|[0-9A-Za-z]{15})(?![0-9A-Za-z])(?!-[0-9A-Za-z])/g

/** 税号留前 4 后 4，中间打星号；不到 9 位的整段打星号。 */
export function maskTaxId(taxId: string | null | undefined): string | null {
  const value = taxId?.trim()
  if (!value) return null
  if (value.length < 9) return '*'.repeat(value.length)
  return `${value.slice(0, 4)}${'*'.repeat(value.length - 8)}${value.slice(-4)}`
}

/** 邮箱留首字符和 @ 后的域名，例如 f***@example.com。 */
export function maskEmail(email: string | null | undefined): string | null {
  const value = email?.trim()
  if (!value) return null
  const at = value.lastIndexOf('@')
  if (at <= 0) return '***'
  return `${value[0]}***${value.slice(at)}`
}

/** 自由文本里的邮箱、18 位统一社会信用代码（含小写）与 15/17/20 位旧税号打码。 */
export function maskInvoiceText(text: string | null | undefined): string | null {
  if (text == null) return null
  return text
    .replace(EMAIL_IN_TEXT, (match) => maskEmail(match) ?? '***')
    .replace(CREDIT_CODE_IN_TEXT, (match) => maskTaxId(match) ?? '***')
}
