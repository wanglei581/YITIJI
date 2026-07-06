import type {
  AdminJobSourceRecord,
  AdminFairSourceRecord,
  AdminImportBatch,
  AdminPrinterRecord,
  AdminPrintersResponse,
  AdminTerminalRecord,
  AdminTerminalsResponse,
  AdminOrganizationOption,
  AdminOrgOptionsResponse,
  AssignTerminalOrgResult,
  UpdateTerminalProfileInput,
  UpdateTerminalProfileResult,
  TerminalBindCodeCreated,
  AuditLogListResponse,
  AuditLogListQuery,
  AuditLogRecord,
} from './types'
import { ApiHttpError } from './client'
import type { ReviewAction } from './review-types'
import type { PublishAction } from './review-types'

export type { ReviewAction, PublishAction }

// ─── 终端机构归属 mock 状态（页面刷新重置；不写数据库）─────────────────────────

const MOCK_ORG_OPTIONS: AdminOrganizationOption[] = [
  { id: 'org-uni-001', name: '某大学就业指导中心', type: 'school_employment_center' },
  { id: 'org-hr-002',  name: '市人才交流中心',     type: 'public_employment_service' },
]
// terminalCode → orgId（内存归属，演示用）
const MOCK_TERMINAL_ORG: Record<string, string | null> = {
  'KSK-001': 'org-uni-001',
}

const MOCK_TERMINAL_PROFILE: Record<string, UpdateTerminalProfileResult> = {
  'KSK-001': {
    terminalId: 'KSK-001',
    terminalCode: 'KSK-001',
    displayName: '一号楼大厅终端',
    macAddress: 'A8:5E:45:10:00:01',
    locationLabel: '市南校区 一号楼大厅',
    enabled: true,
  },
  'KSK-002': {
    terminalId: 'KSK-002',
    terminalCode: 'KSK-002',
    displayName: '就业中心终端',
    macAddress: 'A8:5E:45:10:00:02',
    locationLabel: '就业指导中心服务区',
    enabled: true,
  },
}
function mockOrgFields(terminalCode: string): { orgId: string | null; orgName: string | null } {
  const orgId = MOCK_TERMINAL_ORG[terminalCode] ?? null
  const orgName = orgId ? (MOCK_ORG_OPTIONS.find((o) => o.id === orgId)?.name ?? null) : null
  return { orgId, orgName }
}

// ─── Mutable module-level state (survives re-renders, reset on page reload) ───

let JOB_SOURCES: AdminJobSourceRecord[] = [
  { id: 'js1',  sourceOrgId: 'org-zhilian-001',    sourceName: '智联招聘',       externalId: 'ZL-2026-884521',    sourceUrl: 'https://jobs.zhaopin.com/j/884521',    title: '前端开发工程师', company: '上海某科技有限公司', city: '上海', salary: '15-25K', tags: ['全职', '前端', 'React'],        industry: '互联网/软件', description: '负责公司 Web 前端开发，需熟悉 React、TypeScript。',      requirements: '本科及以上，2 年前端经验。',     syncTime: '2026-05-25 08:00', reviewStatus: 'approved',  publishStatus: 'published'   },
  { id: 'js2',  sourceOrgId: 'org-51job-001',       sourceName: '前程无忧',       externalId: '51J-20260525-0021', sourceUrl: 'https://www.51job.com/j/20260525-0021', title: 'Java 后端开发',  company: '北京某互联网公司',   city: '北京', salary: '20-30K', tags: ['全职', '后端', 'Java'],         industry: '互联网/软件', description: '负责后台服务开发，Spring Boot + MySQL。',                requirements: '本科及以上，3 年 Java 经验。',   syncTime: '2026-05-25 08:00', reviewStatus: 'approved',  publishStatus: 'published'   },
  { id: 'js3',  sourceOrgId: 'org-city-talent-001', sourceName: '市人才网',       externalId: 'RC-2026-330099',    sourceUrl: 'https://rcw.city.gov.cn/j/330099',     title: '行政专员',       company: '某政府机关单位',     city: '本市', salary: '5-8K',  tags: ['全职', '行政'],                industry: '政府/机关',   description: '负责日常行政事务管理。',                                  requirements: '大专及以上，有行政工作经验。',   syncTime: '2026-05-25 07:30', reviewStatus: 'approved',  publishStatus: 'draft'       },
  { id: 'js4',  sourceOrgId: 'org-boss-001',        sourceName: 'Boss直聘',       externalId: 'BP-M9234712',       sourceUrl: 'https://www.zhipin.com/j/M9234712',    title: 'UI 设计师',      company: '深圳某设计公司',     city: '深圳', salary: '12-20K', tags: ['全职', '设计', 'Figma'],       industry: '设计/创意',   description: '负责产品界面设计，需扎实视觉设计能力。',                  requirements: '本科及以上，3 年 UI 设计经验。', syncTime: '2026-05-25 09:00', reviewStatus: 'pending',   publishStatus: 'draft'       },
  { id: 'js5',  sourceOrgId: 'org-zhilian-001',    sourceName: '智联招聘',       externalId: 'ZL-2026-892204',    sourceUrl: 'https://jobs.zhaopin.com/j/892204',    title: '数据分析师',     company: '杭州某电商平台',     city: '杭州', salary: '18-28K', tags: ['全职', '数据', 'Python'],      industry: '电子商务',    description: '负责业务数据分析，建立分析模型。',                        requirements: '本科及以上，2 年数据分析经验。', syncTime: '2026-05-25 09:00', reviewStatus: 'reviewing', publishStatus: 'draft'       },
  { id: 'js6',  sourceOrgId: 'org-city-talent-001', sourceName: '市人才网',       externalId: 'RC-2026-330106',    sourceUrl: 'https://rcw.city.gov.cn/j/330106',     title: '护士',           company: '某三甲医院',         city: '本市', salary: '6-10K', tags: ['全职', '医疗', '护理'],        industry: '医疗/卫生',   description: '临床护理工作，参与病房护理。',                            requirements: '护理专业大专及以上，具备护士执业资格证。',               syncTime: '2026-05-25 07:30', reviewStatus: 'approved',  publishStatus: 'published'   },
  { id: 'js7',  sourceOrgId: 'org-51job-001',       sourceName: '前程无忧',       externalId: '51J-20260524-0099', sourceUrl: 'https://www.51job.com/j/20260524-0099', title: '机械工程师',     company: '苏州某制造企业',     city: '苏州', salary: '10-18K', tags: ['全职', '机械', '制造'],        industry: '制造业',      description: '负责机械零部件设计和工艺改进。',                          requirements: '机械工程相关专业本科，2 年以上经验。',                   syncTime: '2026-05-24 18:00', reviewStatus: 'approved',  publishStatus: 'unpublished' },
  { id: 'js8',  sourceOrgId: 'org-uni-001',         sourceName: '高校就业信息网', externalId: 'GX-2026-CG-0042',  sourceUrl: 'https://job.uni.edu.cn/j/42',          title: '应届生储备干部', company: '某大型国企',         city: '全国', salary: '面议',   tags: ['校招', '管培', '全职'],        industry: '国有企业',    description: '管理培训生项目，培养未来核心管理人才。',                  requirements: '2026 届毕业生，本科及以上。',    syncTime: '2026-05-24 16:00', reviewStatus: 'approved',  publishStatus: 'published'   },
  { id: 'js9',  sourceOrgId: 'org-boss-001',        sourceName: 'Boss直聘',       externalId: 'BP-M9251003',       sourceUrl: 'https://www.zhipin.com/j/M9251003',    title: '产品经理',       company: '广州某科技公司',     city: '广州', salary: '25-40K', tags: ['全职', '产品', 'PM'],          industry: '互联网/软件', description: '负责产品规划与设计，协调研发推进迭代。',                  requirements: '本科及以上，5 年以上产品经理经验。',                     syncTime: '2026-05-25 09:00', reviewStatus: 'rejected',  publishStatus: 'draft'       },
  { id: 'js10', sourceOrgId: 'org-city-talent-001', sourceName: '市人才网',       externalId: 'RC-2026-330110',    sourceUrl: 'https://rcw.city.gov.cn/j/330110',     title: '幼儿园教师',     company: '某双语幼儿园',       city: '本市', salary: '5-8K',  tags: ['全职', '教育', '幼教'],        industry: '教育培训',    description: '负责幼儿日常教学及生活照料。',                            requirements: '学前教育专业大专及以上，持教师资格证。',                 syncTime: '2026-05-25 07:30', reviewStatus: 'pending',   publishStatus: 'draft'       },
]

let FAIR_SOURCES: AdminFairSourceRecord[] = [
  { id: 'fs1', sourceOrgId: 'org-city-hr-001',    sourceName: '市人社局',       externalId: 'RSJ-2026-FAIR-001', sourceUrl: 'https://hrss.city.gov.cn/fair/2026-spring',   name: '2026年春季大型招聘会',   organizer: '市人力资源和社会保障局', startTime: '2026-06-01 09:00', endTime: '2026-06-01 17:00', venue: '市会展中心A馆',       status: 'upcoming', description: '本市规模最大的春季综合招聘会，汇聚 200 余家企业。', boothCount: 120, syncTime: '2026-05-24 10:00', reviewStatus: 'approved',  publishStatus: 'published' },
  { id: 'fs2', sourceOrgId: 'org-uni-001',         sourceName: '某大学就业中心', externalId: 'UNI-2026-JF-023',   sourceUrl: 'https://job.uni.edu.cn/fair/23',              name: '高校双选会（春）',       organizer: '某大学就业指导中心',     startTime: '2026-05-28 10:00', endTime: '2026-05-28 16:00', venue: '某大学体育馆',         status: 'upcoming', description: '面向应届毕业生举办的校园专场招聘会。',               boothCount: 60,  syncTime: '2026-05-23 09:00', reviewStatus: 'approved',  publishStatus: 'published' },
  { id: 'fs3', sourceOrgId: 'org-city-talent-001', sourceName: '市人才网',       externalId: 'RC-2026-FAIR-055',  sourceUrl: 'https://rcw.city.gov.cn/fair/055',            name: '制造业专场招聘会',       organizer: '市人才交流中心',         startTime: '2026-05-25 09:00', endTime: '2026-05-25 15:00', venue: 'B区大厅',              status: 'ongoing',  description: '聚焦制造业、机械、电气工程岗位。',                   boothCount: 45,  syncTime: '2026-05-22 14:00', reviewStatus: 'approved',  publishStatus: 'published' },
  { id: 'fs4', sourceOrgId: 'org-city-hr-001',    sourceName: '市人社局',       externalId: 'RSJ-2026-FAIR-002', sourceUrl: 'https://hrss.city.gov.cn/fair/military-2026', name: '退役军人专场招聘会',     organizer: '市退役军人事务局',       startTime: '2026-06-05 09:00', endTime: '2026-06-05 16:00', venue: '市人力资源中心',       status: 'upcoming', description: '面向退役军人举办的专场招聘会。',                     boothCount: 30,  syncTime: '2026-05-25 08:00', reviewStatus: 'pending',   publishStatus: 'draft'     },
  { id: 'fs5', sourceOrgId: 'org-uni-001',         sourceName: '某大学就业中心', externalId: 'UNI-2026-JF-024',   sourceUrl: 'https://job.uni.edu.cn/fair/24',              name: '互联网行业专场招聘',     organizer: '某大学就业指导中心',     startTime: '2026-06-10 14:00', endTime: '2026-06-10 17:00', venue: '某大学图书馆报告厅',   status: 'upcoming',                                                               boothCount: 20,  syncTime: '2026-05-25 09:00', reviewStatus: 'reviewing', publishStatus: 'draft'     },
  { id: 'fs6', sourceOrgId: 'org-city-talent-001', sourceName: '市人才网',       externalId: 'RC-2026-FAIR-042',  sourceUrl: 'https://rcw.city.gov.cn/fair/042',            name: '护理医疗专场招聘会',     organizer: '市卫生健康委员会',       startTime: '2026-05-20 09:00', endTime: '2026-05-20 15:00', venue: 'C区多功能厅',          status: 'ended',                                                                  boothCount: 25,  syncTime: '2026-05-18 10:00', reviewStatus: 'approved',  publishStatus: 'draft'     },
  { id: 'fs7', sourceOrgId: 'org-city-hr-001',    sourceName: '市人社局',       externalId: 'RSJ-2026-FAIR-099', sourceUrl: 'https://hrss.city.gov.cn/fair/2025-winter',   name: '2025年冬季综合招聘会',   organizer: '市人力资源和社会保障局', startTime: '2025-12-10 09:00', endTime: '2025-12-10 17:00', venue: '市会展中心B馆',        status: 'ended',                                                                  boothCount: 100, syncTime: '2025-12-05 10:00', reviewStatus: 'approved',  publishStatus: 'expired'   },
]

// ─── Audit logs mock(只含元数据,payloadJson 内不放敏感正文)──────────────
const MOCK_AUDIT_LOGS: AuditLogRecord[] = [
  { id: 'al1',  actorId: 'admin',    actorRole: 'admin',   action: 'job.review',           targetType: 'job_source', targetId: 'js4',  payloadJson: '{"action":"approve"}',                ipAddress: '10.20.0.2', userAgent: 'Mozilla/5.0', requestId: 'req-0001', createdAt: '2026-05-25T09:42:00.000Z' },
  { id: 'al2',  actorId: 'admin',    actorRole: 'admin',   action: 'job.publish',          targetType: 'job_source', targetId: 'js1',  payloadJson: '{"action":"publish"}',                ipAddress: '10.20.0.2', userAgent: 'Mozilla/5.0', requestId: 'req-0002', createdAt: '2026-05-25T09:40:00.000Z' },
  { id: 'al3',  actorId: 'partner1', actorRole: 'partner', action: 'job.import',           targetType: 'job_source', targetId: 'batch-003', payloadJson: '{"rows":3}',                     ipAddress: '10.20.1.5', userAgent: 'Mozilla/5.0', requestId: 'req-0003', createdAt: '2026-05-25T09:30:00.000Z' },
  { id: 'al4',  actorId: 'admin',    actorRole: 'admin',   action: 'fair.review',          targetType: 'fair_source', targetId: 'fs4', payloadJson: '{"action":"reviewing"}',              ipAddress: '10.20.0.2', userAgent: 'Mozilla/5.0', requestId: 'req-0004', createdAt: '2026-05-25T08:55:00.000Z' },
  { id: 'al5',  actorId: 'admin',    actorRole: 'admin',   action: 'file.force_delete',    targetType: 'file', targetId: 'file-7781',  payloadJson: '{"reason":"用户申请删除"}',           ipAddress: '10.20.0.2', userAgent: 'Mozilla/5.0', requestId: 'req-0005', createdAt: '2026-05-25T08:30:00.000Z' },
  { id: 'al6',  actorId: 'system',   actorRole: 'system',  action: 'file.cleanup_expired', targetType: 'file', targetId: null,         payloadJson: '{"cleaned":24}',                      ipAddress: null,        userAgent: null,          requestId: 'req-0006', createdAt: '2026-05-25T03:00:00.000Z' },
  { id: 'al7',  actorId: 'admin',    actorRole: 'admin',   action: 'system.login',         targetType: 'system', targetId: null,       payloadJson: '{"result":"success"}',                ipAddress: '10.20.0.2', userAgent: 'Mozilla/5.0', requestId: 'req-0007', createdAt: '2026-05-25T08:00:00.000Z' },
  { id: 'al8',  actorId: 'partner1', actorRole: 'partner', action: 'data_source.create',   targetType: 'job_source', targetId: 'ds5',  payloadJson: '{"accessMode":"webhook"}',            ipAddress: '10.20.1.5', userAgent: 'Mozilla/5.0', requestId: 'req-0008', createdAt: '2026-05-24T18:20:00.000Z' },
  { id: 'al9',  actorId: 'partner1', actorRole: 'partner', action: 'data_source.toggle',   targetType: 'job_source', targetId: 'ds5',  payloadJson: '{"enabled":true}',                    ipAddress: '10.20.1.5', userAgent: 'Mozilla/5.0', requestId: 'req-0009', createdAt: '2026-05-24T18:25:00.000Z' },
  { id: 'al10', actorId: 'admin',    actorRole: 'admin',   action: 'organization.update',  targetType: 'organization', targetId: 'org-uni-001', payloadJson: '{"field":"contact"}',          ipAddress: '10.20.0.2', userAgent: 'Mozilla/5.0', requestId: 'req-0010', createdAt: '2026-05-24T16:10:00.000Z' },
  { id: 'al11', actorId: 'admin',    actorRole: 'admin',   action: 'user.disable',         targetType: 'user', targetId: 'user-330',   payloadJson: '{"reason":"离职"}',                   ipAddress: '10.20.0.2', userAgent: 'Mozilla/5.0', requestId: 'req-0011', createdAt: '2026-05-24T15:40:00.000Z' },
  { id: 'al12', actorId: 'admin',    actorRole: 'admin',   action: 'fair.publish',         targetType: 'fair_source', targetId: 'fs2', payloadJson: '{"action":"publish"}',                ipAddress: '10.20.0.2', userAgent: 'Mozilla/5.0', requestId: 'req-0012', createdAt: '2026-05-23T09:15:00.000Z' },
]

function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 120))
}

export const adminMockAdapter = {
  async getJobSources(): Promise<AdminJobSourceRecord[]> {
    await delay()
    return [...JOB_SOURCES]
  },

  async reviewJobSource(id: string, action: ReviewAction): Promise<AdminJobSourceRecord> {
    await delay()
    JOB_SOURCES = JOB_SOURCES.map((s) => {
      if (s.id !== id) return s
      const reviewStatus =
        action === 'approve' ? 'approved' as const :
        action === 'reject'  ? 'rejected' as const : 'reviewing' as const
      return {
        ...s,
        reviewStatus,
        publishStatus: action === 'approve' ? 'draft' as const : s.publishStatus,
      }
    })
    return JOB_SOURCES.find((s) => s.id === id)!
  },

  async publishJobSourceRecord(id: string, action: PublishAction): Promise<AdminJobSourceRecord> {
    await delay()
    JOB_SOURCES = JOB_SOURCES.map((s) =>
      s.id === id
        ? { ...s, publishStatus: action === 'publish' ? 'published' as const : 'unpublished' as const }
        : s
    )
    return JOB_SOURCES.find((s) => s.id === id)!
  },

  async getFairSources(): Promise<AdminFairSourceRecord[]> {
    await delay()
    return [...FAIR_SOURCES]
  },

  async reviewFairSource(id: string, action: ReviewAction): Promise<AdminFairSourceRecord> {
    await delay()
    FAIR_SOURCES = FAIR_SOURCES.map((s) => {
      if (s.id !== id) return s
      const reviewStatus =
        action === 'approve' ? 'approved' as const :
        action === 'reject'  ? 'rejected' as const : 'reviewing' as const
      return {
        ...s,
        reviewStatus,
        publishStatus: action === 'approve' ? 'draft' as const : s.publishStatus,
      }
    })
    return FAIR_SOURCES.find((s) => s.id === id)!
  },

  async publishFairSourceRecord(id: string, action: PublishAction): Promise<AdminFairSourceRecord> {
    await delay()
    FAIR_SOURCES = FAIR_SOURCES.map((s) =>
      s.id === id
        ? { ...s, publishStatus: action === 'publish' ? 'published' as const : 'unpublished' as const }
        : s
    )
    return FAIR_SOURCES.find((s) => s.id === id)!
  },

  // ── 设备管理 — 终端心跳(契约 C1 mock)─────────────────────────────────────
  async getTerminals(): Promise<AdminTerminalsResponse> {
    await delay()
    const now = Date.now()
    const min = (n: number) => new Date(now - n * 60_000).toISOString()
    const base: Array<Omit<AdminTerminalRecord, 'orgId' | 'orgName' | 'agentStatus' | 'localTaskDatabaseAvailable'>> = [
      { id: 't1',  terminalCode: 'KSK-001', displayName: null, macAddress: null, locationLabel: null, enabled: true, registeredAt: '2026-01-10T08:00:00.000Z', lastSeenAt: min(0),   online: true,  lastHeartbeatAt: min(0),   printerStatus: 'ok',          agentVersion: 'v1.2.3', ipAddress: '10.20.0.11',  diskFreeGb: 182.4 },
      { id: 't2',  terminalCode: 'KSK-002', displayName: null, macAddress: null, locationLabel: null, enabled: true, registeredAt: '2026-01-10T08:00:00.000Z', lastSeenAt: min(2),   online: true,  lastHeartbeatAt: min(2),   printerStatus: 'paper_empty', agentVersion: 'v1.2.3', ipAddress: '10.20.0.12',  diskFreeGb: 96.1 },
      { id: 't3',  terminalCode: 'KSK-003', displayName: null, macAddress: null, locationLabel: null, enabled: true, registeredAt: '2026-01-12T08:00:00.000Z', lastSeenAt: min(1),   online: true,  lastHeartbeatAt: min(1),   printerStatus: 'ok',          agentVersion: 'v1.2.1', ipAddress: '10.20.0.13',  diskFreeGb: 54.7 },
      { id: 't4',  terminalCode: 'KSK-004', displayName: null, macAddress: null, locationLabel: null, enabled: true, registeredAt: '2026-02-01T08:00:00.000Z', lastSeenAt: min(0),   online: true,  lastHeartbeatAt: min(0),   printerStatus: 'ok',          agentVersion: 'v1.2.3', ipAddress: '10.20.0.14',  diskFreeGb: 210.0 },
      { id: 't7',  terminalCode: 'KSK-007', displayName: null, macAddress: null, locationLabel: null, enabled: true, registeredAt: '2026-02-15T08:00:00.000Z', lastSeenAt: min(120), online: false, lastHeartbeatAt: min(120), printerStatus: 'offline',     agentVersion: 'v1.2.0', ipAddress: '10.20.0.17',  diskFreeGb: 12.3 },
      { id: 't8',  terminalCode: 'KSK-008', displayName: null, macAddress: null, locationLabel: null, enabled: false, registeredAt: '2026-02-20T08:00:00.000Z', lastSeenAt: min(0),   online: true,  lastHeartbeatAt: min(0),   printerStatus: 'error',       agentVersion: 'v1.2.3', ipAddress: '10.20.0.18',  diskFreeGb: 140.9 },
      { id: 't9',  terminalCode: 'KSK-009', displayName: null, macAddress: null, locationLabel: null, enabled: true, registeredAt: '2026-03-01T08:00:00.000Z', lastSeenAt: min(300), online: false, lastHeartbeatAt: null,     printerStatus: null,          agentVersion: null,     ipAddress: null,          diskFreeGb: null },
      { id: 't10', terminalCode: 'KSK-010', displayName: null, macAddress: null, locationLabel: null, enabled: true, registeredAt: '2026-03-10T08:00:00.000Z', lastSeenAt: min(10),  online: false, lastHeartbeatAt: min(10),  printerStatus: 'not_found',   agentVersion: 'v1.2.3', ipAddress: '10.20.0.20',  diskFreeGb: 78.2 },
    ]
    return {
      terminals: base.map((t) => ({
        ...t,
        agentStatus: t.terminalCode === 'KSK-004' ? 'agent_degraded' : 'online',
        localTaskDatabaseAvailable: t.terminalCode === 'KSK-004' ? false : true,
        ...(MOCK_TERMINAL_PROFILE[t.terminalCode] ?? {}),
        ...mockOrgFields(t.terminalCode),
      })),
    }
  },

  // ── 终端机构归属（绑定/解绑）mock ─────────────────────────────────────────
  async getOrgOptions(): Promise<AdminOrgOptionsResponse> {
    await delay()
    return { organizations: MOCK_ORG_OPTIONS.map((o) => ({ ...o })) }
  },

  async assignTerminalOrg(terminalId: string, orgId: string | null): Promise<AssignTerminalOrgResult> {
    await delay()
    const oldOrgId = MOCK_TERMINAL_ORG[terminalId] ?? null
    let orgName: string | null = null
    if (orgId !== null) {
      const org = MOCK_ORG_OPTIONS.find((o) => o.id === orgId)
      if (!org) throw new ApiHttpError('ORG_NOT_FOUND', '机构不存在', 404)
      orgName = org.name
    }
    MOCK_TERMINAL_ORG[terminalId] = orgId
    return { terminalId, terminalCode: terminalId, oldOrgId, newOrgId: orgId, orgName }
  },

  async updateTerminalProfile(terminalId: string, input: UpdateTerminalProfileInput): Promise<UpdateTerminalProfileResult> {
    await delay()
    const existing = MOCK_TERMINAL_PROFILE[terminalId] ?? {
      terminalId,
      terminalCode: terminalId,
      displayName: null,
      macAddress: null,
      locationLabel: null,
      enabled: true,
    }
    const next: UpdateTerminalProfileResult = {
      ...existing,
      displayName: input.displayName === undefined ? existing.displayName : input.displayName,
      macAddress: input.macAddress === undefined ? existing.macAddress : input.macAddress,
      locationLabel: input.locationLabel === undefined ? existing.locationLabel : input.locationLabel,
      enabled: input.enabled === undefined ? existing.enabled : input.enabled,
    }
    MOCK_TERMINAL_PROFILE[terminalId] = next
    return next
  },

  // ── mock：一次性绑定码（仅用于前端 demo，不模拟真实 agentToken 流转） ──
  async createTerminalBindCode(terminalId: string, ttlMinutes = 10): Promise<TerminalBindCodeCreated> {
    await delay()
    const profile = MOCK_TERMINAL_PROFILE[terminalId]
    const terminalCode = profile?.terminalCode ?? terminalId
    if (profile && profile.enabled === false) {
      throw new ApiHttpError('TERMINAL_DISABLED', '终端已停用，不能生成绑定码', 400)
    }
    const bindCode = mockBindCode()
    const expiresAt = new Date(Date.now() + Math.max(1, Math.min(60, ttlMinutes)) * 60_000).toISOString()
    return { terminalId, terminalCode, bindCode, expiresAt }
  },

  async getPrinters(): Promise<AdminPrintersResponse> {
    await delay()
    const terminals = (await this.getTerminals()).terminals
    return {
      printers: terminals.map((t): AdminPrinterRecord => {
        const status = toMockPrinterStatus(t.online, t.printerStatus)
        return {
          id: `printer:${t.terminalCode}`,
          terminalId: t.id,
          terminalCode: t.terminalCode,
          name: `${t.terminalCode} 打印机`,
          model: null,
          serialNumber: null,
          status,
          printerStatus: t.printerStatus,
          currentTask: null,
          tonerLevel: null,
          paperTrayLevel: null,
          paperStatus: t.printerStatus === 'paper_empty' ? 'empty' : null,
          fault: toMockPrinterFault(t.online, t.printerStatus),
          lastHeartbeatAt: t.lastHeartbeatAt,
          lastSyncAt: t.lastHeartbeatAt,
        }
      }),
    }
  },

  // ── 日志审计(HIGH-5 mock,支持 action/时间筛选 + 分页)───────────────────
  async getAuditLogs(query: AuditLogListQuery = {}): Promise<AuditLogListResponse> {
    await delay()
    let items: AuditLogRecord[] = [...MOCK_AUDIT_LOGS]
    if (query.action)     items = items.filter((r) => r.action === query.action)
    if (query.actorId)    items = items.filter((r) => r.actorId === query.actorId)
    if (query.targetType) items = items.filter((r) => r.targetType === query.targetType)
    if (query.targetId)   items = items.filter((r) => r.targetId === query.targetId)
    if (query.startAt)    items = items.filter((r) => r.createdAt >= query.startAt!)
    if (query.endAt)      items = items.filter((r) => r.createdAt < query.endAt!)
    const total = items.length
    const limit = query.limit ?? 50
    const offset = query.offset ?? 0
    return { items: items.slice(offset, offset + limit), total, limit, offset }
  },

  async getImportBatches(): Promise<AdminImportBatch[]> {
    await delay()
    return [
      { id: 'batch-001', sourceId: 'ds2', sourceName: '高校就业信息 Excel', orgId: 'org-uni-001', orgName: '某大学就业中心', dataType: 'job',  fileName: '岗位数据_2026-05-24.xlsx', totalRows: 12, validRows: 10, invalidRows: 1, dupRows: 1, status: 'confirmed',  createdBy: 'partner1', confirmedAt: '2026-05-24T18:05:00.000Z', createdAt: '2026-05-24T18:00:00.000Z' },
      { id: 'batch-002', sourceId: 'ds5', sourceName: '校园兼职平台导入',   orgId: 'org-uni-001', orgName: '某大学就业中心', dataType: 'job',  fileName: '兼职岗位_2026-05-20.xlsx', totalRows: 8,  validRows: 6,  invalidRows: 2, dupRows: 0, status: 'confirmed',  createdBy: 'partner1', confirmedAt: '2026-05-20T10:10:00.000Z', createdAt: '2026-05-20T10:00:00.000Z' },
      { id: 'batch-003', sourceId: 'ds2', sourceName: '高校就业信息 Excel', orgId: 'org-uni-001', orgName: '某大学就业中心', dataType: 'fair', fileName: '招聘会信息_2026-05-25.xlsx', totalRows: 3,  validRows: 3,  invalidRows: 0, dupRows: 0, status: 'pending',    createdBy: 'partner1', confirmedAt: null,                       createdAt: '2026-05-25T09:30:00.000Z' },
      { id: 'batch-004', sourceId: 'ds2', sourceName: '高校就业信息 Excel', orgId: 'org-uni-002', orgName: '另一所大学就业中心', dataType: 'job', fileName: '春季岗位数据.xlsx',       totalRows: 20, validRows: 18, invalidRows: 2, dupRows: 0, status: 'confirmed',  createdBy: 'partner2', confirmedAt: '2026-05-23T14:10:00.000Z', createdAt: '2026-05-23T14:00:00.000Z' },
      { id: 'batch-005', sourceId: 'ds2', sourceName: '高校就业信息 Excel', orgId: 'org-uni-001', orgName: '某大学就业中心', dataType: 'job',  fileName: '错误文件_test.xlsx',        totalRows: 5,  validRows: 0,  invalidRows: 5, dupRows: 0, status: 'cancelled',  createdBy: 'partner1', confirmedAt: null,                       createdAt: '2026-05-22T11:00:00.000Z' },
    ]
  },
}

function toMockPrinterStatus(online: boolean, printerStatus: string | null): AdminPrinterRecord['status'] {
  if (!online) return 'offline'
  if (!printerStatus || printerStatus === 'unknown') return 'offline'
  return printerStatus === 'ok' ? 'online' : 'error'
}

function mockBindCode(): string {
  // 20 位的可视码：去掉易混淆字符 (0 O I L 1)，避免操作员复制时误读。
  const pool = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
  let out = ''
  for (let i = 0; i < 20; i++) {
    out += pool.charAt(Math.floor(Math.random() * pool.length))
  }
  return out
}

function toMockPrinterFault(online: boolean, printerStatus: string | null): string | null {
  if (!online) return '终端离线，打印机状态未知'
  switch (printerStatus) {
    case 'paper_empty':
      return '纸盒已空，请补充 A4 纸张'
    case 'offline':
      return '打印机离线'
    case 'not_found':
      return '未检测到配置的打印机'
    case 'error':
      return '打印机故障，需人工处理'
    case null:
    case 'unknown':
      return '打印机状态未上报'
    default:
      return null
  }
}
