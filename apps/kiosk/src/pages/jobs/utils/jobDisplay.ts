import type { ExternalJobDTO } from '@ai-job-print/shared'

export const TYPE_OPTIONS: { label: string; category: string; hint: string }[] = [
  { label: '全部', category: '', hint: '查看所有已发布岗位' },
  { label: '全职', category: 'fulltime', hint: '稳定就业岗位' },
  { label: '实习', category: 'intern', hint: '在校生与应届生' },
  { label: '校招', category: 'campus', hint: '校园招聘专场' },
  { label: '兼职', category: 'parttime', hint: '灵活用工信息' },
]

export const CATEGORY_LABEL: Record<string, string> = {
  fulltime: '全职',
  intern: '实习',
  campus: '校招',
  parttime: '兼职',
}

export const CATEGORY_STYLE: Record<string, string> = {
  fulltime: 'bg-blue-50 text-blue-600',
  intern: 'bg-orange-50 text-orange-600',
  campus: 'bg-green-50 text-green-600',
  parttime: 'bg-purple-50 text-purple-600',
}

export const SELECT_CLASS =
  'h-14 w-full rounded-lg border border-neutral-300 bg-white px-4 text-base text-neutral-800 ' +
  'focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100'

export interface SourceCard {
  orgId: string
  name: string
  jobCount: number
  lastUpdate: string
}

export interface JobInsights {
  total: number
  sourceCount: number
  cityCount: number
  industryCount: number
  withSalary: number
  withRequirement: number
  withSourceUrl: number
  latestSync: string
  fieldCompleteness: number
}

export interface TagCount {
  label: string
  count: number
}

export function formatSync(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}月${d.getDate()}日更新`
}

export function formatFullDate(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

export function uniqueSorted(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b, 'zh'))
}

export function buildSourceCards(jobs: ExternalJobDTO[]): SourceCard[] {
  const map = new Map<string, SourceCard>()
  for (const job of jobs) {
    const existing = map.get(job.sourceOrgId)
    if (existing) {
      existing.jobCount += 1
      if (job.syncTime > existing.lastUpdate) existing.lastUpdate = job.syncTime
    } else {
      map.set(job.sourceOrgId, {
        orgId: job.sourceOrgId,
        name: job.sourceName,
        jobCount: 1,
        lastUpdate: job.syncTime,
      })
    }
  }
  return [...map.values()].sort((a, b) => b.jobCount - a.jobCount)
}

export function buildTopTags(jobs: ExternalJobDTO[], limit = 12): TagCount[] {
  const map = new Map<string, number>()
  for (const job of jobs) {
    for (const tag of job.tags) {
      map.set(tag, (map.get(tag) ?? 0) + 1)
    }
    if (job.industry) map.set(job.industry, (map.get(job.industry) ?? 0) + 1)
  }
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh'))
    .slice(0, limit)
}

export function buildJobInsights(jobs: ExternalJobDTO[]): JobInsights {
  const total = jobs.length
  const withSalary = jobs.filter((job) => Boolean(job.salary)).length
  const withRequirement = jobs.filter((job) => Boolean(job.requirements || job.description)).length
  const withSourceUrl = jobs.filter((job) => Boolean(job.sourceUrl)).length
  const latestSync = jobs.reduce((latest, job) => (job.syncTime > latest ? job.syncTime : latest), '')
  const filledFields = jobs.reduce((sum, job) => {
    const fields = [
      job.title,
      job.company,
      job.city,
      job.salaryDisplay,
      job.sourceName,
      job.sourceUrl,
      job.externalId,
      job.description,
      job.requirements,
      job.category,
      job.industry,
    ]
    return sum + fields.filter(Boolean).length
  }, 0)
  const totalFields = Math.max(1, total * 11)

  return {
    total,
    sourceCount: uniqueSorted(jobs.map((job) => job.sourceOrgId)).length,
    cityCount: uniqueSorted(jobs.map((job) => job.city)).length,
    industryCount: uniqueSorted(jobs.map((job) => job.industry)).length,
    withSalary,
    withRequirement,
    withSourceUrl,
    latestSync,
    fieldCompleteness: Math.round((filledFields / totalFields) * 100),
  }
}

export function splitTextLines(text?: string): string[] {
  if (!text) return []
  return text
    .split(/\n|[；;]/)
    .map((item) => item.replace(/^[\s\d.、-]+/, '').trim())
    .filter(Boolean)
}

export function jobCompleteness(job: ExternalJobDTO): number {
  const fields = [
    job.title,
    job.company,
    job.city,
    job.salaryDisplay,
    job.sourceName,
    job.sourceUrl,
    job.externalId,
    job.description,
    job.requirements,
    job.category,
    job.industry,
  ]
  return Math.round((fields.filter(Boolean).length / fields.length) * 100)
}
