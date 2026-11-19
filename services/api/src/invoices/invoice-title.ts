import { BadRequestException } from '@nestjs/common'
import { normalizeCreditCode } from '../licenses/credit-code'

export interface NormalizedInvoiceTitle {
  titleType: 'personal' | 'company'
  title: string
  taxId: string | null
  email: string
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function invalid(code: string, message: string): BadRequestException {
  return new BadRequestException({ error: { code, message } })
}

/**
 * 抬头、税号、邮箱。个人不收税号，单位只收统一社会信用代码。
 * 入参是请求体原样（DTO 只声明字段、不校验类型），所以每项都按 unknown 判；错误码和句子见 docs/api/member-invoice-requests.md。
 */
export function normalizeInvoiceTitle(input: {
  titleType?: unknown
  title?: unknown
  taxId?: unknown
  email?: unknown
}): NormalizedInvoiceTitle {
  const titleType = input.titleType
  if (titleType !== 'personal' && titleType !== 'company') {
    throw invalid('INVOICE_TITLE_INVALID', '抬头要选个人或单位。')
  }
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (!title) throw invalid('INVOICE_TITLE_INVALID', '抬头。个人写姓名，单位写单位名称。')
  if (title.length > 80) throw invalid('INVOICE_TITLE_INVALID', '抬头请控制在 80 个字以内。')
  const rawTax = typeof input.taxId === 'string' ? input.taxId.trim() : ''
  if (titleType === 'personal') {
    if (rawTax) throw invalid('INVOICE_TAX_ID_FORBIDDEN', '个人不用填税号。')
  }
  let taxId: string | null = null
  if (titleType === 'company') {
    if (!rawTax) throw invalid('INVOICE_TAX_ID_REQUIRED', '单位请填写名称和统一社会信用代码。')
    taxId = normalizeCreditCode(rawTax)
    if (!taxId) {
      throw invalid('INVOICE_TAX_ID_INVALID', '统一社会信用代码需为 18 位（数字与大写字母，末位校验位正确）')
    }
  }
  const email = typeof input.email === 'string' ? input.email.trim() : ''
  if (!email || email.length > 120 || !EMAIL_PATTERN.test(email)) {
    throw invalid('INVOICE_EMAIL_INVALID', '接收邮箱格式不对。电子发票发到这个邮箱。')
  }
  return { titleType, title, taxId, email }
}
