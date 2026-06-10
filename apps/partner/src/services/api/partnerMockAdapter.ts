import type {
  PartnerDataSource,
  CreateDataSourcePayload,
  PartnerJobRecord,
  PartnerFairRecord,
  PartnerSyncLog,
  ImportJobItem,
  ImportFairItem,
  ImportResult,
  UpdatePartnerJobInput,
  UpdatePartnerFairInput,
  ExcelPreviewResult,
  ExcelConfirmResult,
  FieldMappingRuleResult,
} from './types'

function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 120))
}

// ─── T1: 字段映射规则（mock 持久化，镜像后端「confirm 落地」语义）──────────────
// SAVED_MAPPINGS: 已确认导入后保存的规则，键为 `${sourceId}:${dataType}`。
// PENDING_BATCH_MAPPINGS: preview 时按 batchId 暂存映射，confirm 时再落入 SAVED_MAPPINGS，
// 与真实后端「映射随 ImportBatch，确认导入时才保存为复用规则」一致。
const SAVED_MAPPINGS = new Map<string, { mapping: Record<string, string>; updatedAt: string }>()
const PENDING_BATCH_MAPPINGS = new Map<string, { sourceId: string; dataType: 'job' | 'fair'; mapping: Record<string, string> }>()

// ─── Data Sources ─────────────────────────────────────────────────────────────

let DATA_SOURCES: PartnerDataSource[] = [
  { id: 'ds1', name: '市人才网 API',       sourceKind: 'aggregator', accessMode: 'api',     syncFreq: 'hourly',  lastSyncTime: '2026-05-25 09:00', connStatus: 'connected', successCount: 158, failCount: 3,  description: 'RESTful API，每小时自动拉取岗位和招聘会数据' },
  { id: 'ds2', name: '高校就业信息 Excel', sourceKind: 'school',     accessMode: 'excel',   syncFreq: 'manual',  lastSyncTime: '2026-05-24 18:00', connStatus: 'connected', successCount: 42,  failCount: 8,  description: '手动上传 Excel 模板，自动解析岗位字段' },
  { id: 'ds3', name: '市人社局 Webhook',   sourceKind: 'aggregator', accessMode: 'webhook', syncFreq: 'manual',  lastSyncTime: '2026-05-24 12:00', connStatus: 'connected', successCount: 26,  failCount: 0,  description: '接收市人社局推送的招聘会通知数据' },
  { id: 'ds4', name: '第三方招聘平台 API', sourceKind: 'job_platform', accessMode: 'api',   syncFreq: 'daily',   lastSyncTime: '2026-05-24 06:00', connStatus: 'error',     successCount: 91,  failCount: 12, description: 'API Token 已过期，请重新配置连接参数' },
  { id: 'ds5', name: '校园兼职平台导入',   sourceKind: 'school',     accessMode: 'excel',   syncFreq: 'weekly',  lastSyncTime: '2026-05-20 10:00', connStatus: 'disabled',  successCount: 15,  failCount: 2,  description: '已停用，如需恢复请联系管理员' },
]

// ─── Jobs (R2: added sourceName) ──────────────────────────────────────────────

let PARTNER_JOBS: PartnerJobRecord[] = [
  { id: 'pj1', externalId: 'UNI-2026-JOB-0041', title: '软件开发实习生',   company: '某科技有限公司', city: '上海', category: 'intern',   sourceUrl: 'https://job.uni.edu.cn/j/41', syncTime: '2026-05-25 08:00', reviewStatus: 'approved',  publishStatus: 'published',   sourceOrgId: 'org-uni-001', sourceName: '高校就业信息网' },
  { id: 'pj2', externalId: 'UNI-2026-JOB-0042', title: '产品运营校招生',   company: '某电商平台',     city: '杭州', category: 'campus',   sourceUrl: 'https://job.uni.edu.cn/j/42', syncTime: '2026-05-25 08:00', reviewStatus: 'approved',  publishStatus: 'published',   sourceOrgId: 'org-uni-001', sourceName: '高校就业信息网' },
  { id: 'pj3', externalId: 'UNI-2026-JOB-0043', title: '前端开发工程师',   company: '某互联网公司',   city: '北京', category: 'fulltime', sourceUrl: 'https://job.uni.edu.cn/j/43', syncTime: '2026-05-25 08:00', reviewStatus: 'approved',  publishStatus: 'published',   sourceOrgId: 'org-uni-001', sourceName: '高校就业信息网' },
  { id: 'pj4', externalId: 'UNI-2026-JOB-0044', title: '数据分析实习',     company: '某金融科技公司', city: '深圳', category: 'intern',   sourceUrl: 'https://job.uni.edu.cn/j/44', syncTime: '2026-05-25 09:00', reviewStatus: 'pending',   publishStatus: 'draft',       sourceOrgId: 'org-uni-001', sourceName: '高校就业信息网' },
  { id: 'pj5', externalId: 'UNI-2026-JOB-0045', title: 'Java 后端开发',    company: '某软件公司',     city: '苏州', category: 'fulltime', sourceUrl: 'https://job.uni.edu.cn/j/45', syncTime: '2026-05-25 09:00', reviewStatus: 'reviewing', publishStatus: 'draft',       sourceOrgId: 'org-uni-001', sourceName: '高校就业信息网' },
  { id: 'pj6', externalId: 'UNI-2026-JOB-0038', title: '运营管理培训生',   company: '某零售集团',     city: '广州', category: 'campus',   sourceUrl: 'https://job.uni.edu.cn/j/38', syncTime: '2026-05-24 18:00', reviewStatus: 'approved',  publishStatus: 'published',   sourceOrgId: 'org-uni-001', sourceName: '高校就业信息网' },
  { id: 'pj7', externalId: 'UNI-2026-JOB-0037', title: '人力资源专员',     company: '某国有企业',     city: '本市', category: 'fulltime', sourceUrl: 'https://job.uni.edu.cn/j/37', syncTime: '2026-05-24 18:00', reviewStatus: 'approved',  publishStatus: 'unpublished', sourceOrgId: 'org-uni-001', sourceName: '高校就业信息网' },
  { id: 'pj8', externalId: 'UNI-2026-JOB-0036', title: '市场推广兼职',     company: '某营销公司',     city: '本市', category: 'parttime', sourceUrl: 'https://job.uni.edu.cn/j/36', syncTime: '2026-05-24 18:00', reviewStatus: 'rejected',  publishStatus: 'draft',       sourceOrgId: 'org-uni-001', sourceName: '高校就业信息网' },
]

// ─── Fairs (R2: added sourceName) ─────────────────────────────────────────────

let PARTNER_FAIRS: PartnerFairRecord[] = [
  { id: 'pf1', externalId: 'UNI-2026-FAIR-023', name: '高校双选会（春）',         organizer: '某大学就业指导中心', startTime: '2026-05-28 10:00', endTime: '2026-05-28 16:00', venue: '某大学体育馆',       status: 'upcoming', sourceUrl: 'https://job.uni.edu.cn/fair/23', syncTime: '2026-05-23 09:00', reviewStatus: 'approved',  publishStatus: 'published',   sourceOrgId: 'org-uni-001', sourceName: '高校就业信息网' },
  { id: 'pf2', externalId: 'UNI-2026-FAIR-024', name: '互联网行业专场招聘',       organizer: '某大学就业指导中心', startTime: '2026-06-10 14:00', endTime: '2026-06-10 17:00', venue: '某大学图书馆报告厅', status: 'upcoming', sourceUrl: 'https://job.uni.edu.cn/fair/24', syncTime: '2026-05-25 09:00', reviewStatus: 'reviewing', publishStatus: 'draft',       sourceOrgId: 'org-uni-001', sourceName: '高校就业信息网' },
  { id: 'pf3', externalId: 'UNI-2026-FAIR-020', name: '制造业专场招聘会',         organizer: '市人才交流中心',     startTime: '2026-05-25 09:00', endTime: '2026-05-25 15:00', venue: 'B区大厅',            status: 'ongoing',  sourceUrl: 'https://job.uni.edu.cn/fair/20', syncTime: '2026-05-22 14:00', reviewStatus: 'approved',  publishStatus: 'published',   sourceOrgId: 'org-uni-001', sourceName: '高校就业信息网' },
  { id: 'pf4', externalId: 'UNI-2026-FAIR-018', name: '护理医疗专场招聘',         organizer: '某大学就业指导中心', startTime: '2026-05-20 09:00', endTime: '2026-05-20 15:00', venue: 'C区多功能厅',        status: 'ended',    sourceUrl: 'https://job.uni.edu.cn/fair/18', syncTime: '2026-05-18 10:00', reviewStatus: 'approved',  publishStatus: 'unpublished', sourceOrgId: 'org-uni-001', sourceName: '高校就业信息网' },
  { id: 'pf5', externalId: 'UNI-2026-FAIR-015', name: '2026 春季大型综合招聘会', organizer: '某大学就业指导中心', startTime: '2026-04-15 09:00', endTime: '2026-04-15 17:00', venue: '某大学操场',         status: 'ended',    sourceUrl: 'https://job.uni.edu.cn/fair/15', syncTime: '2026-04-10 10:00', reviewStatus: 'approved',  publishStatus: 'expired',     sourceOrgId: 'org-uni-001', sourceName: '高校就业信息网' },
]

// ─── Sync Logs (R3: field names aligned with backend) ─────────────────────────

const SYNC_LOGS: PartnerSyncLog[] = [
  { id: 'sl1',  no: 'SYNC-20260525-0018', source: '市人才网 API',       dataType: 'job',  addedCount: 12, updatedCount: 0, errorCount: 0, dupCount: 3, errorFields: null,           errorDetail: null,                                       syncTime: '2026-05-25 09:00', status: 'success' },
  { id: 'sl2',  no: 'SYNC-20260525-0017', source: '市人才网 API',       dataType: 'fair', addedCount: 2,  updatedCount: 0, errorCount: 0, dupCount: 0, errorFields: null,           errorDetail: null,                                       syncTime: '2026-05-25 09:00', status: 'success' },
  { id: 'sl3',  no: 'SYNC-20260525-0016', source: '市人才网 API',       dataType: 'job',  addedCount: 11, updatedCount: 1, errorCount: 0, dupCount: 4, errorFields: null,           errorDetail: null,                                       syncTime: '2026-05-25 08:00', status: 'success' },
  { id: 'sl4',  no: 'SYNC-20260524-0041', source: '高校就业信息 Excel', dataType: 'job',  addedCount: 8,  updatedCount: 0, errorCount: 3, dupCount: 1, errorFields: 'salary, city', errorDetail: '字段格式不符：salary 非数字范围，city 为空', syncTime: '2026-05-24 18:00', status: 'partial' },
  { id: 'sl5',  no: 'SYNC-20260524-0038', source: '市人社局 Webhook',   dataType: 'fair', addedCount: 1,  updatedCount: 0, errorCount: 0, dupCount: 0, errorFields: null,           errorDetail: null,                                       syncTime: '2026-05-24 12:00', status: 'success' },
  { id: 'sl6',  no: 'SYNC-20260524-0030', source: '市人才网 API',       dataType: 'job',  addedCount: 10, updatedCount: 2, errorCount: 0, dupCount: 6, errorFields: null,           errorDetail: null,                                       syncTime: '2026-05-24 08:00', status: 'success' },
  { id: 'sl7',  no: 'SYNC-20260523-0029', source: '第三方招聘平台 API', dataType: 'job',  addedCount: 0,  updatedCount: 0, errorCount: 8, dupCount: 0, errorFields: null,           errorDetail: 'API Token 已过期（401 Unauthorized）',      syncTime: '2026-05-23 06:00', status: 'failed'  },
  { id: 'sl8',  no: 'SYNC-20260523-0021', source: '高校就业信息 Excel', dataType: 'job',  addedCount: 15, updatedCount: 0, errorCount: 2, dupCount: 3, errorFields: 'sourceUrl',    errorDetail: '来源链接为空，跳过 2 条',                   syncTime: '2026-05-23 16:00', status: 'partial' },
  { id: 'sl9',  no: 'SYNC-20260522-0018', source: '市人才网 API',       dataType: 'fair', addedCount: 3,  updatedCount: 1, errorCount: 0, dupCount: 1, errorFields: null,           errorDetail: null,                                       syncTime: '2026-05-22 09:00', status: 'success' },
  { id: 'sl10', no: 'SYNC-20260520-0009', source: '校园兼职平台导入',   dataType: 'job',  addedCount: 5,  updatedCount: 0, errorCount: 2, dupCount: 0, errorFields: 'externalId',   errorDetail: '外部编号重复，无法写入',                    syncTime: '2026-05-20 10:00', status: 'partial' },
]

// ─── Adapter ──────────────────────────────────────────────────────────────────

function genId(): string { return `mock-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }

export const partnerMockAdapter = {
  // Data Sources
  async getDataSources(): Promise<PartnerDataSource[]> {
    await delay()
    return [...DATA_SOURCES]
  },
  async toggleDataSource(id: string): Promise<PartnerDataSource> {
    await delay()
    DATA_SOURCES = DATA_SOURCES.map((s) =>
      s.id === id
        ? { ...s, connStatus: s.connStatus === 'disabled' ? 'connected' : 'disabled' }
        : s
    )
    return DATA_SOURCES.find((s) => s.id === id)!
  },
  async createDataSource(payload: CreateDataSourcePayload): Promise<PartnerDataSource> {
    await delay()
    const accessMode = payload.accessMode ?? 'excel'
    const id = `ds${Date.now()}`
    const newSource: PartnerDataSource = {
      id,
      name: payload.name,
      sourceKind: payload.sourceKind ?? 'manual',
      accessMode,
      syncFreq: payload.syncFreq ?? 'manual',
      lastSyncTime: '刚刚', connStatus: 'connected', successCount: 0, failCount: 0,
      description: payload.description ?? (accessMode === 'webhook' ? '等待外部系统推送岗位数据' : accessMode === 'api' ? '等待 API 连接测试' : '新建 Excel 数据源，导入批次待管理员审核'),
      credentialConfigured: Boolean(payload.credential) || accessMode === 'webhook',
      endpoint: payload.endpoint,
      webhookUrl: accessMode === 'webhook' ? `/api/v1/sync/webhook?source=${id}` : undefined,
      webhookSecretOnce: accessMode === 'webhook' ? 'mock_webhook_secret_only_once' : undefined,
    }
    DATA_SOURCES = [...DATA_SOURCES, newSource]
    return newSource
  },

  // Jobs
  async getPartnerJobs(): Promise<PartnerJobRecord[]> {
    await delay()
    return [...PARTNER_JOBS]
  },
  async unpublishPartnerJob(id: string): Promise<PartnerJobRecord> {
    await delay()
    PARTNER_JOBS = PARTNER_JOBS.map((j) =>
      j.id === id ? { ...j, publishStatus: 'unpublished' } : j
    )
    return PARTNER_JOBS.find((j) => j.id === id)!
  },
  async importPartnerJobs(items: ImportJobItem[]): Promise<ImportResult<PartnerJobRecord>> {
    await delay()
    const sync = new Date().toISOString().replace('T', ' ').slice(0, 16)
    const added: PartnerJobRecord[] = items.map((item) => ({
      id: genId(), externalId: item.externalId, title: item.title,
      company: item.company, city: item.city,
      sourceUrl: item.sourceUrl, syncTime: sync,
      salary: item.salary, tags: item.tags,
      description: item.description, requirements: item.requirements,
      reviewStatus: 'pending' as const, publishStatus: 'draft' as const,
      sourceOrgId: 'mock-org', sourceName: '测试机构',
    }))
    PARTNER_JOBS = [...PARTNER_JOBS, ...added]
    return { imported: added.length, items: added }
  },
  // 阶段1C:编辑本机构岗位(mock 同步后端状态机:编辑后回 pending+draft 重审)
  async updatePartnerJob(id: string, input: UpdatePartnerJobInput): Promise<PartnerJobRecord> {
    await delay()
    const sync = new Date().toISOString().replace('T', ' ').slice(0, 16)
    PARTNER_JOBS = PARTNER_JOBS.map((j) =>
      j.id === id
        ? {
            ...j,
            ...Object.fromEntries(Object.entries(input).filter(([k, v]) => v !== undefined && k !== 'workType')),
            reviewStatus: 'pending' as const,
            publishStatus: 'draft' as const,
            syncTime: sync,
          }
        : j,
    )
    const hit = PARTNER_JOBS.find((j) => j.id === id)
    if (!hit) throw new Error('JOB_NOT_FOUND')
    return hit
  },

  // Fairs
  async getPartnerFairs(): Promise<PartnerFairRecord[]> {
    await delay()
    return [...PARTNER_FAIRS]
  },
  async unpublishPartnerFair(id: string): Promise<PartnerFairRecord> {
    await delay()
    PARTNER_FAIRS = PARTNER_FAIRS.map((f) =>
      f.id === id ? { ...f, publishStatus: 'unpublished' } : f
    )
    return PARTNER_FAIRS.find((f) => f.id === id)!
  },
  async importPartnerFairs(items: ImportFairItem[]): Promise<ImportResult<PartnerFairRecord>> {
    await delay()
    const sync = new Date().toISOString().replace('T', ' ').slice(0, 16)
    const added: PartnerFairRecord[] = items.map((item) => {
      const start = new Date(item.startAt)
      const end   = new Date(item.endAt)
      const now   = new Date()
      const status = now < start ? 'upcoming' as const : now > end ? 'ended' as const : 'ongoing' as const
      return {
        id: genId(), externalId: item.externalId, name: item.title,
        organizer: '测试机构', startTime: item.startAt, endTime: item.endAt,
        venue: item.venue, status, sourceUrl: item.sourceUrl, syncTime: sync,
        theme: item.theme, city: item.city, address: item.address, description: item.description,
        reviewStatus: 'pending' as const, publishStatus: 'draft' as const,
        sourceOrgId: 'mock-org', sourceName: '测试机构',
      }
    })
    PARTNER_FAIRS = [...PARTNER_FAIRS, ...added]
    return { imported: added.length, items: added }
  },
  // 阶段1C:编辑本机构招聘会(mock 同步后端状态机)
  async updatePartnerFair(id: string, input: UpdatePartnerFairInput): Promise<PartnerFairRecord> {
    await delay()
    const sync = new Date().toISOString().replace('T', ' ').slice(0, 16)
    PARTNER_FAIRS = PARTNER_FAIRS.map((f) => {
      if (f.id !== id) return f
      const next = { ...f }
      if (input.title !== undefined) next.name = input.title
      if (input.theme !== undefined) next.theme = input.theme
      if (input.startAt !== undefined) next.startTime = input.startAt
      if (input.endAt !== undefined) next.endTime = input.endAt
      if (input.venue !== undefined) next.venue = input.venue
      if (input.city !== undefined) next.city = input.city
      if (input.address !== undefined) next.address = input.address
      if (input.description !== undefined) next.description = input.description
      if (input.sourceUrl !== undefined) next.sourceUrl = input.sourceUrl
      next.reviewStatus = 'pending'
      next.publishStatus = 'draft'
      next.syncTime = sync
      return next
    })
    const hit = PARTNER_FAIRS.find((f) => f.id === id)
    if (!hit) throw new Error('FAIR_NOT_FOUND')
    return hit
  },

  // Sync Logs (read-only)
  async getSyncLogs(): Promise<PartnerSyncLog[]> {
    await delay()
    return [...SYNC_LOGS]
  },

  // Excel Import (mock)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async parseExcel(_file: File): Promise<{ columns: string[]; sampleRows: Record<string, string>[] }> {
    await delay()
    return {
      columns: ['外部ID', '职位名称', '公司名称', '工作城市', '薪资范围', '来源链接', '职位描述'],
      sampleRows: [
        { '外部ID': 'EX-001', '职位名称': '前端工程师', '公司名称': 'ABC科技', '工作城市': '广州', '薪资范围': '15k-20k', '来源链接': 'https://example.com/j/1', '职位描述': '负责前端开发' },
        { '外部ID': 'EX-002', '职位名称': '后端工程师', '公司名称': 'DEF网络', '工作城市': '深圳', '薪资范围': '20k-30k', '来源链接': 'https://example.com/j/2', '职位描述': '负责后端开发' },
      ],
    }
  },
  async previewExcel(file: File, sourceId: string, dataType: 'job' | 'fair', fieldMapping: Record<string, string>): Promise<ExcelPreviewResult> {
    void file
    await delay()
    const batchId = `batch-${sourceId}-${Date.now()}`
    // 暂存本批次映射，confirm 成功后再落入可复用规则（镜像后端语义）
    PENDING_BATCH_MAPPINGS.set(batchId, { sourceId, dataType, mapping: { ...fieldMapping } })
    return {
      batchId,
      totalRows: 10,
      validRows: 7,
      invalidRows: 2,
      dupRows: 1,
      sampleValid: [
        { rowIndex: 1, status: 'ok', data: { externalId: 'EX-001', title: '前端工程师', company: 'ABC科技', city: '广州', sourceUrl: 'https://example.com/j/1' }, errors: [] },
        { rowIndex: 2, status: 'ok', data: { externalId: 'EX-002', title: '后端工程师', company: 'DEF网络', city: '深圳', sourceUrl: 'https://example.com/j/2' }, errors: [] },
      ],
      sampleInvalid: [
        { rowIndex: 5, status: 'invalid', data: { externalId: 'EX-005', title: '', company: 'GHI公司', city: '', sourceUrl: '' }, errors: ['title 不能为空', 'city 不能为空', 'sourceUrl 不能为空'] },
      ],
      sampleDup: [
        { rowIndex: 8, status: 'dup', data: { externalId: 'EX-001', title: '前端工程师', company: 'ABC科技', city: '广州', sourceUrl: 'https://example.com/j/1' }, errors: [], externalId: 'EX-001' },
      ],
    }
  },
  async confirmExcelImport(batchId: string): Promise<ExcelConfirmResult> {
    await delay()
    // 确认成功 → 把本批次映射保存为该数据源的可复用规则
    const pending = PENDING_BATCH_MAPPINGS.get(batchId)
    if (pending && Object.keys(pending.mapping).length > 0) {
      SAVED_MAPPINGS.set(`${pending.sourceId}:${pending.dataType}`, {
        mapping: pending.mapping,
        updatedAt: new Date().toISOString(),
      })
      PENDING_BATCH_MAPPINGS.delete(batchId)
    }
    return { imported: 7, syncLogId: `sl-mock-${Date.now()}` }
  },
  async cancelExcelImport(batchId: string): Promise<{ success: boolean }> {
    PENDING_BATCH_MAPPINGS.delete(batchId)
    await delay()
    return { success: true }
  },
  async getMappingRule(sourceId: string, dataType: 'job' | 'fair'): Promise<FieldMappingRuleResult> {
    await delay()
    const saved = SAVED_MAPPINGS.get(`${sourceId}:${dataType}`)
    return {
      sourceId,
      dataType,
      mapping: saved ? { ...saved.mapping } : {},
      updatedAt: saved ? saved.updatedAt : null,
    }
  },
}
