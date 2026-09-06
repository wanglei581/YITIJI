import type { ResumeExportFormat } from '@ai-job-print/shared'

export const EXPORT_FORMAT_OPTIONS: { value: ResumeExportFormat; label: string }[] = [
  { value: 'pdf', label: 'PDF' },
  { value: 'docx', label: 'Word' },
  { value: 'txt', label: 'TXT' },
  { value: 'md', label: 'Markdown' },
]

export const OPTIMIZE_STATES = [
  'no-context',
  'loading',
  'ready',
  'empty',
  'read-error',
  'optimize-failed',
  'unavailable',
  'illegal',
] as const
export type OptimizeViewState = (typeof OPTIMIZE_STATES)[number]
export const OPTIMIZE_FIXTURE_STATES = new Set<OptimizeViewState>(['ready', 'empty'])

export const GENERATE_PREVIEW_STATES = [
  'preview-no-result',
  'preview-loading',
  'preview-failed',
  'preview-ready',
  'preview-hints',
  'preview-editing',
  'export-chooser',
  'export-exporting',
  'export-failed',
  'export-ready',
  'export-url-expired',
  'export-print-unavailable',
  'session-lost',
  'illegal',
] as const
export type GeneratePreviewViewState = (typeof GENERATE_PREVIEW_STATES)[number]
export const GENERATE_FIXTURE_STATES = new Set<GeneratePreviewViewState>([
  'preview-ready',
  'preview-hints',
  'preview-editing',
  'export-chooser',
  'export-exporting',
  'export-failed',
  'export-ready',
  'export-url-expired',
  'export-print-unavailable',
])

export const TASK_ID_RE = /^[A-Za-z0-9_-]{1,24}$/
export const AIGC_SCREEN_MARK = 'AI 优化稿，请自行核对'
export const HTML_PREVIEW_NOTE = '示意，非打印稿'
export const PRINT_THIS_COPY = '打印的就是这一份'
export const SYNTHETIC_BANNER = '合成演示'
export const COMPRESS_ONE_PAGE = '压到一页'
export const FREE_PRICING_COPY = '当前免费，不扣权益'

const FORMAT_SET = new Set<string>(['pdf', 'docx', 'txt', 'md'])
export function parseExportFormat(raw: string | null): ResumeExportFormat | null {
  if (!raw) return null
  return FORMAT_SET.has(raw) ? (raw as ResumeExportFormat) : null
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes > 0) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return '0 KB'
}
