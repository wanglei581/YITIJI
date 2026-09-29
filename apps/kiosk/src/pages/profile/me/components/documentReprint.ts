import { ApiHttpError } from '../../../../services/api/httpAdapter'
import { errorCodeOf, userMessageOf } from '../../../../services/api/userErrorMessage'

export const DOCUMENT_NOT_REPRINTABLE_COPY = '该报告仅可查看，不可打印'

/** 高敏报告等服务端 reprintable=false；缺字段时按签约风险报告用途 fail-closed。 */
export function isDocumentReprintable(doc: { reprintable?: boolean; purpose?: string | null }): boolean {
  if (doc.purpose === 'contract_review_report') return false
  return doc.reprintable !== false
}

/**
 * 与服务端建单隐私闸门同一份用途清单（services/api/src/print-jobs/pii-scan-gate.ts 的
 * PII_SCAN_REQUIRED_PURPOSES）。生产强制 PRINT_REQUIRE_PII_SCAN=true：这些用途的**原件**
 * 没做完隐私检查就建单会被拒，所以打印前要先走打印台材料检查（商用收口 P0-5）。
 */
const PRINT_PII_CHECK_PURPOSES = new Set(['resume_upload', 'resume_scan', 'print_doc', 'id_scan'])

type DocumentPrintRoutingInput = { purpose?: string | null; assetCategory?: string | null }

/** 这三种用途的文件只会是本人原件或由原件转出来的（AI 报告用 print_doc，不在此列）。 */
const ORIGINAL_ONLY_PURPOSES = new Set(['resume_upload', 'resume_scan', 'id_scan'])

/**
 * 「我的文档」里这一份打印前要不要先做材料检查。判据与服务端闸门一致：派生 / 优化产物
 * （AI 报告、转换件、脱敏副本、AI 简历）放行，直达报价确认页；闸门清单里的原件先去检查。
 * 类别缺失按原件处理（fail-closed，与服务端「不是 derived/optimized 就要检查」同口径）。
 */
export function documentNeedsPrintMaterialCheck(
  doc: DocumentPrintRoutingInput,
  convertedFrom?: DocumentPrintRoutingInput,
): boolean {
  // 本人原件转换出的 PDF（Word 转 PDF）：服务端记为派生，但内容就是原件 —— 按原件过材料检查（9/29 拍板）。
  if (convertedFrom && documentNeedsPrintMaterialCheck(convertedFrom)) return true
  // 简历上传 / 简历扫描 / 证件扫描这三种用途的派生件只可能来自本人原件（转换件、脱敏副本），同样先查。
  if (doc.assetCategory === 'derived' && ORIGINAL_ONLY_PURPOSES.has(doc.purpose ?? '')) return true
  if (doc.assetCategory === 'derived' || doc.assetCategory === 'optimized') return false
  return PRINT_PII_CHECK_PURPOSES.has(doc.purpose ?? '')
}

/** 打印材料会话的 source：只决定材料检查页「返回选文件」回到简历打印还是文档打印。 */
export function documentPrintSource(doc: DocumentPrintRoutingInput): 'resume' | 'document' {
  return doc.purpose === 'resume_upload' || doc.purpose === 'resume_scan' ? 'resume' : 'document'
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
