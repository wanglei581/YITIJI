// ============================================================
// Jobs 页面展示元数据（仅 Kiosk 前台使用）
//
// 用途：为 /jobs 页面的「地区筛选 + 来源机构卡片 + 推荐岗位」UI
// 提供地区层级、来源机构分类、学历/经验等展示维度。
//
// 设计约束：
//   - 不修改 packages/shared 共享类型，也不改 services/api。
//   - 这些维度是“展示增强”，以岗位 id / sourceOrgId 关联到
//     真实接口返回的 ExternalJobDTO；http 模式下若缺元数据，
//     页面会优雅降级（地区筛选回退为“全部”，学历/经验显示“不限”）。
//   - 合规：仅展示第三方/官方来源岗位信息，不含任何招聘闭环字段。
// ============================================================

import type { ExternalJobDTO } from '@ai-job-print/shared'

// ──────────────────────────────────────────────────────────────
// 来源机构分类（展示用三类，独立于 shared 的 SourceKind 枚举）
// ──────────────────────────────────────────────────────────────

export type SourceCategory = '官方机构' | '第三方平台' | '合作来源'

export const SOURCE_CATEGORY_STYLE: Record<SourceCategory, string> = {
  官方机构: 'bg-primary-50 text-primary-700 border-primary-200',
  第三方平台: 'bg-neutral-100 text-neutral-600 border-neutral-200',
  合作来源: 'bg-success-bg text-success-fg border-success/30',
}

// ──────────────────────────────────────────────────────────────
// 地区三级联动数据（省 → 市 → 区县）
// ──────────────────────────────────────────────────────────────

export interface CityNode {
  name: string
  districts: string[]
}

export interface ProvinceNode {
  name: string
  cities: CityNode[]
}

export const REGION_TREE: ProvinceNode[] = [
  {
    name: '山东省',
    cities: [
      { name: '青岛市', districts: ['市南区', '市北区', '崂山区', '黄岛区', '城阳区'] },
      { name: '济南市', districts: ['历下区', '市中区', '历城区'] },
    ],
  },
  {
    name: '上海市',
    cities: [{ name: '上海市', districts: ['浦东新区', '徐汇区', '黄浦区'] }],
  },
  {
    name: '浙江省',
    cities: [{ name: '杭州市', districts: ['西湖区', '余杭区', '滨江区'] }],
  },
  {
    name: '广东省',
    cities: [{ name: '深圳市', districts: ['南山区', '福田区', '龙岗区'] }],
  },
]

// ──────────────────────────────────────────────────────────────
// 来源机构元数据（按 sourceOrgId 关联）
// ──────────────────────────────────────────────────────────────

export interface SourceOrgMeta {
  /** 卡片展示用的机构规范名称 */
  name: string
  category: SourceCategory
  /** 覆盖区域文案 */
  coverage: string
}

export const SOURCE_ORGS: Record<string, SourceOrgMeta> = {
  'org-001': { name: '招聘网', category: '第三方平台', coverage: '全国' },
  'org-002': { name: '青岛市人社局', category: '官方机构', coverage: '青岛市' },
  'org-003': { name: '青岛本地就业网', category: '合作来源', coverage: '青岛市' },
  'org-004': { name: '青岛人才网', category: '官方机构', coverage: '青岛市' },
  'org-005': { name: '校企合作就业中心', category: '合作来源', coverage: '青岛 · 高校' },
}

// ──────────────────────────────────────────────────────────────
// 单个岗位的展示元数据（按岗位 id 关联）
// ──────────────────────────────────────────────────────────────

export interface JobMeta {
  province: string
  city: string
  district: string
  education: string
  experience: string
}

export const JOB_META: Record<string, JobMeta> = {
  j1: { province: '上海市', city: '上海市', district: '浦东新区', education: '本科', experience: '应届' },
  j2: { province: '山东省', city: '青岛市', district: '市南区', education: '大专', experience: '经验不限' },
  j3: { province: '浙江省', city: '杭州市', district: '余杭区', education: '本科', experience: '应届' },
  j4: { province: '广东省', city: '深圳市', district: '南山区', education: '不限', experience: '实习' },
  j5: { province: '山东省', city: '青岛市', district: '市北区', education: '高中', experience: '1-3年' },
  j6: { province: '山东省', city: '青岛市', district: '崂山区', education: '本科', experience: '1-3年' },
  j7: { province: '山东省', city: '青岛市', district: '市南区', education: '不限', experience: '实习' },
  j8: { province: '山东省', city: '青岛市', district: '城阳区', education: '本科', experience: '应届' },
  j9: { province: '山东省', city: '青岛市', district: '市北区', education: '大专', experience: '1-3年' },
  j10: { province: '浙江省', city: '杭州市', district: '滨江区', education: '本科', experience: '3-5年' },
  j11: { province: '山东省', city: '青岛市', district: '黄岛区', education: '本科', experience: '应届' },
  j12: { province: '山东省', city: '青岛市', district: '市南区', education: '不限', experience: '经验不限' },
}

// ──────────────────────────────────────────────────────────────
// 视图模型 + 派生函数
// ──────────────────────────────────────────────────────────────

/** 岗位卡片视图：在接口返回的 DTO 上叠加展示维度（均为可选，缺失则降级） */
export interface JobCardView extends ExternalJobDTO {
  province?: string
  city: string
  district?: string
  education?: string
  experience?: string
  sourceCategory?: SourceCategory
  sourceOrgName?: string
}

/** 将接口 DTO 叠加展示元数据 */
export function enrichJob(dto: ExternalJobDTO): JobCardView {
  const meta = JOB_META[dto.id]
  const org = SOURCE_ORGS[dto.sourceOrgId]
  return {
    ...dto,
    province: meta?.province,
    city: meta?.city ?? dto.city,
    district: meta?.district,
    education: meta?.education,
    experience: meta?.experience,
    sourceCategory: org?.category,
    sourceOrgName: org?.name ?? dto.sourceName,
  }
}

/** 来源机构卡片 */
export interface SourceCard {
  orgId: string
  name: string
  category: SourceCategory
  coverage: string
  jobCount: number
  /** 该来源下最新一条岗位的同步时间（ISO） */
  lastUpdate: string
}

/** 按 sourceOrgId 聚合岗位，生成来源机构卡片（按岗位数量降序） */
export function buildSourceCards(jobs: JobCardView[]): SourceCard[] {
  const map = new Map<string, SourceCard>()
  for (const job of jobs) {
    const orgMeta = SOURCE_ORGS[job.sourceOrgId]
    const existing = map.get(job.sourceOrgId)
    if (existing) {
      existing.jobCount += 1
      if (job.syncTime > existing.lastUpdate) existing.lastUpdate = job.syncTime
    } else {
      map.set(job.sourceOrgId, {
        orgId: job.sourceOrgId,
        name: orgMeta?.name ?? job.sourceName,
        category: orgMeta?.category ?? '合作来源',
        coverage: orgMeta?.coverage ?? '—',
        jobCount: 1,
        lastUpdate: job.syncTime,
      })
    }
  }
  return [...map.values()].sort((a, b) => b.jobCount - a.jobCount)
}
