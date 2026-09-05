import { formatDateTime } from '@ai-job-print/shared'

/** 打印完成页文件保留说明。时间必须来自后端 expiresAt / deletedAt，前台不写死时长。 */
export const FILE_RETENTION_UNAVAILABLE =
  '未能读取本次文件的保留期，保留期以后台策略为准'
export const FILE_RETENTION_UNPARSED =
  '未能解析本次文件的到期时间，保留期以后台策略为准'
export const FILE_RETENTION_NO_EXPIRY =
  '该文件未设置到期时间，保留期以后台策略为准'
export const FILE_RETENTION_NOT_WIPED =
  '这不是对存储介质的物理销毁。'

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

export function describePrintFileRetention(input: PrintFileRetentionInput): PrintFileRetentionCopy {
  if (input.fileDeletedAt) {
    const whenLabel = formatWhen(input.fileDeletedAt)
    const headline = whenLabel
      ? `该文件已于 ${whenLabel} 按策略删除`
      : '该文件已按策略删除（删除时间未能解析）'
    const reason = input.fileDeleteReason?.trim()
      ? `删除原因：${input.fileDeleteReason.trim()}。`
      : ''
    const storage = input.fileStorageDeletedAt
      ? '云端对象已删除。'
      : '删除记录已登记，云端对象是否已清除以后台清理账本为准。'
    return {
      headline,
      detail: `${reason}${storage}${FILE_RETENTION_NOT_WIPED}`,
      whenLabel,
    }
  }

  if (input.fileRetentionAvailable !== true) {
    return {
      headline: FILE_RETENTION_UNAVAILABLE,
      detail: `前台不会编造保留时长。${FILE_RETENTION_NOT_WIPED}`,
      whenLabel: null,
    }
  }

  if (input.fileExpiresAt) {
    const whenLabel = formatWhen(input.fileExpiresAt)
    if (!whenLabel) {
      return {
        headline: FILE_RETENTION_UNPARSED,
        detail: `后端返回了到期字段，但无法解析为有效时间。${FILE_RETENTION_NOT_WIPED}`,
        whenLabel: null,
      }
    }
    return {
      headline: `本次打印文件计划于 ${whenLabel} 按后台策略从云端删除`,
      detail: `到期后由清理任务删除云端文件并保留删除记录。${FILE_RETENTION_NOT_WIPED}`,
      whenLabel,
    }
  }

  if (input.fileRetentionPolicy === 'long_term') {
    return {
      headline: '本次文件为长期保存，不会按短期策略自动清理',
      detail: `后端 expiresAt 为空，保存策略为长期保存。${FILE_RETENTION_NOT_WIPED}`,
      whenLabel: null,
    }
  }

  return {
    headline: FILE_RETENTION_NO_EXPIRY,
    detail: `后端未返回到期时间，也未标记为长期保存。${FILE_RETENTION_NOT_WIPED}`,
    whenLabel: null,
  }
}
