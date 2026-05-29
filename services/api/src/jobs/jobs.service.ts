// ============================================================
// Jobs Service — Phase 7.10
//
// In-memory store (placeholder until Prisma persistence).
// Implements all CRUD operations for jobs and fairs.
//
// 合规约束：
// - Kiosk 只能查询 approved + published 数据
// - Partner 导入默认 pending + draft，必须经 Admin 审核
// - Admin approve → approved + draft（不直接发布）
// - 不返回 apiSecret / accessToken / 凭证字段
// ============================================================

import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common'
import type { ReviewAction } from './dto/review.dto'
import type { PublishAction } from './dto/publish.dto'
import type { ImportJobItemDto } from './dto/import-jobs.dto'
import type { ImportFairsDto } from './dto/import-fairs.dto'
import { PrismaService } from '../prisma/prisma.service'
import type { AuthedUser } from '../common/decorators/current-user.decorator'

// ─── Internal types (not imported from shared — ESM/CJS incompatibility) ──────

type ReviewStatus  = 'pending' | 'reviewing' | 'approved' | 'rejected'
type PublishStatus = 'draft' | 'published' | 'unpublished' | 'expired'
type FairStatus    = 'upcoming' | 'ongoing' | 'ended'
type WorkType      = 'full_time' | 'part_time' | 'internship' | 'contract'

export interface JobRecord {
  id: string
  title: string
  company: string
  city: string
  salary?: string
  tags: string[]
  description?: string
  requirements?: string
  industry?: string
  workType?: WorkType
  headcount?: number
  sourceOrgId: string
  externalId: string
  sourceName: string
  sourceUrl: string
  syncTime: string
  reviewStatus: ReviewStatus
  publishStatus: PublishStatus
  createdAt: string
  updatedAt: string
}

export interface FairRecord {
  id: string
  name: string
  organizer: string
  startTime: string
  endTime: string
  venue: string
  status: FairStatus
  description?: string
  boothCount?: number
  sourceOrgId: string
  externalId: string
  sourceName: string
  sourceUrl: string
  syncTime: string
  reviewStatus: ReviewStatus
  publishStatus: PublishStatus
  createdAt: string
  updatedAt: string
}

// ─── DTO shapes returned to callers (subset of record, no internal status for kiosk) ─

export interface JobListItemDto {
  id: string; title: string; company: string; city: string
  salary?: string; tags: string[]; industry?: string; workType?: WorkType; headcount?: number
  sourceOrgId: string; externalId: string; sourceName: string; sourceUrl: string; syncTime: string
  description?: string; requirements?: string
  salaryDisplay: string
  dataSourceNote: string
}

export interface FairListItemDto {
  id: string; name: string; organizer: string
  startTime: string; endTime: string; venue: string; status: FairStatus
  description?: string; boothCount?: number
  sourceOrgId: string; externalId: string; sourceName: string; sourceUrl: string; syncTime: string
  hasManagedData: boolean; managedCompanyCount: number; managedMaterialCount: number
  dataSourceNote: string
}

export type AdminJobDto  = Omit<JobRecord,  'createdAt' | 'updatedAt'>
export type AdminFairDto = Omit<FairRecord, 'createdAt' | 'updatedAt'>

export interface PartnerJobDto {
  id: string; externalId: string; title: string; company: string; city: string
  sourceUrl: string; syncTime: string; reviewStatus: ReviewStatus; publishStatus: PublishStatus
  sourceOrgId: string; sourceName: string
}

export interface PartnerFairDto {
  id: string; externalId: string; name: string; organizer: string
  startTime: string; endTime: string; venue: string; status: FairStatus
  sourceUrl: string; syncTime: string; reviewStatus: ReviewStatus; publishStatus: PublishStatus
  sourceOrgId: string; sourceName: string
}

export interface PaginatedResult<T> {
  data: T[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}

export interface SingleResult<T> {
  data: T | null
  success: boolean
}

export interface ImportResult<T> {
  imported: number
  items: T[]
}

// ─── Seed data ────────────────────────────────────────────────────────────────

const NOW = '2026-05-26'

const SEED_JOBS: JobRecord[] = [
  {
    id: 'j1', title: '前端开发工程师', company: '上海某科技有限公司', city: '上海',
    salary: '15-25K', tags: ['全职', '前端', 'React'], industry: '互联网/软件',
    workType: 'full_time', headcount: 2,
    description: '负责公司 Web 前端开发，需熟悉 React、TypeScript、Tailwind CSS。',
    requirements: '本科及以上学历，2 年以上前端开发经验，熟悉主流前端框架。',
    sourceOrgId: 'org-zhilian-001', externalId: 'ZL-2026-884521',
    sourceName: '智联招聘', sourceUrl: 'https://jobs.zhaopin.com/j/884521',
    syncTime: `${NOW} 08:00`, reviewStatus: 'approved', publishStatus: 'published',
    createdAt: `${NOW}T00:00:00.000Z`, updatedAt: `${NOW}T08:00:00.000Z`,
  },
  {
    id: 'j2', title: 'Java 后端开发', company: '北京某互联网公司', city: '北京',
    salary: '20-30K', tags: ['全职', '后端', 'Java', 'Spring'], industry: '互联网/软件',
    workType: 'full_time', headcount: 3,
    description: '负责后台服务开发，使用 Spring Boot + MySQL + Redis 技术栈。',
    requirements: '本科及以上学历，3 年以上 Java 开发经验，熟悉分布式架构。',
    sourceOrgId: 'org-51job-001', externalId: '51J-20260525-0021',
    sourceName: '前程无忧', sourceUrl: 'https://www.51job.com/j/20260525-0021',
    syncTime: `${NOW} 08:00`, reviewStatus: 'approved', publishStatus: 'published',
    createdAt: `${NOW}T00:00:00.000Z`, updatedAt: `${NOW}T08:00:00.000Z`,
  },
  {
    id: 'j3', title: '护士', company: '某三甲医院', city: '本市',
    salary: '6-10K', tags: ['全职', '医疗', '护理'], industry: '医疗/卫生',
    workType: 'full_time', headcount: 5,
    description: '临床护理工作，参与病房护理及患者健康管理。',
    requirements: '护理专业大专及以上学历，具备护士执业资格证。',
    sourceOrgId: 'org-city-talent-001', externalId: 'RC-2026-330106',
    sourceName: '市人才网', sourceUrl: 'https://rcw.city.gov.cn/j/330106',
    syncTime: `${NOW} 07:30`, reviewStatus: 'approved', publishStatus: 'published',
    createdAt: `${NOW}T00:00:00.000Z`, updatedAt: `${NOW}T07:30:00.000Z`,
  },
  {
    id: 'j4', title: '应届生储备干部', company: '某大型国企', city: '全国',
    salary: '面议', tags: ['校招', '管培', '全职'], industry: '国有企业',
    workType: 'full_time', headcount: 20,
    description: '面向应届毕业生的管理培训生项目，培养未来核心管理人才。',
    requirements: '2026 届毕业生，本科及以上学历，有良好的沟通和学习能力。',
    sourceOrgId: 'org-uni-001', externalId: 'GX-2026-CG-0042',
    sourceName: '高校就业信息网', sourceUrl: 'https://job.uni.edu.cn/j/42',
    syncTime: `${NOW} 16:00`, reviewStatus: 'approved', publishStatus: 'published',
    createdAt: `${NOW}T00:00:00.000Z`, updatedAt: `${NOW}T16:00:00.000Z`,
  },
  {
    id: 'j5', title: 'UI 设计师', company: '深圳某设计公司', city: '深圳',
    salary: '12-20K', tags: ['全职', '设计', 'UI/UX'], industry: '设计/创意',
    workType: 'full_time',
    description: '负责产品界面设计，需具备扎实的视觉设计能力和用户体验思维。',
    requirements: '本科及以上学历，3 年以上 UI 设计经验，熟练使用 Figma。',
    sourceOrgId: 'org-boss-001', externalId: 'BP-M9234712',
    sourceName: 'Boss 直聘', sourceUrl: 'https://www.zhipin.com/j/M9234712',
    syncTime: `${NOW} 09:00`, reviewStatus: 'approved', publishStatus: 'draft',
    createdAt: `${NOW}T00:00:00.000Z`, updatedAt: `${NOW}T09:00:00.000Z`,
  },
  {
    id: 'j6', title: '数据分析师', company: '杭州某电商平台', city: '杭州',
    salary: '18-28K', tags: ['全职', '数据', 'Python', 'SQL'], industry: '电子商务',
    workType: 'full_time',
    description: '负责业务数据分析，建立分析模型，输出数据洞察报告。',
    requirements: '本科及以上学历，2 年以上数据分析经验，熟悉 Python/SQL。',
    sourceOrgId: 'org-zhilian-001', externalId: 'ZL-2026-892204',
    sourceName: '智联招聘', sourceUrl: 'https://jobs.zhaopin.com/j/892204',
    syncTime: `${NOW} 09:00`, reviewStatus: 'reviewing', publishStatus: 'draft',
    createdAt: `${NOW}T00:00:00.000Z`, updatedAt: `${NOW}T09:00:00.000Z`,
  },
  {
    id: 'j7', title: '软件开发实习生', company: '某科技有限公司', city: '上海',
    salary: '3-5K', tags: ['实习', '前端', 'React'], industry: '互联网/软件',
    workType: 'internship',
    description: '协助团队完成前端开发工作，参与产品迭代。',
    requirements: '在读本科或研究生，熟悉 HTML/CSS/JavaScript，了解 React 优先。',
    sourceOrgId: 'org-uni-001', externalId: 'UNI-2026-JOB-0041',
    sourceName: '高校就业信息网', sourceUrl: 'https://job.uni.edu.cn/j/41',
    syncTime: `${NOW} 08:00`, reviewStatus: 'pending', publishStatus: 'draft',
    createdAt: `${NOW}T00:00:00.000Z`, updatedAt: `${NOW}T08:00:00.000Z`,
  },
  {
    id: 'j8', title: '产品经理', company: '广州某科技公司', city: '广州',
    salary: '25-40K', tags: ['全职', '产品', 'PM'], industry: '互联网/软件',
    workType: 'full_time',
    description: '负责产品规划与设计，协调研发、设计、运营协作推进产品迭代。',
    requirements: '本科及以上学历，5 年以上产品经理经验，有 ToB 产品经验优先。',
    sourceOrgId: 'org-boss-001', externalId: 'BP-M9251003',
    sourceName: 'Boss 直聘', sourceUrl: 'https://www.zhipin.com/j/M9251003',
    syncTime: `${NOW} 09:00`, reviewStatus: 'rejected', publishStatus: 'draft',
    createdAt: `${NOW}T00:00:00.000Z`, updatedAt: `${NOW}T09:00:00.000Z`,
  },
]

const SEED_FAIRS: FairRecord[] = [
  {
    id: 'f1', name: '2026 年春季大型招聘会', organizer: '市人力资源和社会保障局',
    startTime: '2026-06-01 09:00', endTime: '2026-06-01 17:00', venue: '市会展中心 A 馆',
    status: 'upcoming', boothCount: 120,
    description: '本市规模最大的春季综合招聘会，汇聚 200 余家企业，提供万余个岗位。',
    sourceOrgId: 'org-city-hr-001', externalId: 'RSJ-2026-FAIR-001',
    sourceName: '市人社局', sourceUrl: 'https://hrss.city.gov.cn/fair/2026-spring',
    syncTime: `${NOW} 10:00`, reviewStatus: 'approved', publishStatus: 'published',
    createdAt: `${NOW}T00:00:00.000Z`, updatedAt: `${NOW}T10:00:00.000Z`,
  },
  {
    id: 'f2', name: '高校双选会（春）', organizer: '某大学就业指导中心',
    startTime: '2026-05-28 10:00', endTime: '2026-05-28 16:00', venue: '某大学体育馆',
    status: 'upcoming', boothCount: 60,
    description: '面向应届毕业生举办的校园专场招聘会，聚焦互联网、金融、制造业岗位。',
    sourceOrgId: 'org-uni-001', externalId: 'UNI-2026-FAIR-023',
    sourceName: '高校就业信息网', sourceUrl: 'https://job.uni.edu.cn/fair/23',
    syncTime: '2026-05-23 09:00', reviewStatus: 'approved', publishStatus: 'published',
    createdAt: `${NOW}T00:00:00.000Z`, updatedAt: '2026-05-23T09:00:00.000Z',
  },
  {
    id: 'f3', name: '制造业专场招聘会', organizer: '市人才交流中心',
    startTime: '2026-05-25 09:00', endTime: '2026-05-25 15:00', venue: 'B 区大厅',
    status: 'ongoing', boothCount: 45,
    description: '聚焦制造业、机械、电气工程岗位，提供 500 余个就业机会。',
    sourceOrgId: 'org-city-talent-001', externalId: 'RC-2026-FAIR-055',
    sourceName: '市人才网', sourceUrl: 'https://rcw.city.gov.cn/fair/055',
    syncTime: '2026-05-22 14:00', reviewStatus: 'approved', publishStatus: 'published',
    createdAt: `${NOW}T00:00:00.000Z`, updatedAt: '2026-05-22T14:00:00.000Z',
  },
  {
    id: 'f4', name: '退役军人专场招聘会', organizer: '市退役军人事务局',
    startTime: '2026-06-05 09:00', endTime: '2026-06-05 16:00', venue: '市人力资源中心',
    status: 'upcoming', boothCount: 30,
    sourceOrgId: 'org-city-hr-001', externalId: 'RSJ-2026-FAIR-002',
    sourceName: '市人社局', sourceUrl: 'https://hrss.city.gov.cn/fair/military-2026',
    syncTime: `${NOW} 08:00`, reviewStatus: 'approved', publishStatus: 'draft',
    createdAt: `${NOW}T00:00:00.000Z`, updatedAt: `${NOW}T08:00:00.000Z`,
  },
  {
    id: 'f5', name: '互联网行业专场招聘', organizer: '某大学就业指导中心',
    startTime: '2026-06-10 14:00', endTime: '2026-06-10 17:00', venue: '某大学图书馆报告厅',
    status: 'upcoming', boothCount: 20,
    sourceOrgId: 'org-uni-001', externalId: 'UNI-2026-FAIR-024',
    sourceName: '高校就业信息网', sourceUrl: 'https://job.uni.edu.cn/fair/24',
    syncTime: `${NOW} 09:00`, reviewStatus: 'pending', publishStatus: 'draft',
    createdAt: `${NOW}T00:00:00.000Z`, updatedAt: `${NOW}T09:00:00.000Z`,
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toJobListItem(r: JobRecord): JobListItemDto {
  return {
    id: r.id, title: r.title, company: r.company, city: r.city,
    salary: r.salary, tags: r.tags, industry: r.industry,
    workType: r.workType, headcount: r.headcount,
    description: r.description, requirements: r.requirements,
    sourceOrgId: r.sourceOrgId, externalId: r.externalId,
    sourceName: r.sourceName, sourceUrl: r.sourceUrl, syncTime: r.syncTime,
    salaryDisplay: r.salary ?? '薪资面议',
    dataSourceNote: `数据来源：${r.sourceName} · 同步于 ${r.syncTime.slice(0, 10)} · 仅供参考`,
  }
}

function toFairListItem(r: FairRecord): FairListItemDto {
  return {
    id: r.id, name: r.name, organizer: r.organizer,
    startTime: r.startTime, endTime: r.endTime, venue: r.venue, status: r.status,
    description: r.description, boothCount: r.boothCount,
    sourceOrgId: r.sourceOrgId, externalId: r.externalId,
    sourceName: r.sourceName, sourceUrl: r.sourceUrl, syncTime: r.syncTime,
    hasManagedData: false, managedCompanyCount: 0, managedMaterialCount: 0,
    dataSourceNote: `数据来源：${r.sourceName} · 同步于 ${r.syncTime.slice(0, 10)} · 仅供参考`,
  }
}

function toAdminJobDto(r: JobRecord): AdminJobDto {
  return Object.fromEntries(
    Object.entries(r).filter(([k]) => k !== 'createdAt' && k !== 'updatedAt'),
  ) as AdminJobDto
}

function toAdminFairDto(r: FairRecord): AdminFairDto {
  return Object.fromEntries(
    Object.entries(r).filter(([k]) => k !== 'createdAt' && k !== 'updatedAt'),
  ) as AdminFairDto
}

function toPartnerJobDto(r: JobRecord): PartnerJobDto {
  return {
    id: r.id, externalId: r.externalId, title: r.title, company: r.company, city: r.city,
    sourceUrl: r.sourceUrl, syncTime: r.syncTime,
    reviewStatus: r.reviewStatus, publishStatus: r.publishStatus,
    sourceOrgId: r.sourceOrgId, sourceName: r.sourceName,
  }
}

/**
 * Phase #5 — 把 Prisma Job 模型映射为前端通用的 PartnerJobDto。
 * 与 toPartnerJobDto(in-memory JobRecord 版本)并存,等所有路径迁
 * 到 Prisma 后再统一删除内存版本。
 */
function prismaJobToPartnerDto(j: {
  id: string; externalId: string; title: string; company: string; city: string
  sourceUrl: string; syncTime: Date
  reviewStatus: string; publishStatus: string
  sourceOrgId: string; sourceName: string
}): PartnerJobDto {
  return {
    id: j.id, externalId: j.externalId, title: j.title, company: j.company, city: j.city,
    sourceUrl: j.sourceUrl,
    syncTime: j.syncTime.toISOString().replace('T', ' ').slice(0, 16),
    reviewStatus:  j.reviewStatus  as ReviewStatus,
    publishStatus: j.publishStatus as PublishStatus,
    sourceOrgId: j.sourceOrgId, sourceName: j.sourceName,
  }
}

/**
 * Import DTO 的 workType('full_time' / 'part_time' / 'internship' / 'contract')
 * 映射到 Prisma Job.category('fulltime' / 'parttime' / 'intern' / 'campus')。
 * 'contract' 暂归 'fulltime'(雇佣形式上接近全职合同制,后续可独立分类)。
 */
function mapWorkTypeToCategory(workType: string): string {
  switch (workType) {
    case 'full_time':  return 'fulltime'
    case 'part_time':  return 'parttime'
    case 'internship': return 'intern'
    case 'contract':   return 'fulltime'
    default:           return 'fulltime'
  }
}

function toPartnerFairDto(r: FairRecord): PartnerFairDto {
  return {
    id: r.id, externalId: r.externalId, name: r.name, organizer: r.organizer,
    startTime: r.startTime, endTime: r.endTime, venue: r.venue, status: r.status,
    sourceUrl: r.sourceUrl, syncTime: r.syncTime,
    reviewStatus: r.reviewStatus, publishStatus: r.publishStatus,
    sourceOrgId: r.sourceOrgId, sourceName: r.sourceName,
  }
}

function paginate<T>(data: T[], page = 1, pageSize = 20): PaginatedResult<T> {
  const total      = data.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage   = Math.max(1, Math.min(page, totalPages))
  return {
    data: data.slice((safePage - 1) * pageSize, safePage * pageSize),
    pagination: { page: safePage, pageSize, total, totalPages },
  }
}

function nowIso(): string { return new Date().toISOString() }

function genId(): string { return `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name)
  private jobs:  JobRecord[]  = [...SEED_JOBS]
  private fairs: FairRecord[] = [...SEED_FAIRS]

  constructor(private readonly prisma: PrismaService) {}

  // ── Kiosk: published data only ──────────────────────────────────────────────

  getPublishedJobs(params?: { tag?: string; city?: string; page?: number; pageSize?: number }): PaginatedResult<JobListItemDto> {
    let data = this.jobs.filter(
      (j) => j.reviewStatus === 'approved' && j.publishStatus === 'published',
    )
    if (params?.tag)  data = data.filter((j) => j.tags.includes(params.tag!))
    if (params?.city) data = data.filter((j) => j.city === params.city)
    return paginate(data.map(toJobListItem), params?.page, params?.pageSize)
  }

  getPublishedJobById(id: string): SingleResult<JobListItemDto> {
    const job = this.jobs.find(
      (j) => j.id === id && j.reviewStatus === 'approved' && j.publishStatus === 'published',
    )
    return { data: job ? toJobListItem(job) : null, success: true }
  }

  getPublishedFairs(params?: { status?: string; page?: number; pageSize?: number }): PaginatedResult<FairListItemDto> {
    let data = this.fairs.filter(
      (f) => f.reviewStatus === 'approved' && f.publishStatus === 'published',
    )
    if (params?.status) data = data.filter((f) => f.status === params.status)
    return paginate(data.map(toFairListItem), params?.page, params?.pageSize)
  }

  getPublishedFairById(id: string): SingleResult<FairListItemDto> {
    const fair = this.fairs.find(
      (f) => f.id === id && f.reviewStatus === 'approved' && f.publishStatus === 'published',
    )
    return { data: fair ? toFairListItem(fair) : null, success: true }
  }

  // ── Admin: all records ──────────────────────────────────────────────────────

  getAllJobSources(): AdminJobDto[] {
    return [...this.jobs].reverse().map(toAdminJobDto)
  }

  reviewJobSource(id: string, action: ReviewAction, _reason?: string): AdminJobDto {
    const idx = this.jobs.findIndex((j) => j.id === id)
    if (idx === -1) throw new NotFoundException(`Job ${id} not found`)
    const now = nowIso()
    const reviewStatus: ReviewStatus =
      action === 'approve' ? 'approved' :
      action === 'reject'  ? 'rejected' : 'reviewing'
    this.jobs[idx] = {
      ...this.jobs[idx]!,
      reviewStatus,
      publishStatus: action === 'approve' ? 'draft' : this.jobs[idx]!.publishStatus,
      updatedAt: now,
    }
    return toAdminJobDto(this.jobs[idx]!)
  }

  publishJobSource(id: string, action: PublishAction): AdminJobDto {
    const idx = this.jobs.findIndex((j) => j.id === id)
    if (idx === -1) throw new NotFoundException(`Job ${id} not found`)
    if (action === 'publish' && this.jobs[idx]!.reviewStatus !== 'approved') {
      throw new BadRequestException('PUBLISH_REQUIRES_APPROVAL')
    }
    this.jobs[idx] = {
      ...this.jobs[idx]!,
      publishStatus: action === 'publish' ? 'published' : 'unpublished',
      updatedAt: nowIso(),
    }
    return toAdminJobDto(this.jobs[idx]!)
  }

  getAllFairSources(): AdminFairDto[] {
    return [...this.fairs].reverse().map(toAdminFairDto)
  }

  reviewFairSource(id: string, action: ReviewAction, _reason?: string): AdminFairDto {
    const idx = this.fairs.findIndex((f) => f.id === id)
    if (idx === -1) throw new NotFoundException(`Fair ${id} not found`)
    const now = nowIso()
    const reviewStatus: ReviewStatus =
      action === 'approve' ? 'approved' :
      action === 'reject'  ? 'rejected' : 'reviewing'
    this.fairs[idx] = {
      ...this.fairs[idx]!,
      reviewStatus,
      publishStatus: action === 'approve' ? 'draft' : this.fairs[idx]!.publishStatus,
      updatedAt: now,
    }
    return toAdminFairDto(this.fairs[idx]!)
  }

  publishFairSource(id: string, action: PublishAction): AdminFairDto {
    const idx = this.fairs.findIndex((f) => f.id === id)
    if (idx === -1) throw new NotFoundException(`Fair ${id} not found`)
    if (action === 'publish' && this.fairs[idx]!.reviewStatus !== 'approved') {
      throw new BadRequestException('PUBLISH_REQUIRES_APPROVAL')
    }
    this.fairs[idx] = {
      ...this.fairs[idx]!,
      publishStatus: action === 'publish' ? 'published' : 'unpublished',
      updatedAt: nowIso(),
    }
    return toAdminFairDto(this.fairs[idx]!)
  }

  // ── Partner: org-scoped ──────────────────────────────────────────────────────

  getPartnerJobs(sourceOrgId?: string): PartnerJobDto[] {
    const data = sourceOrgId
      ? this.jobs.filter((j) => j.sourceOrgId === sourceOrgId)
      : [...this.jobs]
    return data.reverse().map(toPartnerJobDto)
  }

  /**
   * Phase #5 — Partner 导入岗位,落 Job 表(替代 0a/0b 之前的内存数组)。
   *
   * 关键约束:
   *  - sourceOrgId 强制取自 JWT 的 user.orgId,不读 body
   *  - sourceName 来自 DB 中机构当前名,不读 body
   *  - 默认 reviewStatus='pending' / publishStatus='draft'
   *  - 重复(sourceOrgId, externalId)走 upsert 幂等(只更新展示字段,
   *    不改审核/发布状态,避免"刷字段绕过审核"攻击面)
   */
  async importJobs(items: ImportJobItemDto[], user: AuthedUser): Promise<ImportResult<PartnerJobDto>> {
    if (user.role !== 'partner' || !user.orgId) {
      // RolesGuard 已挡掉非 partner;orgId 缺失是数据异常
      throw new BadRequestException({
        error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' },
      })
    }

    const org = await this.prisma.organization.findUnique({ where: { id: user.orgId } })
    if (!org || !org.enabled) {
      throw new BadRequestException({
        error: { code: 'PARTNER_ORG_NOT_FOUND', message: '机构不存在或已停用' },
      })
    }

    const sourceOrgId = org.id
    const sourceName  = org.name
    const sync        = new Date()

    const out: PartnerJobDto[] = []
    for (const item of items) {
      try {
        const job = await this.prisma.job.upsert({
          where: { sourceOrgId_externalId: { sourceOrgId, externalId: item.externalId } },
          create: {
            sourceOrgId, externalId: item.externalId, sourceName,
            sourceUrl: item.sourceUrl,
            title: item.title, company: item.company, city: item.city,
            category: item.workType ? mapWorkTypeToCategory(item.workType) : undefined,
            salary: item.salary,
            description: item.description, requirements: item.requirements,
            tagsJson: JSON.stringify(item.tags ?? []),
            // 强制 pending + draft — 合规红线,不允许 body 覆盖
            reviewStatus: 'pending', publishStatus: 'draft',
            syncTime: sync,
          },
          update: {
            // 重复导入只刷新展示字段 + 来源,审核/发布状态保留
            sourceName, sourceUrl: item.sourceUrl,
            title: item.title, company: item.company, city: item.city,
            category: item.workType ? mapWorkTypeToCategory(item.workType) : undefined,
            salary: item.salary,
            description: item.description, requirements: item.requirements,
            tagsJson: JSON.stringify(item.tags ?? []),
            syncTime: sync,
          },
        })
        out.push(prismaJobToPartnerDto(job))
      } catch (e) {
        this.logger.error(`importJobs upsert failed: orgId=${sourceOrgId} extId=${item.externalId}`, e as Error)
        throw new InternalServerErrorException({
          error: { code: 'IMPORT_FAILED', message: '岗位导入失败,请稍后重试' },
        })
      }
    }

    this.logger.log(`importJobs: orgId=${sourceOrgId} count=${out.length}`)
    return { imported: out.length, items: out }
  }

  unpublishPartnerJob(id: string, sourceOrgId?: string): PartnerJobDto {
    const idx = this.jobs.findIndex(
      (j) => j.id === id && (!sourceOrgId || j.sourceOrgId === sourceOrgId),
    )
    if (idx === -1) throw new NotFoundException(`Job ${id} not found`)
    this.jobs[idx] = { ...this.jobs[idx]!, publishStatus: 'unpublished', updatedAt: nowIso() }
    return toPartnerJobDto(this.jobs[idx]!)
  }

  getPartnerFairs(sourceOrgId?: string): PartnerFairDto[] {
    const data = sourceOrgId
      ? this.fairs.filter((f) => f.sourceOrgId === sourceOrgId)
      : [...this.fairs]
    return data.reverse().map(toPartnerFairDto)
  }

  importFairs(dto: ImportFairsDto): ImportResult<PartnerFairDto> {
    const now  = nowIso()
    const sync = new Date().toISOString().replace('T', ' ').slice(0, 16)
    const added: FairRecord[] = dto.items.map((item) => {
      const start = new Date(item.startTime)
      const end   = new Date(item.endTime)
      const now2  = new Date()
      const status: FairStatus =
        now2 < start ? 'upcoming' : now2 > end ? 'ended' : 'ongoing'
      return {
        id: genId(), name: item.name, organizer: item.organizer,
        startTime: item.startTime, endTime: item.endTime, venue: item.venue, status,
        description: item.description, boothCount: item.boothCount,
        sourceOrgId: dto.sourceOrgId, externalId: item.externalId,
        sourceName: dto.sourceName, sourceUrl: item.sourceUrl,
        syncTime: sync,
        reviewStatus: 'pending',  // Partner 导入默认 pending
        publishStatus: 'draft',   // Partner 导入默认 draft
        createdAt: now, updatedAt: now,
      }
    })
    this.fairs.push(...added)
    return { imported: added.length, items: added.map(toPartnerFairDto) }
  }

  unpublishPartnerFair(id: string, sourceOrgId?: string): PartnerFairDto {
    const idx = this.fairs.findIndex(
      (f) => f.id === id && (!sourceOrgId || f.sourceOrgId === sourceOrgId),
    )
    if (idx === -1) throw new NotFoundException(`Fair ${id} not found`)
    this.fairs[idx] = { ...this.fairs[idx]!, publishStatus: 'unpublished', updatedAt: nowIso() }
    return toPartnerFairDto(this.fairs[idx]!)
  }
}
