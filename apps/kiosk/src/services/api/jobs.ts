// ============================================================
// Job Service — Phase 7.3
//
// 根据 API_MODE 选择适配器：
//   API_MODE=mock → jobMockAdapter（本地 mock 数据，无需后端）
//   API_MODE=http → jobHttpAdapter（真实 /api/v1/jobs 接口）
//
// 页面层调用方式不变，切换模式只需修改环境变量。
// ============================================================

import type { ApiResponse, PaginatedResponse, ExternalJobDTO } from '@ai-job-print/shared'
import { API_MODE } from './client'
import { jobMockAdapter } from './jobMockAdapter'
import { jobHttpAdapter } from './jobHttpAdapter'

// ──────────────────────────────────────────────────────────────
// 服务接口类型（供两种 adapter 共同实现）
// ──────────────────────────────────────────────────────────────

export interface JobServiceInterface {
  getJobs(params?: { tag?: string }): Promise<PaginatedResponse<ExternalJobDTO>>
  getJobById(id: string): Promise<ApiResponse<ExternalJobDTO | null>>
}

// ──────────────────────────────────────────────────────────────
// 适配器选择（构建时确定，支持 tree-shaking）
// ──────────────────────────────────────────────────────────────

const adapter: JobServiceInterface =
  API_MODE === 'http' ? jobHttpAdapter : jobMockAdapter

// ──────────────────────────────────────────────────────────────
// 导出服务函数（页面层不感知 adapter 切换）
// ──────────────────────────────────────────────────────────────

export const getJobs    = (params?: { tag?: string }) => adapter.getJobs(params)
export const getJobById = (id: string)                 => adapter.getJobById(id)
