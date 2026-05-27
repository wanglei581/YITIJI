// ============================================================
// Job Mock Adapter — Phase 7.3
//
// 将本地 MOCK_JOBS 转换为 ExternalJobDTO，
// 模拟真实 /api/v1/jobs 接口的数据结构。
// ============================================================

import type { ApiResponse, PaginatedResponse, ExternalJobDTO } from '@ai-job-print/shared'
import type { ExternalJob } from '@ai-job-print/shared'
import { MOCK_JOBS } from '../../data/externalSources'

// ──────────────────────────────────────────────────────────────
// 内部转换函数
// ──────────────────────────────────────────────────────────────

const WORK_TYPE_MAP: Record<string, ExternalJobDTO['workType']> = {
  全职: 'full_time',
  兼职: 'part_time',
  实习: 'internship',
  校招: 'full_time',
}

function toJobDTO(job: ExternalJob): ExternalJobDTO {
  const workType = job.tags.reduce<ExternalJobDTO['workType']>(
    (acc, t) => acc ?? WORK_TYPE_MAP[t],
    undefined,
  )
  return {
    ...job,
    salaryDisplay: job.salary ?? '薪资面议',
    workType,
    dataSourceNote: `数据来源：${job.sourceName} · 同步于 ${job.syncTime.slice(0, 10)} · 仅供参考`,
  }
}

function makePaginated<T>(data: T[], page = 1, pageSize = 100): PaginatedResponse<T> {
  const total      = data.length
  const totalPages = Math.ceil(total / pageSize)
  return { data: data.slice((page - 1) * pageSize, page * pageSize), pagination: { page, pageSize, total, totalPages } }
}

function ok<T>(data: T): ApiResponse<T> {
  return { data, success: true }
}

// ──────────────────────────────────────────────────────────────
// Adapter 对象
// ──────────────────────────────────────────────────────────────

export const jobMockAdapter = {
  async getJobs(params?: { tag?: string }): Promise<PaginatedResponse<ExternalJobDTO>> {
    const jobs = MOCK_JOBS
      .filter((j) => j.reviewStatus === 'approved' && j.publishStatus === 'published')
      .filter((j) => !params?.tag || j.tags.includes(params.tag))
      .map(toJobDTO)
    return makePaginated(jobs)
  },

  async getJobById(id: string): Promise<ApiResponse<ExternalJobDTO | null>> {
    const job = MOCK_JOBS.find((j) => j.id === id) ?? null
    return ok(job ? toJobDTO(job) : null)
  },
}
