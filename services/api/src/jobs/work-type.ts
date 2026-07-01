export const JOB_WORK_TYPE_VALUES = ['full_time', 'part_time', 'internship', 'contract', 'campus'] as const

export type JobWorkTypeValue = typeof JOB_WORK_TYPE_VALUES[number]

export function normalizeJobWorkType(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const raw = value.trim()
  const normalized = raw.toLowerCase().replace(/[\s-]+/g, '_')
  const compact = normalized.replace(/_/g, '')

  if (normalized === 'campus' || raw.includes('校招') || raw.includes('校园') || raw.includes('应届')) return 'campus'
  if (normalized === 'full_time' || compact === 'fulltime' || raw.includes('全职')) return 'full_time'
  if (normalized === 'part_time' || compact === 'parttime' || raw.includes('兼职')) return 'part_time'
  if (normalized === 'internship' || normalized === 'intern' || raw.includes('实习')) return 'internship'
  if (normalized === 'contract' || raw.includes('合同')) return 'contract'
  return raw
}

export function mapJobWorkTypeToCategory(workType: string | undefined): string | undefined {
  const normalized = normalizeJobWorkType(workType)
  if (typeof normalized !== 'string') return undefined

  switch (normalized) {
    case 'full_time':
    case 'contract':
      return 'fulltime'
    case 'part_time':
      return 'parttime'
    case 'internship':
      return 'intern'
    case 'campus':
      return 'campus'
    case 'fulltime':
    case 'parttime':
    case 'intern':
      return normalized
    default:
      return undefined
  }
}
