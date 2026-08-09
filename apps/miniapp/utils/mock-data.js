// utils/mock-data.js
// 集中式 mock 数据,按 id 建索引,保证列表项与详情页取到同一条记录。
// 仅在 config.USE_MOCK=true 时被 api 层使用。接入真实后端后此文件不再参与运行。
// 合规:均为第三方/官方来源的公开展示信息 mock,不含任何候选人/投递/筛选数据。

// ---------- 岗位 ----------
const JOBS = {
  j1: {
    id: 'j1', title: '前端开发工程师', salary: '8-14K',
    company: '杭州某科技有限公司 · 西湖区', tags: ['互联网', '本科及以上', 'React'],
    match: 'high', matchText: '较高参考', source: '智联招聘', time: '同步于 2 小时前',
    sourceOrg: '智联招聘', externalId: 'JOB-2026-000j1', syncTime: '2026-07-24 09:12',
    externalUrl: 'https://example.com/job/j1',
    duties: ['负责 Web 前端页面开发与组件封装', '与设计、后端协作完成需求迭代', '优化前端性能与兼容性'],
    requirements: ['1年以上 React 开发经验', '熟悉 HTML/CSS/ES6+', '本科及以上,计算机相关专业'],
  },
  j2: {
    id: 'j2', title: 'UI/UX 设计师', salary: '9-15K',
    company: '某互联网公司 · 滨江区', tags: ['设计', '经验不限', 'Figma'],
    match: 'mid', matchText: '中等参考', source: '官方人才网', time: '同步于今天',
    sourceOrg: '官方人才网', externalId: 'JOB-2026-000j2', syncTime: '2026-07-24 10:02',
    externalUrl: 'https://example.com/job/j2',
    duties: ['负责产品界面与交互设计', '输出设计规范与视觉稿', '参与可用性走查'],
    requirements: ['熟练使用 Figma / Sketch', '有完整项目作品集', '经验不限,应届可'],
  },
  j3: {
    id: 'j3', title: '产品运营专员', salary: '6-10K',
    company: '某文化传媒 · 拱墅区', tags: ['运营', '大专及以上', '应届可'],
    match: 'mid', matchText: '中等参考', source: '前程无忧', time: '同步于昨天',
    sourceOrg: '前程无忧', externalId: 'JOB-2026-000j3', syncTime: '2026-07-23 16:40',
    externalUrl: 'https://example.com/job/j3',
    duties: ['负责内容运营与用户增长', '策划并执行线上活动', '数据复盘与优化'],
    requirements: ['大专及以上学历', '有运营实习/项目经验优先', '应届可'],
  },
};

// ---------- 招聘会 ----------
const FAIRS = {
  f1: {
    id: 'f1', emoji: '🎪', live: true, status: 'active', statusLabel: '进行中',
    title: '2026 春季高校毕业生现场招聘会', org: '市人力资源和社会保障局',
    time: '2026-03-28 09:00–16:00', format: '线下（现场招聘）', companyCount: '186 家',
    targetGroup: '应届生 / 社会人才', sourceOrg: '市人社局', externalId: 'FAIR-2026-0f1',
    syncTime: '2026-07-24 08:00',
    metaLines: ['🗓 3月28日 09:00–16:00', '📍 市人力资源市场 · A馆', '🏢 186 家参会单位'],
    source: '市人社局', sync: '同步 2h 前', tag: '现场', tagTone: 'wheat', bannerStyle: '',
    intro: '本次招聘会汇聚制造业、科技、服务等各类企业,现场提供就业咨询、简历打印等配套服务。',
    booths: [
      { zone: 'A', zoneClass: 'zone-a', name: '华为技术有限公司', pos: 'A-01' },
      { zone: 'B', zoneClass: 'zone-b', name: '比亚迪股份有限公司', pos: 'B-07' },
      { zone: 'C', zoneClass: 'zone-c', name: '腾讯科技（深圳）有限公司', pos: 'C-03' },
      { zone: 'S', zoneClass: 'zone-s', name: '招商银行股份有限公司', pos: 'S-02' },
    ],
    externalUrl: 'https://example.com/fair/f1',
  },
  f2: {
    id: 'f2', emoji: '💻', live: false, status: 'upcoming', statusLabel: '即将开始',
    title: '互联网 & 科技行业线上双选会', org: '智联招聘',
    time: '2026-04-02 – 2026-04-05', format: '线上（视频面试）', companyCount: '92 家',
    targetGroup: '应届生 / 社会人才', sourceOrg: '智联招聘', externalId: 'FAIR-2026-0f2',
    syncTime: '2026-07-23 08:00',
    metaLines: ['🗓 4月2日 – 4月5日', '🌐 线上举办 · 视频面试', '🏢 92 家企业'],
    source: '智联招聘', sync: '同步 1天前', tag: '即将开始', tagTone: '',
    bannerStyle: 'background:linear-gradient(135deg,var(--slate-soft),var(--slate-wash))',
    intro: '面向互联网与科技行业的线上双选会,支持在线投递与视频面试(在来源平台完成)。',
    booths: [],
    externalUrl: 'https://example.com/fair/f2',
  },
  f3: {
    id: 'f3', emoji: '🏛️', live: false, status: 'upcoming', statusLabel: '即将开始',
    title: '先进制造业专场招聘会', org: '经开区管委会',
    time: '2026-04-10 09:30–15:00', format: '线下（现场招聘）', companyCount: '—',
    targetGroup: '制造业技能人才', sourceOrg: '经开区管委会', externalId: 'FAIR-2026-0f3',
    syncTime: '2026-07-21 08:00',
    metaLines: ['🗓 4月10日 09:30–15:00', '📍 经开区人才服务中心'],
    source: '经开区管委会', sync: '同步 3天前', tag: '即将开始', tagTone: '', bannerStyle: '',
    intro: '聚焦先进制造业的专场招聘会,现场提供岗位咨询与政策解读。',
    booths: [],
    externalUrl: 'https://example.com/fair/f3',
  },
};

// ---------- 企业 ----------
const COMPANIES = {
  c1: {
    id: 'c1', emoji: '🎨', name: '杭州创意未来网络科技有限公司',
    metaParts: ['互联网', '·', '100–500人', '·', '杭州·西湖区'],
    listMeta: '互联网 · 100–500人 · A轮', jobCount: 8,
    tags: [
      { text: 'A轮融资', tone: 'teal' }, { text: '设计工具', tone: '' },
      { text: '电商平台', tone: '' }, { text: '弹性上下班', tone: '' },
      { text: '五险一金', tone: 'teal' }, { text: '定期团建', tone: '' },
    ],
    desc: [
      '杭州创意未来网络科技有限公司成立于2018年,是一家专注于创意设计工具和电商营销解决方案的互联网企业,总部位于杭州西湖区。公司旗下核心产品覆盖在线设计工具、图片素材库、营销模板市场三大方向。',
      '截至2025年,公司注册用户超过1,200万,企业客户覆盖全国30个省市。公司于2022年完成A轮融资,致力于为中小企业提供高效、低门槛的数字营销能力。团队规模约200人,技术与设计人员占比超过60%。',
      '公司文化强调创造力、协作与快速迭代,提供弹性工作制度、完善的职业晋升通道以及丰厚的绩效激励方案。',
    ],
    sourceOrg: '智联招聘', firstSeen: '2024-03-15', externalUrl: 'https://example.com/company/c1',
    jobs: [
      { id: 'j1', title: 'UI 设计师', meta: '杭州·西湖区 · 1–3年', salary: '8–14K' },
      { id: 'j2', title: '前端工程师', meta: '杭州·西湖区 · 3–5年', salary: '15–22K' },
      { id: 'j3', title: '产品经理', meta: '杭州·西湖区 · 2–5年', salary: '12–20K' },
    ],
  },
  c2: {
    id: 'c2', emoji: '🏦', name: '招商银行股份有限公司',
    metaParts: ['金融/银行', '·', '10000人以上', '·', '上市'],
    listMeta: '金融/银行 · 10000人以上 · 上市', jobCount: 23,
    tags: [{ text: '国有控股', tone: 'wheat' }, { text: '零售银行', tone: '' }],
    desc: ['招商银行股份有限公司为国内领先的股份制商业银行,零售业务处于行业前列。以上为来源平台公开展示信息。'],
    sourceOrg: '智联招聘', firstSeen: '2024-01-10', externalUrl: 'https://example.com/company/c2',
    jobs: [{ id: 'j2', title: '客户经理', meta: '深圳 · 3–5年', salary: '面议' }],
  },
  c3: {
    id: 'c3', emoji: '🏭', name: '比亚迪汽车工业有限公司',
    metaParts: ['制造/汽车', '·', '10000人以上', '·', '上市'],
    listMeta: '制造/汽车 · 10000人以上 · 上市', jobCount: 61,
    tags: [{ text: '新能源汽车', tone: '' }, { text: '应届友好', tone: 'teal' }],
    desc: ['比亚迪为新能源汽车与电池领域的头部企业。以上为来源平台公开展示信息。'],
    sourceOrg: '前程无忧', firstSeen: '2024-02-01', externalUrl: 'https://example.com/company/c3',
    jobs: [{ id: 'j1', title: '嵌入式工程师', meta: '深圳 · 1–3年', salary: '12–20K' }],
  },
  c4: {
    id: 'c4', emoji: '📚', name: '好未来教育科技集团',
    metaParts: ['教育科技', '·', '1000–5000人', '·', '上市'],
    listMeta: '教育科技 · 1000–5000人 · 上市', jobCount: 15,
    tags: [{ text: 'K12教育', tone: 'plum' }, { text: '在线学习', tone: '' }],
    desc: ['好未来为教育科技企业,聚焦在线学习产品。以上为来源平台公开展示信息。'],
    sourceOrg: '智联招聘', firstSeen: '2024-04-20', externalUrl: 'https://example.com/company/c4',
    jobs: [{ id: 'j3', title: '课程运营', meta: '北京 · 应届可', salary: '8–12K' }],
  },
  c5: {
    id: 'c5', emoji: '🏥', name: '丁香园医疗健康平台',
    metaParts: ['医疗/健康', '·', '500–1000人', '·', 'D轮'],
    listMeta: '医疗/健康 · 500–1000人 · D轮', jobCount: 9,
    tags: [{ text: '医疗互联网', tone: 'teal' }, { text: '六险一金', tone: '' }],
    desc: ['丁香园为医疗健康互联网平台。以上为来源平台公开展示信息。'],
    sourceOrg: '官方人才网', firstSeen: '2024-05-05', externalUrl: 'https://example.com/company/c5',
    jobs: [{ id: 'j2', title: '内容编辑', meta: '杭州 · 1–3年', salary: '8–13K' }],
  },
};

// ---------- 政策 ----------
const POLICIES = {
  p1: {
    id: 'p1', category: '求职补贴', tag: '求职补贴', tagTone: 'teal',
    title: '2026 年高校毕业生一次性求职创业补贴申领指南',
    org: '市人力资源和社会保障局', date: '2026-01-15', syncTime: '2026-07-24 08:00',
    summary: '符合条件的困难毕业生可申领一次性求职创业补贴,本文说明申领条件、材料与流程。',
    source: '市人社局', foot: '发布 3 天前 · 阅读 1.2k',
    aiSummary: '面向困难高校毕业生的一次性求职创业补贴,说明申领条件、所需材料与办理流程。',
    targetGroup: '有就业创业意愿并积极求职的困难高校毕业生(毕业年度为 2026 年)。',
    subsidies: [{ type: '一次性求职创业补贴', amount: '按当地标准' }],
    steps: ['在就业服务系统提交申请', '上传毕业证、困难证明等材料', '审核通过后补贴发放至本人账户'],
    officialUrl: 'https://example.gov.cn/policy/p1',
  },
  p2: {
    id: 'p2', category: '创业扶持', tag: '创业扶持', tagTone: 'wheat',
    title: '创业担保贷款及贴息政策解读',
    org: '省人力资源和社会保障厅', date: '2026-01-10', syncTime: '2026-07-24 08:00',
    summary: '个人最高可申请 30 万元创业担保贷款,财政给予贴息,符合条件的小微企业同样适用。',
    source: '省人社厅', foot: '发布 1 周前 · 阅读 860',
    aiSummary: '个人最高 30 万元创业担保贷款并享财政贴息,小微企业按规定同样适用。',
    targetGroup: '符合条件的创业个人及小微企业。',
    subsidies: [{ type: '个人创业担保贷款', amount: '最高 30 万元' }],
    steps: ['向经办银行提出申请', '提交营业执照/创业证明等材料', '审核通过后放款并按规定贴息'],
    officialUrl: 'https://example.gov.cn/policy/p2',
  },
  p3: {
    id: 'p3', category: '应届生', tag: '应届生', tagTone: '',
    title: '应届毕业生就业报到证取消后的手续办理',
    org: '教育部', date: '2026-01-05', syncTime: '2026-07-24 08:00',
    summary: '报到证取消后,档案转递、就业登记等手续如何办理,一文说清。',
    source: '教育部', foot: '发布 2 周前 · 阅读 3.4k',
    aiSummary: '报到证取消后,档案转递与就业登记等手续的办理方式说明。',
    targetGroup: '2026 届及以后的高校毕业生。',
    subsidies: [],
    steps: ['了解档案转递去向', '完成就业登记', '如需可咨询就业服务窗口'],
    officialUrl: 'https://example.gov.cn/policy/p3',
  },
};

function toList(map) {
  return Object.keys(map).map((k) => map[k]);
}

module.exports = {
  JOBS, FAIRS, COMPANIES, POLICIES,
  jobList: () => toList(JOBS),
  fairList: () => toList(FAIRS),
  companyList: () => toList(COMPANIES),
  policyList: () => toList(POLICIES),
  jobById: (id) => JOBS[id] || null,
  fairById: (id) => FAIRS[id] || null,
  companyById: (id) => COMPANIES[id] || null,
  policyById: (id) => POLICIES[id] || null,
};

