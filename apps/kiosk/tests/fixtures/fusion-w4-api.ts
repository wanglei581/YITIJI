import type { ApiRouter } from './api-router'

interface WireFairPosition {
  id: string
  title: string
  headcount?: number
  salary?: string | null
  requirements?: string | null
  education?: string | null
  experience?: string | null
  location?: string | null
  positionType?: string | null
  department?: string | null
}

interface WireFairCompany {
  id: string
  jobFairId: string
  name: string
  logoUrl?: string | null
  industry?: string | null
  scale?: string | null
  description?: string | null
  sourceUrl?: string | null
  hiringTags?: string[]
  jobsCount?: number
  coverImageUrl?: string | null
  founded?: string | null
  headquarters?: string | null
  registeredCapital?: string | null
  honorTags?: string[]
  zoneId?: string | null
  boothNumber?: string | null
  positions?: WireFairPosition[]
}

interface WireFairZone {
  id: string
  jobFairId: string
  name: string
  category?: string | null
  city?: string | null
  description?: string | null
  coverImageUrl?: string | null
  sortOrder?: number
}

export function registerW4Api(api: ApiRouter, options: { smartCampusEnabled?: boolean } = {}): void {
  const job = {
    id: 'job-001', title: '前端工程师', company: '青岛示例制造有限公司', city: '青岛市',
    salary: '8000-12000', salaryDisplay: '8,000–12,000 元/月', category: 'fulltime', tags: ['React', 'TypeScript'],
    description: '负责来源岗位信息系统前端开发。', requirements: '熟悉 TypeScript。',
    sourceOrgId: 'source-001', externalId: 'ext-job-001', sourceName: '青岛公共就业服务网',
    sourceUrl: 'https://jobs.example.gov.cn/jobs/job-001', syncTime: '2026-07-24T08:00:00.000Z',
    reviewStatus: 'approved', publishStatus: 'published', dataSourceNote: '信息来自官方来源平台，以来源平台为准。',
  }
  const fair = {
    id: 'fair-001', name: '2026 青岛高校毕业生招聘会', organizer: '青岛市公共就业服务中心',
    startTime: '2026-08-01T01:00:00.000Z', endTime: '2026-08-01T08:00:00.000Z', venue: '青岛国际会展中心',
    status: 'upcoming', theme: 'campus', city: '青岛市', address: '崂山区苗岭路9号', boothCount: 1, jobCount: 2,
    sourceOrgId: 'source-001', externalId: 'ext-fair-001', sourceName: '青岛公共就业服务网',
    sourceUrl: 'https://jobs.example.gov.cn/fairs/fair-001', checkinUrl: 'https://jobs.example.gov.cn/fairs/fair-001/checkin',
    syncTime: '2026-07-24T08:00:00.000Z', reviewStatus: 'approved', publishStatus: 'published',
    hasManagedData: true, managedCompanyCount: 1, managedMaterialCount: 0,
    dataSourceNote: '活动信息来自主办方，以来源平台和现场公告为准。',
  }
  const fairCompany = {
    id: 'fair-company-001', jobFairId: 'fair-001', name: '青岛示例制造有限公司', industry: '智能制造',
    scale: 'medium', description: '示例参展企业。', sourceUrl: 'https://jobs.example.gov.cn/companies/company-001',
    jobsCount: 1, zoneId: 'zone-001', boothNumber: 'A01',
    positions: [{ id: 'position-001', title: '前端工程师', headcount: 2, positionType: 'full_time' }],
  } satisfies WireFairCompany
  const fairZone = {
    id: 'zone-001', jobFairId: 'fair-001', name: '智能制造专区', category: '智能制造', city: '青岛市', sortOrder: 1,
  } satisfies WireFairZone
  const agency = {
    id: 'agency-001', name: '青岛合规人力服务机构', type: '人力资源服务机构', status: 'open', statusLabel: '营业中',
    address: '市南区示例路1号', district: '市南区', distanceKm: 1.2, hours: '09:00–17:00',
    services: ['岗位咨询', '用工咨询'], orgCode: 'QD-HR-001', jobCount: 2, syncTime: '2026-07-24T08:00:00.000Z',
  }
  const company = {
    id: 'company-001', name: '青岛示例制造有限公司', logoUrl: null, companyType: 'private', industry: 'manufacturing',
    sourceName: '青岛公共就业服务网', province: '山东省', city: '青岛市', district: '崂山区', description: '专注智能制造。',
    repJobTitles: ['前端工程师'], openJobCount: 1, fairParticipant: true, tags: ['高新技术企业'],
  }
  const companyDetail = {
    ...company, legalName: '青岛示例制造有限公司', coverImageUrl: null, promoVideoUrl: null, honorTags: ['高新技术企业'],
    address: '崂山区示例路2号', metrics: { openJobCount: 1, city: '青岛市' },
    sourceUrl: 'https://jobs.example.gov.cn/companies/company-001', externalId: 'ext-company-001',
    syncTime: '2026-07-24T08:00:00.000Z', dataSourceNote: '企业与岗位信息由来源机构提供。',
  }

  const respond = (path: string, data: unknown) => api.respond('GET', path, { status: 200, json: data })
  respond('/api/v1/jobs', { success: true, data: [job], pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 } })
  respond('/api/v1/jobs/job-001', { success: true, data: job })
  respond('/api/v1/kiosk/offline-agencies', { success: true, data: { items: [agency], total: 1, page: 1, pageSize: 10, stats: { totalAgencies: 1, openAgencies: 1, totalJobs: 2, districts: 1, lastSyncLabel: '今日' } } })
  respond('/api/v1/companies', { success: true, data: { items: [company], nextCursor: null, total: 1 } })
  respond('/api/v1/companies/stats', { success: true, data: { companyCount: 1, openJobCount: 1, todayNewJobCount: 1, fairCompanyCount: 1 } })
  respond('/api/v1/companies/company-001', { success: true, data: companyDetail })
  respond('/api/v1/companies/company-001/jobs', { success: true, data: { items: [{ id: 'job-001', title: '前端工程师', city: '青岛市', salaryDisplay: '8,000–12,000 元/月', category: 'fulltime', tags: ['React'], sourceName: '青岛公共就业服务网', sourceUrl: job.sourceUrl, externalId: 'ext-job-001' }], nextCursor: null, total: 1 } })
  respond('/api/v1/job-fairs', { success: true, data: [fair], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } })
  respond('/api/v1/job-fairs/fair-001', { success: true, data: fair })
  respond('/api/v1/job-fairs/fair-001/companies', { success: true, data: [fairCompany], pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } })
  respond('/api/v1/job-fairs/fair-001/zones', { success: true, data: [fairZone] })
  respond('/api/v1/job-fairs/fair-001/stats', { success: true, data: { fairId: 'fair-001', fairName: fair.name, totalCompanies: 1, checkedInCompanies: 0, totalPositions: 1, totalHeadcount: 2, browseCount: 0, scanCount: 0, printCount: 0, checkinCount: 0, zoneBreakdown: [], lastUpdated: '2026-07-24T08:00:00.000Z', seekerIntent: [], industryDistribution: [], dataSourceLabel: '来源数据 · 非实时', isMockData: true } })
  respond('/api/v1/terminals/KSK-001/config', { smartCampus: { enabled: options.smartCampusEnabled ?? true, modules: { welcome: true, bigdata: false, luggage: true, panorama: true }, items: [] }, toolbox: { enabled: false, items: [] }, configVersion: 'w4-fixture', refreshIntervalMs: 300000, serverTime: '2026-07-24T08:00:00.000Z' })
  respond('/api/v1/terminals/KSK-001/screensaver', { enabled: false, idleTimeoutSec: 180, items: [] })
  respond('/api/v1/terminals/KSK-001/printer-status', { printerStatus: 'ready', paperLevel: 'sufficient', isOnline: true })
  respond('/api/v1/policies', { success: true, data: [{ id: 'policy-001', kind: 'policy_guide', title: '高校毕业生就业服务指引', summary: '请通过官方入口查看办理条件。', audience: 'graduate', sourceName: '青岛市人力资源和社会保障局', syncTime: '2026-07-24T08:00:00.000Z', externalUrl: 'https://hrss.example.gov.cn/policy/001' }] })
}
