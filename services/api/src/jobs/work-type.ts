export const JOB_WORK_TYPE_VALUES = ['full_time', 'part_time', 'internship', 'contract', 'campus'] as const

export type JobWorkTypeValue = typeof JOB_WORK_TYPE_VALUES[number]

const WORK_TYPE_ALIAS_GROUPS: Array<{ value: JobWorkTypeValue; aliases: string[] }> = [
  { value: 'campus', aliases: ['campus', '校招', '校园', '校园招聘', '应届', '应届生'] },
  { value: 'full_time', aliases: ['full_time', 'fulltime', '全职'] },
  { value: 'part_time', aliases: ['part_time', 'parttime', '兼职'] },
  { value: 'internship', aliases: ['internship', 'intern', '实习', '实习生'] },
  { value: 'contract', aliases: ['contract', '合同', '合同工'] },
]

export function normalizeJobWorkType(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const raw = value.trim()
  const normalized = raw.toLowerCase().replace(/[\s-]+/g, '_')
  const compact = normalized.replace(/_/g, '')

  const hits = WORK_TYPE_ALIAS_GROUPS.filter((group) => {
    return group.aliases.some((alias) => alias === normalized || alias === compact || alias === raw)
  })
  if (hits.length === 1) return hits[0]!.value
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
