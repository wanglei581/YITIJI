/**
 * 打印前材料检查的纯读取层 —— 从任务结果里提取展示所需的摘要,不发请求、不碰路由。
 * 从 PrintMaterialCheckPage 拆出,页面只保留任务编排(CLAUDE.md §8 单文件体积控制)。
 */
import type { DocumentProcessTaskView, PiiFindingAction, PiiFindingView } from '../../services/api/materials'
import { piiTypeLabel } from './piiRedaction'

export type InspectionMessageSeverity = 'info' | 'warning'

export interface InspectionSummaryView {
  pageCount: number | null
  canPrint: boolean | null
  messages: Array<{ code: string; severity: InspectionMessageSeverity; text: string }>
}

export interface NormalizeA4SummaryView {
  targetPaperSize: string
  canNormalize: boolean | null
  messages: Array<{ code: string; severity: InspectionMessageSeverity; text: string }>
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function pageCountFromInspection(task: DocumentProcessTaskView): number | null {
  const checks = task.result?.['checks']
  if (!isRecord(checks)) return null
  const pageCount = checks['pageCount']
  if (typeof pageCount !== 'number' || !Number.isInteger(pageCount)) return null
  return pageCount > 0 && pageCount <= 2000 ? pageCount : null
}

export function inspectionSummaryFromTask(task: DocumentProcessTaskView | null): InspectionSummaryView | null {
  const checks = task?.result?.['checks']
  if (!isRecord(checks)) return null
  const pageCount = task ? pageCountFromInspection(task) : null
  const canPrint = typeof checks['canPrint'] === 'boolean' ? checks['canPrint'] : null
  return { pageCount, canPrint, messages: normalizeInspectionMessages(checks) }
}

export function normalizeA4SummaryFromTask(task: DocumentProcessTaskView | null): NormalizeA4SummaryView | null {
  const checks = task?.result?.['checks']
  if (!isRecord(checks)) return null
  const targetPaperSize = typeof checks['targetPaperSize'] === 'string' ? checks['targetPaperSize'] : 'A4'
  const canNormalize = typeof checks['canNormalize'] === 'boolean' ? checks['canNormalize'] : null
  return { targetPaperSize, canNormalize, messages: normalizeInspectionMessages(checks) }
}

export function normalizeInspectionMessages(checks: Record<string, unknown>): InspectionSummaryView['messages'] {
  const rawMessages = Array.isArray(checks['messages']) ? checks['messages'] : []
  const messages = rawMessages.flatMap((item) => {
    if (!isRecord(item) || typeof item['text'] !== 'string') return []
    const severity: InspectionMessageSeverity = item['severity'] === 'warning' ? 'warning' : 'info'
    return [{
      code: typeof item['code'] === 'string' ? item['code'] : 'INSPECTION_MESSAGE',
      severity,
      text: item['text'],
    }]
  })
  if (messages.length > 0) return messages.slice(0, 3)

  const warnings = Array.isArray(checks['warnings'])
    ? checks['warnings'].filter((item): item is string => typeof item === 'string')
    : []
  return warnings.slice(0, 3).map((code) => ({
    code,
    severity: 'warning' as const,
    text: inspectionWarningText(code),
  }))
}

function inspectionWarningText(code: string): string {
  if (code === 'PDF_PAGE_COUNT_NOT_DETECTED') return '暂未识别 PDF 页数,以实际打印为准'
  if (code === 'SOURCE_FILE_BYTES_UNAVAILABLE') return '暂未读取到文件内容,以实际打印为准'
  if (code === 'PRINT_MIME_UNSUPPORTED') return '当前文件格式暂不支持打印前体检'
  return '材料体检存在提示,请继续核对打印参数'
}

/**
 * 片段掩码 —— 一体机在公共场所,屏幕上不重现完整证件号 / 手机号。
 * 规则:只留可辨认的头尾,中间一律星号;短片段几乎全掩。
 */
export function maskSnippet(type: string, snippet: string | null): string {
  if (!snippet) return '未提供片段'
  const value = snippet.trim()
  if (!value) return '未提供片段'
  if (type === 'phone') return value.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
  if (type === 'email') {
    const [name, domain] = value.split('@')
    if (!name || !domain) return value
    return `${name.slice(0, 1)}***@${domain}`
  }
  if (value.length <= 4) return `${value.slice(0, 1)}**`
  return `${value.slice(0, 2)}***${value.slice(-2)}`
}

export function riskLevelForFinding(finding: PiiFindingView): 'high' | 'medium' | 'low' {
  if (finding.type.includes('id') || finding.type.includes('address')) return 'high'
  if (finding.type === 'phone' || finding.type === 'email') return 'medium'
  return 'low'
}

export function findingLabel(finding: PiiFindingView): string {
  return finding.label || piiTypeLabel(finding.type)
}

export function pageLabelForFinding(finding: PiiFindingView): string {
  return typeof finding.pageNumber === 'number' && finding.pageNumber > 0
    ? `第 ${finding.pageNumber} 页`
    : '页码未知'
}

export function countDecisions(decisions: Record<string, PiiFindingAction>): {
  keptCount: number
  redactedCount: number
} {
  return Object.values(decisions).reduce(
    (acc, action) => ({
      keptCount: acc.keptCount + (action === 'keep' ? 1 : 0),
      redactedCount: acc.redactedCount + (action === 'redact' ? 1 : 0),
    }),
    { keptCount: 0, redactedCount: 0 },
  )
}

export function isDemoTask(task: DocumentProcessTaskView | null): boolean {
  const mode = task?.result?.['mode']
  return mode === 'mock' || mode === 'skeleton'
}

/**
 * pii_scan 完成后的诚实结果态文案。
 * 后端 mode 取值(见 materials.service.ts / pii-scan.util.ts):
 * - 'real':真实扫描完成且覆盖全部页面,命中走 findings 列表,这里无需额外文案。
 * - 'partial':扫描版 PDF 页数超出 OCR 上限,只扫了前 N 页;即使 0 命中也不能当作已确认无风险。
 * - 'skipped_non_document':历史遗留态,仅为兼容 TASK_TTL_HOURS 窗口内的存量任务保留。
 * - 'degraded':本该真实扫描但 OCR 不可用/失败,诚实告知需人工确认。
 * - 'unsupported_format':该格式没有内容提取路径(如旧版 .doc),诚实告知。
 * - 其余未知取值一律 fail-closed 显示警告;'mock'/'skeleton' 由 isDemoTask 单独诚实标注。
 */
export function piiScanModeCopy(
  task: DocumentProcessTaskView | null,
): { label: string; tone: 'neutral' | 'warning' } | null {
  const mode = task?.result?.['mode']
  if (mode === 'skipped_non_document') return { label: '该文件类型无需隐私扫描', tone: 'neutral' }
  if (mode === 'degraded') return { label: '内容扫描暂不可用,请人工确认文件不含敏感信息', tone: 'warning' }
  if (mode === 'unsupported_format') {
    return { label: '该文件格式暂不支持内容扫描,请人工确认文件不含敏感信息', tone: 'warning' }
  }
  if (mode === 'partial') {
    const scannedPages = task?.result?.['scannedPages']
    const totalPages = task?.result?.['totalPages']
    const scannedLabel = typeof scannedPages === 'number' ? scannedPages : '部分'
    const totalLabel = typeof totalPages === 'number' ? totalPages : '全部'
    return {
      label: `本次仅检查了前 ${scannedLabel} 页(共 ${totalLabel} 页),请人工确认其余页面不含敏感信息`,
      tone: 'warning',
    }
  }
  if (mode === 'real') return null
  if (isDemoTask(task)) return null
  return { label: '本次隐私检查结果状态未知,请人工确认文件不含敏感信息', tone: 'warning' }
}
