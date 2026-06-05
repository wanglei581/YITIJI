// ============================================================
// Job Mock Adapter — Phase 7.3（jobs 收口扩展）
//
// 将本地 MOCK_JOBS 转换为 ExternalJobDTO，
// 模拟真实 /api/v1/jobs 接口的数据结构与筛选语义。
//
// 与后端一致的约定：
//   - 行业(industry)以 `行业:` 前缀 tag 存放在 tags 里，对外抽取为 industry 字段
//     并从展示 tags 中剔除（与 services/api jobs.service.ts 同步）
//   - 岗位类型由中文 tag 派生 category（校招 > 实习 > 兼职 > 全职 优先级）
// ============================================================

import type { ApiResponse, PaginatedResponse, ExternalJobDTO } from '@ai-job-print/shared'
import type { ExternalJob } from '@ai-job-print/shared'
import { MOCK_JOBS } from '../../data/externalSources'
import type { JobQueryParams } from './jobs'

const INDUSTRY_TAG_PREFIX = '行业:'

const WORK_TYPE_MAP: Record<string, ExternalJobDTO['workType']> = {
  全职: 'full_time',
  兼职: 'part_time',
  实习: 'internship',
  校招: 'full_time',
}

/** 中文类型 tag → DB category 值（与后端 category 列对齐，供类型筛选） */
function deriveCategory(tags: string[]): ExternalJobDTO['category'] {
  if (tags.includes('校招')) return 'campus'
  if (tags.includes('实习')) return 'intern'
  if (tags.includes('兼职')) return 'parttime'
  if (tags.includes('全职')) return 'fulltime'
  return undefined
}

function toJobDTO(job: ExternalJob): ExternalJobDTO {
  const industryTag = job.tags.find((t) => t.startsWith(INDUSTRY_TAG_PREFIX))
  const tags = job.tags.filter((t) => !t.startsWith(INDUSTRY_TAG_PREFIX))
  const workType = tags.reduce<ExternalJobDTO['workType']>(
    (acc, t) => acc ?? WORK_TYPE_MAP[t],
    undefined,
  )
  return {
    ...job,
    tags,
    industry: industryTag ? industryTag.slice(INDUSTRY_TAG_PREFIX.length) : undefined,
    category: deriveCategory(job.tags),
    salaryDisplay: job.salary ?? '薪资面议',
    workType,
    dataSourceNote: `数据来源：${job.sourceName} · 同步于 ${job.syncTime.slice(0, 10)} · 仅供参考`,
  }
}

function makePaginated<T>(data: T[], page = 1, pageSize = 100): PaginatedResponse<T> {
  const total      = data.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return { data: data.slice((page - 1) * pageSize, page * pageSize), pagination: { page, pageSize, total, totalPages } }
}

function ok<T>(data: T): ApiResponse<T> {
  return { data, success: true }
}

// ──────────────────────────────────────────────────────────────
// Adapter 对象
// ──────────────────────────────────────────────────────────────

export const jobMockAdapter = {
  async getJobs(params?: JobQueryParams): Promise<PaginatedResponse<ExternalJobDTO>> {
    const kw = params?.keyword?.trim().toLowerCase()
    const jobs = MOCK_JOBS
      .filter((j) => j.reviewStatus === 'approved' && j.publishStatus === 'published')
      .map(toJobDTO)
      .filter((j) => {
        if (params?.city && j.city !== params.city) return false
        if (params?.industry && j.industry !== params.industry) return false
        if (params?.category && j.category !== params.category) return false
        if (params?.sourceOrgId && j.sourceOrgId !== params.sourceOrgId) return false
        if (params?.tag && !j.tags.includes(params.tag)) return false
        if (kw) {
          const hay = `${j.title} ${j.company} ${j.description ?? ''}`.toLowerCase()
          if (!hay.includes(kw)) return false
        }
        return true
      })
    return makePaginated(jobs, params?.page ?? 1, params?.pageSize ?? 100)
  },

  async getJobById(id: string): Promise<ApiResponse<ExternalJobDTO | null>> {
    const job = MOCK_JOBS.find((j) => j.id === id) ?? null
    return ok(job ? toJobDTO(job) : null)
  },
}
