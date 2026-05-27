import type { AdminJobSourceRecord, AdminFairSourceRecord } from './types'
import type { ReviewAction } from './review-types'
import type { PublishAction } from './review-types'

export type { ReviewAction, PublishAction }

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
}
