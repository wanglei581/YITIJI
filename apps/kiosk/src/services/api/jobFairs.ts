// ============================================================
// Job Fair Service — Phase 7.2
//
// 根据 API_MODE 选择适配器：
//   API_MODE=mock → mockJobFairAdapter（本地 mock 数据，无需后端）
//   API_MODE=http → httpJobFairAdapter（真实 /api/v1 接口）
//
// 页面层调用方式不变，切换模式只需修改环境变量并重启 dev server。
// ============================================================

import type {
  ApiResponse,
  PaginatedResponse,
  ExternalJobFairDTO,
  FairCompanyDTO,
  FairZoneDTO,
  FairBoothDTO,
  FairMaterialDTO,
  FairLiveStatsDTO,
} from '@ai-job-print/shared'
import { API_MODE } from './client'
import { mockJobFairAdapter } from './mockAdapter'
import { httpJobFairAdapter } from './httpAdapter'

// ──────────────────────────────────────────────────────────────
// 服务接口类型（供两种 adapter 共同实现）
// ──────────────────────────────────────────────────────────────

export interface JobFairServiceInterface {
  getJobFairs(params?: { status?: string }): Promise<PaginatedResponse<ExternalJobFairDTO>>
  getJobFairById(id: string): Promise<ApiResponse<ExternalJobFairDTO | null>>
  getFairCompanies(fairId: string): Promise<PaginatedResponse<FairCompanyDTO>>
  getFairCompanyById(fairId: string, companyId: string): Promise<ApiResponse<FairCompanyDTO | null>>
  getFairZones(fairId: string): Promise<ApiResponse<FairZoneDTO[]>>
  getFairMap(fairId: string): Promise<ApiResponse<{ zones: FairZoneDTO[]; booths: FairBoothDTO[] }>>
  getFairMaterials(fairId: string): Promise<PaginatedResponse<FairMaterialDTO>>
  getFairStats(fairId: string): Promise<ApiResponse<FairLiveStatsDTO | null>>
}

// ──────────────────────────────────────────────────────────────
// 适配器选择（构建时确定，支持 tree-shaking）
// ──────────────────────────────────────────────────────────────

const adapter: JobFairServiceInterface =
  API_MODE === 'http' ? httpJobFairAdapter : mockJobFairAdapter

// ──────────────────────────────────────────────────────────────
// 导出服务函数（页面层不感知 adapter 切换）
// ──────────────────────────────────────────────────────────────

export const getJobFairs        = (params?: { status?: string }) => adapter.getJobFairs(params)
export const getJobFairById     = (id: string)                    => adapter.getJobFairById(id)
export const getFairCompanies   = (fairId: string)                => adapter.getFairCompanies(fairId)
export const getFairCompanyById = (fairId: string, companyId: string) => adapter.getFairCompanyById(fairId, companyId)
export const getFairZones       = (fairId: string)                => adapter.getFairZones(fairId)
export const getFairMap         = (fairId: string)                => adapter.getFairMap(fairId)
export const getFairMaterials   = (fairId: string)                => adapter.getFairMaterials(fairId)
export const getFairStats       = (fairId: string)                => adapter.getFairStats(fairId)
