import type {
  FairBooth,
  FairCompany,
  FairLiveStats,
  FairMaterial,
  FairZone,
} from '../types/fair'

// ─── Fair f1: 2026春季高校毕业生双选会 ────────────────────────────────────────

export const FAIR_F1_ZONES: FairZone[] = [
  { id: 'z1-1', fairId: 'f1', zoneName: 'A区 互联网科技', description: '互联网、软件、大数据企业', industry: '互联网/软件', boothCount: 42, checkedInCount: 38, color: 'bg-blue-50' },
  { id: 'z1-2', fairId: 'f1', zoneName: 'B区 金融财务',   description: '银行、券商、会计师事务所等', industry: '金融/财务', boothCount: 30, checkedInCount: 27, color: 'bg-green-50' },
  { id: 'z1-3', fairId: 'f1', zoneName: 'C区 制造工程',   description: '制造业、机械、新能源企业', industry: '制造/工程', boothCount: 35, checkedInCount: 28, color: 'bg-orange-50' },
  { id: 'z1-4', fairId: 'f1', zoneName: 'D区 政事业单位', description: '政府机关、事业单位、国企', industry: '政事业', boothCount: 25, checkedInCount: 22, color: 'bg-purple-50' },
  { id: 'z1-5', fairId: 'f1', zoneName: 'E区 教育医疗',   description: '学校、医院、科研机构', industry: '教育/医疗', boothCount: 20, checkedInCount: 16, color: 'bg-pink-50' },
]

export const FAIR_F1_COMPANIES: FairCompany[] = [
  {
    id: 'c1-1', fairId: 'f1',
    companyName: '某科技有限公司',
    industry: '互联网/软件', scale: 'large',
    description: '专注企业级SaaS产品研发，服务超过5万家企业客户，在北京、上海、深圳均设有研发中心。',
    boothNumber: 'A-03', zoneId: 'z1-1', zoneName: 'A区 互联网科技',
    positions: [
      { id: 'p1-1-1', title: '前端开发工程师', headcount: 5, salary: '15,000–25,000元/月', requirements: '本科及以上，熟悉 React/Vue，1年以上经验' },
      { id: 'p1-1-2', title: 'Java 后端工程师', headcount: 8, salary: '18,000–28,000元/月', requirements: '本科及以上，熟悉 Spring Boot，了解分布式系统' },
      { id: 'p1-1-3', title: '产品经理（校招）', headcount: 3, salary: '12,000–18,000元/月', requirements: '应届本科生，逻辑清晰，有互联网产品意识' },
    ],
    sourceUrl: 'https://example-company.com/careers',
    checkinStatus: 'checked_in', checkinTime: '2026-05-28T08:15:00Z',
  },
  {
    id: 'c1-2', fairId: 'f1',
    companyName: '市国有商业银行',
    industry: '金融/财务', scale: 'enterprise',
    description: '全国性国有商业银行，总资产超10万亿，在全市设有200余家网点，提供全方位金融服务。',
    boothNumber: 'B-01', zoneId: 'z1-2', zoneName: 'B区 金融财务',
    positions: [
      { id: 'p1-2-1', title: '柜台客户经理（校招）', headcount: 20, salary: '面议', requirements: '本科及以上，形象良好，有服务意识' },
      { id: 'p1-2-2', title: '信息科技岗',           headcount: 10, salary: '面议', requirements: '计算机/金融相关专业本科以上，了解金融IT系统' },
    ],
    sourceUrl: 'https://example-bank.com.cn/campus',
    checkinStatus: 'checked_in', checkinTime: '2026-05-28T08:30:00Z',
  },
  {
    id: 'c1-3', fairId: 'f1',
    companyName: '新能源汽车制造厂',
    industry: '制造/工程', scale: 'large',
    description: '专注新能源商用车研发制造，年产能10万辆，在全国设有6大生产基地，积极布局海外市场。',
    boothNumber: 'C-08', zoneId: 'z1-3', zoneName: 'C区 制造工程',
    positions: [
      { id: 'p1-3-1', title: '机械工程师',   headcount: 12, salary: '10,000–16,000元/月', requirements: '机械/电气工程本科以上，CAD制图熟练' },
      { id: 'p1-3-2', title: '质量管理工程师', headcount: 6, salary: '12,000–18,000元/月', requirements: '质量/工业工程相关专业，了解IATF 16949优先' },
    ],
    sourceUrl: 'https://example-auto.com/jobs',
    checkinStatus: 'checked_in', checkinTime: '2026-05-28T08:20:00Z',
  },
  {
    id: 'c1-4', fairId: 'f1',
    companyName: '某市人社局所属事业单位',
    industry: '政事业', scale: 'medium',
    description: '市级人力资源和社会保障事业单位，承担公共就业服务、职业技能鉴定等公益性职能。',
    boothNumber: 'D-02', zoneId: 'z1-4', zoneName: 'D区 政事业单位',
    positions: [
      { id: 'p1-4-1', title: '公共就业服务专员', headcount: 5, salary: '按编制', requirements: '人力资源/行政管理本科以上，应届生优先' },
    ],
    sourceUrl: 'https://example-gov.cn/recruit',
    checkinStatus: 'checked_in', checkinTime: '2026-05-28T08:45:00Z',
  },
  {
    id: 'c1-5', fairId: 'f1',
    companyName: '附属医院',
    industry: '教育/医疗', scale: 'large',
    description: '三甲综合医院，床位数2200张，设有42个临床科室，国家重点专科5个，年门诊量超200万人次。',
    boothNumber: 'E-05', zoneId: 'z1-5', zoneName: 'E区 教育医疗',
    positions: [
      { id: 'p1-5-1', title: '临床护士（应届）', headcount: 30, salary: '7,000–10,000元/月', requirements: '护理专业大专及以上，持护士执照' },
      { id: 'p1-5-2', title: '医疗器械维护工程师', headcount: 4, salary: '10,000–15,000元/月', requirements: '生物医学工程/电子相关专业' },
    ],
    sourceUrl: 'https://example-hospital.com/hr',
    checkinStatus: 'checked_in', checkinTime: '2026-05-28T09:00:00Z',
  },
  {
    id: 'c1-6', fairId: 'f1',
    companyName: '会计师事务所',
    industry: '金融/财务', scale: 'medium',
    description: '国内知名会计师事务所，业务涵盖审计、税务咨询、企业重组，客户包括上市公司及大型国企。',
    boothNumber: 'B-12', zoneId: 'z1-2', zoneName: 'B区 金融财务',
    positions: [
      { id: 'p1-6-1', title: '审计助理（校招）', headcount: 15, salary: '8,000–12,000元/月', requirements: '会计/财管/审计本科以上，CPA 在读优先' },
    ],
    sourceUrl: 'https://example-accounting.com/campus',
    checkinStatus: 'pending',
  },
  {
    id: 'c1-7', fairId: 'f1',
    companyName: '职业技术学院',
    industry: '教育/医疗', scale: 'medium',
    description: '国家示范性高职院校，开设专业50余个，在校生1.5万人，长期招聘高技能专业课教师。',
    boothNumber: 'E-11', zoneId: 'z1-5', zoneName: 'E区 教育医疗',
    positions: [
      { id: 'p1-7-1', title: '专业课教师', headcount: 8, salary: '按事业单位标准', requirements: '相关专业硕士及以上，有企业工作经历优先' },
    ],
    sourceUrl: 'https://example-college.edu.cn/hr',
    checkinStatus: 'absent',
  },
]

export const FAIR_F1_BOOTHS: FairBooth[] = [
  { id: 'b1-1',  fairId: 'f1', zoneId: 'z1-1', zoneName: 'A区 互联网科技', boothNumber: 'A-01', status: 'occupied',  companyId: undefined,   companyName: '某软件开发公司',  areaSqm: 9 },
  { id: 'b1-2',  fairId: 'f1', zoneId: 'z1-1', zoneName: 'A区 互联网科技', boothNumber: 'A-02', status: 'occupied',  companyId: undefined,   companyName: '大数据平台公司',  areaSqm: 9 },
  { id: 'b1-3',  fairId: 'f1', zoneId: 'z1-1', zoneName: 'A区 互联网科技', boothNumber: 'A-03', status: 'occupied',  companyId: 'c1-1',     companyName: '某科技有限公司',  areaSqm: 9 },
  { id: 'b1-4',  fairId: 'f1', zoneId: 'z1-1', zoneName: 'A区 互联网科技', boothNumber: 'A-04', status: 'available', companyId: undefined,   companyName: undefined,         areaSqm: 9 },
  { id: 'b1-5',  fairId: 'f1', zoneId: 'z1-1', zoneName: 'A区 互联网科技', boothNumber: 'A-05', status: 'occupied',  companyId: undefined,   companyName: '云服务提供商',    areaSqm: 9 },
  { id: 'b1-6',  fairId: 'f1', zoneId: 'z1-2', zoneName: 'B区 金融财务',   boothNumber: 'B-01', status: 'occupied',  companyId: 'c1-2',     companyName: '市国有商业银行',  areaSqm: 12 },
  { id: 'b1-7',  fairId: 'f1', zoneId: 'z1-2', zoneName: 'B区 金融财务',   boothNumber: 'B-02', status: 'occupied',  companyId: undefined,   companyName: '证券公司',        areaSqm: 9 },
  { id: 'b1-8',  fairId: 'f1', zoneId: 'z1-2', zoneName: 'B区 金融财务',   boothNumber: 'B-12', status: 'occupied',  companyId: 'c1-6',     companyName: '会计师事务所',    areaSqm: 9 },
  { id: 'b1-9',  fairId: 'f1', zoneId: 'z1-3', zoneName: 'C区 制造工程',   boothNumber: 'C-08', status: 'occupied',  companyId: 'c1-3',     companyName: '新能源汽车制造厂', areaSqm: 12 },
  { id: 'b1-10', fairId: 'f1', zoneId: 'z1-3', zoneName: 'C区 制造工程',   boothNumber: 'C-09', status: 'reserved',  companyId: undefined,   companyName: undefined,         areaSqm: 9 },
  { id: 'b1-11', fairId: 'f1', zoneId: 'z1-4', zoneName: 'D区 政事业单位', boothNumber: 'D-02', status: 'occupied',  companyId: 'c1-4',     companyName: '人社局事业单位',  areaSqm: 9 },
  { id: 'b1-12', fairId: 'f1', zoneId: 'z1-5', zoneName: 'E区 教育医疗',   boothNumber: 'E-05', status: 'occupied',  companyId: 'c1-5',     companyName: '附属医院',        areaSqm: 9 },
  { id: 'b1-13', fairId: 'f1', zoneId: 'z1-5', zoneName: 'E区 教育医疗',   boothNumber: 'E-11', status: 'occupied',  companyId: 'c1-7',     companyName: '职业技术学院',    areaSqm: 9 },
]

export const FAIR_F1_MATERIALS: FairMaterial[] = [
  { id: 'm1-1', fairId: 'f1', name: '2026春季双选会 活动日程', type: 'schedule',     description: '活动时间安排、会场规则及各时段安排表', pageCount: 1, fileSizeKB: 180, printCount: 234, fileUrl: '/materials/f1-schedule.pdf',     allowPrint: true,  publishStatus: 'published' },
  { id: 'm1-2', fairId: 'f1', name: '展馆平面导览图',          type: 'venue_map',    description: '各展区分布、展位号标注、通道及出口标识', pageCount: 1, fileSizeKB: 420, printCount: 187, fileUrl: '/materials/f1-map.pdf',          allowPrint: true,  publishStatus: 'published' },
  { id: 'm1-3', fairId: 'f1', name: '参会企业名册（完整版）',   type: 'company_list', description: '所有参会企业名单、展位号、行业分类及联系方式', pageCount: 8, fileSizeKB: 650, printCount: 96,  fileUrl: '/materials/f1-companies.pdf',   allowPrint: true,  publishStatus: 'published' },
  { id: 'm1-4', fairId: 'f1', name: '招聘岗位汇总',            type: 'position_list','description': '按行业分类的全部招聘岗位及需求信息', pageCount: 12, fileSizeKB: 820, printCount: 72,  fileUrl: '/materials/f1-positions.pdf',   allowPrint: true,  publishStatus: 'published' },
  { id: 'm1-5', fairId: 'f1', name: '活动宣传折页',            type: 'brochure',     description: '本次双选会主办方宣传资料及往届回顾',   pageCount: 2, fileSizeKB: 960, printCount: 45,  fileUrl: '/materials/f1-brochure.pdf',    allowPrint: true,  publishStatus: 'published' },
]

export const FAIR_F1_STATS: FairLiveStats = {
  fairId: 'f1',
  totalCompanies: 152,
  checkedInCompanies: 131,
  totalPositions: 487,
  totalHeadcount: 1820,
  browseCount: 1240,
  scanCount: 348,
  printCount: 634,
  checkinCount: 0,
  lastUpdated: '2026-05-28T10:30:00Z',
}

// ─── Fair f2: 互联网行业专场招聘会（进行中） ──────────────────────────────────

export const FAIR_F2_ZONES: FairZone[] = [
  { id: 'z2-1', fairId: 'f2', zoneName: 'A区 产品研发', description: '互联网产品、前后端、移动端开发', industry: '产品/技术', boothCount: 34, checkedInCount: 34, color: 'bg-blue-50' },
  { id: 'z2-2', fairId: 'f2', zoneName: 'B区 数据/AI',  description: '大数据、人工智能、算法', industry: '数据/AI', boothCount: 20, checkedInCount: 19, color: 'bg-indigo-50' },
  { id: 'z2-3', fairId: 'f2', zoneName: 'C区 运营市场', description: '产品运营、市场推广、内容创作', industry: '运营/市场', boothCount: 14, checkedInCount: 13, color: 'bg-teal-50' },
]

export const FAIR_F2_COMPANIES: FairCompany[] = [
  {
    id: 'c2-1', fairId: 'f2',
    companyName: '某互联网平台公司',
    industry: '产品/技术', scale: 'enterprise',
    description: '国内头部互联网公司，业务涵盖电商、本地生活、云计算，DAU超2亿。',
    boothNumber: 'A-01', zoneId: 'z2-1', zoneName: 'A区 产品研发',
    positions: [
      { id: 'p2-1-1', title: '前端工程师（校招）', headcount: 10, salary: '20,000–30,000元/月', requirements: '本科计算机相关专业，熟悉主流前端框架' },
      { id: 'p2-1-2', title: 'iOS开发工程师',       headcount: 5,  salary: '22,000–32,000元/月', requirements: '3年以上iOS开发经验，熟悉Swift' },
      { id: 'p2-1-3', title: '产品经理（社招）',   headcount: 3,  salary: '25,000–40,000元/月', requirements: '2年以上互联网产品经验，数据分析能力强' },
    ],
    sourceUrl: 'https://example-internet.com/campus',
    checkinStatus: 'checked_in', checkinTime: '2026-05-25T09:05:00Z',
  },
  {
    id: 'c2-2', fairId: 'f2',
    companyName: 'AI算法公司',
    industry: '数据/AI', scale: 'large',
    description: '专注计算机视觉与NLP的人工智能公司，产品已落地智慧城市、工业检测、医疗影像等领域。',
    boothNumber: 'B-03', zoneId: 'z2-2', zoneName: 'B区 数据/AI',
    positions: [
      { id: 'p2-2-1', title: '算法工程师', headcount: 8, salary: '25,000–45,000元/月', requirements: '硕士及以上，深度学习框架熟练，有项目发表论文优先' },
      { id: 'p2-2-2', title: '数据工程师', headcount: 5, salary: '18,000–28,000元/月', requirements: '熟悉 Spark/Flink 大数据处理，Python 熟练' },
    ],
    sourceUrl: 'https://example-ai.com/join',
    checkinStatus: 'checked_in', checkinTime: '2026-05-25T09:10:00Z',
  },
  {
    id: 'c2-3', fairId: 'f2',
    companyName: '电商运营公司',
    industry: '运营/市场', scale: 'medium',
    description: '专注电商代运营与内容营销，服务超300个品牌客户，管理GMV超50亿/年。',
    boothNumber: 'C-05', zoneId: 'z2-3', zoneName: 'C区 运营市场',
    positions: [
      { id: 'p2-3-1', title: '电商运营专员', headcount: 10, salary: '8,000–15,000元/月', requirements: '熟悉淘宝/抖音运营，1年以上电商经验' },
      { id: 'p2-3-2', title: '内容创作（视频）', headcount: 6,  salary: '10,000–18,000元/月', requirements: '有短视频制作/剪辑经验，了解内容平台规则' },
    ],
    sourceUrl: 'https://example-ecom.com/hr',
    checkinStatus: 'checked_in', checkinTime: '2026-05-25T09:15:00Z',
  },
  {
    id: 'c2-4', fairId: 'f2',
    companyName: '云计算服务商',
    industry: '产品/技术', scale: 'large',
    description: '国内TOP5云服务提供商，提供IaaS/PaaS/SaaS全栈云产品，政府、金融、医疗行业深度覆盖。',
    boothNumber: 'A-08', zoneId: 'z2-1', zoneName: 'A区 产品研发',
    positions: [
      { id: 'p2-4-1', title: '云原生工程师',   headcount: 6, salary: '20,000–35,000元/月', requirements: '熟悉 K8s/Docker，有微服务开发经验' },
      { id: 'p2-4-2', title: '解决方案架构师', headcount: 3, salary: '30,000–50,000元/月', requirements: '5年以上架构经验，熟悉企业级IT系统' },
    ],
    sourceUrl: 'https://example-cloud.com/careers',
    checkinStatus: 'checked_in', checkinTime: '2026-05-25T09:08:00Z',
  },
]

export const FAIR_F2_BOOTHS: FairBooth[] = [
  { id: 'b2-1', fairId: 'f2', zoneId: 'z2-1', zoneName: 'A区 产品研发', boothNumber: 'A-01', status: 'occupied',  companyId: 'c2-1', companyName: '某互联网平台公司', areaSqm: 18 },
  { id: 'b2-2', fairId: 'f2', zoneId: 'z2-1', zoneName: 'A区 产品研发', boothNumber: 'A-02', status: 'occupied',  companyId: undefined, companyName: '移动应用开发公司', areaSqm: 9 },
  { id: 'b2-3', fairId: 'f2', zoneId: 'z2-1', zoneName: 'A区 产品研发', boothNumber: 'A-03', status: 'occupied',  companyId: undefined, companyName: '游戏科技公司', areaSqm: 9 },
  { id: 'b2-4', fairId: 'f2', zoneId: 'z2-1', zoneName: 'A区 产品研发', boothNumber: 'A-08', status: 'occupied',  companyId: 'c2-4', companyName: '云计算服务商', areaSqm: 12 },
  { id: 'b2-5', fairId: 'f2', zoneId: 'z2-2', zoneName: 'B区 数据/AI',  boothNumber: 'B-03', status: 'occupied',  companyId: 'c2-2', companyName: 'AI算法公司', areaSqm: 12 },
  { id: 'b2-6', fairId: 'f2', zoneId: 'z2-2', zoneName: 'B区 数据/AI',  boothNumber: 'B-05', status: 'occupied',  companyId: undefined, companyName: '数字孪生公司', areaSqm: 9 },
  { id: 'b2-7', fairId: 'f2', zoneId: 'z2-2', zoneName: 'B区 数据/AI',  boothNumber: 'B-06', status: 'available', companyId: undefined, companyName: undefined, areaSqm: 9 },
  { id: 'b2-8', fairId: 'f2', zoneId: 'z2-3', zoneName: 'C区 运营市场', boothNumber: 'C-05', status: 'occupied',  companyId: 'c2-3', companyName: '电商运营公司', areaSqm: 9 },
]

export const FAIR_F2_MATERIALS: FairMaterial[] = [
  { id: 'm2-1', fairId: 'f2', name: '专场招聘日程', type: 'schedule',     description: '现场签到流程及各时段安排',   pageCount: 1, fileSizeKB: 120, printCount: 143, fileUrl: '/materials/f2-schedule.pdf',  allowPrint: true, publishStatus: 'published' },
  { id: 'm2-2', fairId: 'f2', name: '展区分布图',   type: 'venue_map',    description: 'B厅三个展区分布及导览路线', pageCount: 1, fileSizeKB: 280, printCount: 98,  fileUrl: '/materials/f2-map.pdf',       allowPrint: true, publishStatus: 'published' },
  { id: 'm2-3', fairId: 'f2', name: '参会企业与岗位', type: 'position_list', description: '互联网专场全部岗位清单',   pageCount: 4, fileSizeKB: 350, printCount: 67,  fileUrl: '/materials/f2-positions.pdf', allowPrint: true, publishStatus: 'published' },
]

export const FAIR_F2_STATS: FairLiveStats = {
  fairId: 'f2',
  totalCompanies: 68,
  checkedInCompanies: 66,
  totalPositions: 210,
  totalHeadcount: 750,
  browseCount: 892,
  scanCount: 267,
  printCount: 308,
  checkinCount: 0,
  lastUpdated: '2026-05-25T11:45:00Z',
}

// ─── 按 fairId 查找 ────────────────────────────────────────────────────────────

export const FAIR_ZONES_MAP: Record<string, FairZone[]> = {
  f1: FAIR_F1_ZONES,
  f2: FAIR_F2_ZONES,
}

export const FAIR_COMPANIES_MAP: Record<string, FairCompany[]> = {
  f1: FAIR_F1_COMPANIES,
  f2: FAIR_F2_COMPANIES,
}

export const FAIR_BOOTHS_MAP: Record<string, FairBooth[]> = {
  f1: FAIR_F1_BOOTHS,
  f2: FAIR_F2_BOOTHS,
}

export const FAIR_MATERIALS_MAP: Record<string, FairMaterial[]> = {
  f1: FAIR_F1_MATERIALS,
  f2: FAIR_F2_MATERIALS,
}

export const FAIR_STATS_MAP: Record<string, FairLiveStats> = {
  f1: FAIR_F1_STATS,
  f2: FAIR_F2_STATS,
}
