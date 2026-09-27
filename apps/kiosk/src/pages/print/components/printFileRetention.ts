import { formatDateTime } from '@ai-job-print/shared'

/**
 * 打印完成页文件保留说明。
 * 时间只来自任务状态带回的到期时间或删除时间，这里不写死时长。
 * 读不到时间就说读不到，不猜哪一天。
 */
export const FILE_RETENTION_SEE_DOCUMENTS =
  '具体时间以「我的 → 我的文档」里显示的为准。'
export const FILE_RETENTION_NOT_PHYSICAL =
  '删掉的是这份电子文件，不会把整台机器毁掉。'
export const FILE_RETENTION_UNAVAILABLE =
  '这次没能读到这份文件什么时候删除。这里不猜具体哪一天。'
export const FILE_RETENTION_UNPARSED =
  '这份文件有删除时间，但这里暂时读不出来。这里不猜具体哪一天。'
export const FILE_RETENTION_NO_EXPIRY =
  '这份文件还没有删除日期。这里不猜具体哪一天。'
const FILE_RETENTION_AUTO_DELETE =
  '这份文件会在保留期满后自动删除；具体时间以「我的 → 我的文档」里显示的为准。'

export interface PrintFileRetentionInput {
  fileRetentionAvailable?: boolean
  fileExpiresAt?: string | null
  fileRetentionPolicy?: string | null
  fileDeletedAt?: string | null
  fileDeleteReason?: string | null
  fileStorageDeletedAt?: string | null
}

export interface PrintFileRetentionCopy {
  headline: string
  detail: string
  whenLabel: string | null
}

function formatWhen(value: string | null | undefined): string | null {
  if (!value) return null
  const label = formatDateTime(value, { style: 'zh-datetime', fallback: '' })
  return label.trim() ? label : null
}

function joinCopy(...parts: Array<string | null | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join('')
}

export function describePrintFileRetention(input: PrintFileRetentionInput): PrintFileRetentionCopy {
  if (input.fileDeletedAt) {
    const whenLabel = formatWhen(input.fileDeletedAt)
    const headline = whenLabel
      ? `这份文件已于 ${whenLabel} 删除`
      : '这份文件已经删除，删除时间暂时读不出来'
    const reason = input.fileDeleteReason?.trim()
      ? `删除原因：${input.fileDeleteReason.trim()}。`
      : ''
    const storage = input.fileStorageDeletedAt
      ? '这份电子文件已经删掉。'
      : '删除已经记下。文件是否已经清掉，以「我的 → 我的文档」里显示的为准。'
    return {
      headline,
      detail: joinCopy(reason, storage, FILE_RETENTION_NOT_PHYSICAL),
      whenLabel,
    }
  }

  if (input.fileRetentionAvailable !== true) {
    return {
      headline: FILE_RETENTION_UNAVAILABLE,
      detail: joinCopy(FILE_RETENTION_SEE_DOCUMENTS, FILE_RETENTION_NOT_PHYSICAL),
      whenLabel: null,
    }
  }

  if (input.fileExpiresAt) {
    const whenLabel = formatWhen(input.fileExpiresAt)
    if (!whenLabel) {
      return {
        headline: FILE_RETENTION_UNPARSED,
        detail: joinCopy(FILE_RETENTION_SEE_DOCUMENTS, FILE_RETENTION_NOT_PHYSICAL),
        whenLabel: null,
      }
    }
    return {
      headline: `这份文件计划在 ${whenLabel} 自动删除`,
      detail: joinCopy(FILE_RETENTION_AUTO_DELETE, FILE_RETENTION_NOT_PHYSICAL),
      whenLabel,
    }
  }

  if (input.fileRetentionPolicy === 'long_term') {
    return {
      headline: '这份文件按长期保存，不会按短期自动删除',
      detail: joinCopy(
        '这里没有短期删除日期。要看它还在不在，打开「我的 → 我的文档」。',
        FILE_RETENTION_NOT_PHYSICAL,
      ),
      whenLabel: null,
    }
  }

  return {
    headline: FILE_RETENTION_NO_EXPIRY,
    detail: joinCopy(FILE_RETENTION_SEE_DOCUMENTS, FILE_RETENTION_NOT_PHYSICAL),
    whenLabel: null,
  }
}
