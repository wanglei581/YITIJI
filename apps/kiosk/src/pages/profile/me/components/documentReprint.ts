import { ApiHttpError } from '../../../../services/api/httpAdapter'
import { errorCodeOf, userMessageOf } from '../../../../services/api/userErrorMessage'

export const DOCUMENT_NOT_REPRINTABLE_COPY = '该报告仅可查看，不可打印'

/** 高敏报告等服务端 reprintable=false；缺字段时按签约风险报告用途 fail-closed。 */
export function isDocumentReprintable(doc: { reprintable?: boolean; purpose?: string | null }): boolean {
  if (doc.purpose === 'contract_review_report') return false
  return doc.reprintable !== false
}

function displayableConversionMessage(error: unknown): string | undefined {
  if (!(error instanceof ApiHttpError)) return undefined
  const message = error.message?.trim()
  if (!message || message.length > 60) return undefined
  if (!/[\u4e00-\u9fa5]/.test(message)) return undefined
  if (/^(HTTP\s|请求失败（)/.test(message)) return undefined
  return message
}

export function conversionUserMessage(error: unknown): string {
  const code = errorCodeOf(error)
  if (code === 'AUTH_REQUIRED' || (error instanceof ApiHttpError && error.status === 401)) {
    return '请先登录'
  }
  if (
    code === 'CONVERSION_UNAVAILABLE'
    || code === 'CONVERSION_ENGINE_UNAVAILABLE'
    || code === 'CONVERSION_TIMEOUT'
    || code === 'CONVERSION_FAILED'
    || code === 'UNSUPPORTED_FILE_TYPE'
  ) {
    return displayableConversionMessage(error) ?? userMessageOf(error, 'Word 转 PDF 失败，请稍后重试')
  }
  return userMessageOf(error, 'Word 转 PDF 失败，请稍后重试')
}
