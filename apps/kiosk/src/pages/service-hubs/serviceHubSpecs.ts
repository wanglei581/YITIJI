import type { ServiceHubKey, ServiceHubSpec } from './serviceHubModel'

/**
 * 五份规格**机械抽自** docs/design/kiosk-redesign-2026-08-v2/16-service-hubs.html（2.0 稿）的 `const H`。
 * 抽取脚本：apps/kiosk/scripts/extract-service-hub-specs.mjs。其余四份稿改了重跑它；政策规格按 2026-11-05 契约维护。
 *
 * 手抄是漏掉诚实性声明最常见的来源——这批迁移里已经因为手抄漏过多次。
 * 一次历史教训写在这里：2026-09-10 的那版抽取**漏了稿里的 `quick`**（每个 hub 3 条
 * 「常用入口」），于是 15 条通往「我的」台账的真实入口（/me/resumes、/me/ai-records、
 * /me/activity、/interview/reports…）在迁移里静默消失。本文件把 quick 一并抽出为
 * `quickLinks`，缺一条就是丢一个入口。
 *
 * 同理，稿给每张卡标的图标键（`icon`）也在这里机械带出。2026-09-20 修复前它被丢弃，
 * 页面改用按标题正则猜图标，「校园招聘」因此显示成文档、「岗位匹配参考」显示成公文包。
 */
export const SERVICE_HUB_SPECS: Record<ServiceHubKey, ServiceHubSpec> = {
  resume: {
    eyebrow: 'AI简历服务',
    title: '把简历这件事，做得更清楚',
    subtitle: '从来源选择、诊断优化到生成、材料与打印，按你的目标进入对应步骤。',
    goals: [
      { label: '我有简历要体检', route: '/resume/source?intent=diagnose' },
      { label: '我没简历要新建', route: '/resume/generate' },
      { label: '我要对着岗位改', route: '/resume/source?intent=optimize' },
    ],
    sectionTitle: '八项简历能力',
    sectionHint: '先选目标，再进入真实流程',
    capabilities: [
      { title: 'AI简历诊断', description: '带走问题清单和改法', badge: 'AI 诊断改写', route: '/resume/source?intent=diagnose', kind: 'ai', icon: 'search' },
      { title: 'AI简历优化', description: '对着你的方向逐条看改写', badge: 'AI 优化改写', route: '/resume/source?intent=optimize', kind: 'ai', icon: 'edit' },
      { title: '从零生成简历', description: '带走一份可核对的草稿', badge: 'AI 起草简历', route: '/resume/generate', kind: 'ai', icon: 'file' },
      { title: '简历素材库', description: '按分类查看真实模板、标签与适用场景', badge: '模板目录', route: '/resume/templates', kind: 'info', icon: 'file' },
      { title: '职业规划', description: '带走下一步可以做的事', badge: 'AI 行动建议', route: '/resume/career-plan', kind: 'ai', icon: 'map' },
      { title: '求职材料', description: '按模板套填，带走求职信和自我介绍', badge: '模板生成', route: '/resume/materials', kind: 'info', icon: 'brief' },
      { title: '简历打印', description: '选择文件、核价后在本机打印', badge: '依赖打印机', route: '/print/upload?source=resume', kind: 'device', icon: 'printer' },
      { title: '简历对照', description: '填一份岗位要求，AI 对照你的简历', badge: 'AI 对照', route: '/resume/job-fit', kind: 'ai', icon: 'chart', go: '带走：对照报告' },
    ],
    quickLinks: [
      { title: '我的简历', description: '查看你名下的简历', route: '/me/resumes', kind: 'account', icon: 'user' },
      { title: 'AI服务记录', description: '查看诊断与优化记录', route: '/me/ai-records', kind: 'account', icon: 'bot' },
      { title: '自我探索', description: '完成职业倾向参考', route: '/resume/self-assessment/intro', kind: 'info', icon: 'chart' },
    ],
    truthTitle: '简历用不用，由你本人决定。',
    truth: '系统不代投、不替企业筛选或邀约。',
    noteTitle: '原件始终由你掌控',
    note: '生成的内容会标明供参考，不会覆盖原文件。',
  },
  jobs: {
    eyebrow: '岗位信息',
    title: '看清来源，再决定去哪里投',
    subtitle: '岗位来自第三方或官方来源。本机帮助筛选和理解，投递仍在来源平台完成。',
    goals: [
      { label: '找全职', route: '/jobs?category=fulltime' },
      { label: '找实习', route: '/jobs?category=intern' },
      { label: '找校招', route: '/jobs?category=campus' },
      { label: '找兼职', route: '/jobs?category=parttime' },
    ],
    sectionTitle: '岗位与来源入口',
    sectionHint: '岗位以进入后的真实加载为准',
    capabilities: [
      { title: '全职岗位', description: '按行业、地区与薪资范围筛选', badge: '第三方来源', route: '/jobs?category=fulltime', kind: 'info', icon: 'brief' },
      { title: '实习岗位', description: '查看面向在校生与应届生的机会', badge: '第三方来源', route: '/jobs?category=intern', kind: 'info', icon: 'brief' },
      { title: '兼职信息', description: '查看灵活就业与兼职来源信息', badge: '第三方来源', route: '/jobs?category=parttime', kind: 'info', icon: 'brief' },
      { title: '校园招聘岗位', description: '查看经审核发布的校招来源岗位', badge: '第三方来源', route: '/jobs?category=campus', kind: 'info', icon: 'brief' },
      { title: '全部岗位', description: '搜索并查看全部已审核来源岗位', badge: '真实加载', route: '/jobs', kind: 'info', icon: 'search' },
      { title: '企业信息', description: '先了解企业，再查看岗位来源', badge: '来源信息', route: '/companies', kind: 'info', icon: 'building' },
      { title: '岗位匹配参考', description: '简历与目标岗位逐项对照', badge: 'AI · 仅供参考', route: '/resume/job-fit', kind: 'ai', icon: 'chart' },
      { title: '线上招聘平台', description: '打开第三方平台，由你自行操作', badge: '外部来源', route: '/jobs/online-platforms', kind: 'info', icon: 'external' },
      { title: '线下招聘机构', description: '查看机构地址与到店咨询指引', badge: '线下咨询', route: '/offline-agencies', kind: 'info', icon: 'map' },
    ],
    quickLinks: [
      { title: '浏览记录', description: '查看看过的岗位', route: '/me/activity', kind: 'account', icon: 'user' },
      { title: '外部跳转', description: '查看打开过的来源入口', route: '/me/activity?tab=jump', kind: 'account', icon: 'external' },
      { title: '招聘会', description: '换一种线下找法', route: '/fairs-service', kind: 'info', icon: 'calendar' },
    ],
    truthTitle: '投递在来源平台完成。',
    truth: '本机记录你的浏览与外部跳转；投递进度由你自己填写，本机不掌握来源平台的处理结果。',
    noteTitle: '本机不代收简历',
    note: '不做企业筛选、面试邀约或Offer管理。',
  },
  fairs: {
    eyebrow: '招聘会',
    title: '先看场次，再准备到场',
    subtitle: '查看招聘会时间、地点和来源，准备简历与路线；预约在来源平台完成。',
    goals: [
      { label: '找近期场次', route: '/job-fairs' },
      { label: '准备到场', route: '/job-fairs/checkin' },
      { label: '准备材料', route: '/print-scan' },
    ],
    sectionTitle: '招聘会服务',
    sectionHint: '六个入口，覆盖会前与现场准备',
    capabilities: [
      { title: '招聘会列表', description: '查看真实场次、时间、地点与来源', badge: '真实加载', route: '/job-fairs', kind: 'info', icon: 'calendar' },
      { title: '校园招聘', description: '查看校园相关场次与企业信息', badge: '真实加载', route: '/campus', kind: 'info', icon: 'building' },
      { title: '到场指引', description: '核对来源预约与现场流程', badge: '无签到结果', route: '/job-fairs/checkin', kind: 'info', icon: 'map' },
      { title: '问AI顾问', description: '了解参会准备与现场沟通建议', badge: 'AI · 仅供参考', route: '/assistant', kind: 'ai', icon: 'bot' },
      { title: '简历服务', description: '诊断、优化或准备多份简历', badge: '进入简历中心', route: '/resume-service', kind: 'info', icon: 'file' },
      { title: '打印扫描', description: '先查看文件、格式与办理入口；出纸或扫描步骤进入后确认', badge: '进入后确认', route: '/print-scan', kind: 'info', icon: 'printer' },
    ],
    quickLinks: [
      { title: '浏览记录', description: '查看看过的招聘会', route: '/me/activity', kind: 'account', icon: 'user' },
      { title: '外部跳转', description: '查看打开过的来源入口', route: '/me/activity?tab=jump', kind: 'account', icon: 'external' },
      { title: '岗位信息', description: '同时查看来源岗位', route: '/jobs-service', kind: 'info', icon: 'brief' },
    ],
    truthTitle: '预约和投递由来源平台负责。',
    truth: '本机不代收简历，也不承诺外部活动结果。',
    noteTitle: '不显示虚构签到结果',
    note: '场次、参会企业和地图均以真实数据为准。',
  },
  interview: {
    eyebrow: 'AI面试训练',
    title: '把表达练熟，不替你下结论',
    subtitle: '模拟问答、自我探索、技巧与历史报告，用于练习和复盘，不代表真实面试结果。',
    goals: [
      { label: '马上练一场', route: '/interview/setup' },
      { label: '先看技巧', route: '/interview/tips' },
      { label: '回看报告', route: '/interview/reports' },
    ],
    sectionTitle: '面试与成长',
    sectionHint: '六个入口，按练习目标进入',
    capabilities: [
      { title: '开始模拟面试', description: '选择岗位类型与难度后进入训练', badge: 'AI · 练习', route: '/interview/setup', kind: 'ai', icon: 'mic' },
      { title: '职业自我探索', description: '了解优势、偏好与可尝试方向', badge: 'AI · 仅供参考', route: '/resume/self-assessment/intro', kind: 'ai', icon: 'chart' },
      { title: '职业规划建议', description: '根据经历与目标形成行动建议', badge: 'AI · 仅供参考', route: '/resume/career-plan', kind: 'ai', icon: 'map' },
      { title: '面试技巧', description: '查看通用问答与沟通要点', badge: '静态内容', route: '/interview/tips', kind: 'info', icon: 'file' },
      { title: '评估历史', description: '回看本人历次自我探索结果', badge: '本人记录', route: '/resume/self-assessment/history', kind: 'info', icon: 'chart' },
      { title: '行业薪资参考', description: '向通用AI顾问询问市场信息', badge: 'AI · 需核实', route: '/assistant', kind: 'ai', icon: 'bot' },
    ],
    quickLinks: [
      { title: 'AI服务记录', description: '查看本人AI调用记录', route: '/me/ai-records', kind: 'account', icon: 'bot' },
      { title: '训练报告', description: '查看模拟面试报告', route: '/interview/reports', kind: 'info', icon: 'chart' },
      { title: '简历服务', description: '先完善求职材料', route: '/resume-service', kind: 'info', icon: 'file' },
    ],
    truthTitle: 'AI训练不是企业面试。',
    truth: '不进行录用判断，不向企业推荐候选人。',
    noteTitle: '不排名，不预测录用',
    note: '报告仅供本人练习参考，不对外共享。',
  },
  // 2026-11-05 政策最小闭环取代稿 16 的政策规格；其余四份规格仍按原稿逐字对账。
  policy: {
    eyebrow: '查政策 · 由各发布机构自行审核发布',
    title: '你想看哪一类？',
    subtitle: '每条都写了条件、材料和去哪办，可以打印成一页清单。',
    goals: [
      { label: '应届高校毕业生', route: '/renshi?audience=graduate' },
      { label: '创业扶持', route: '/renshi?audience=startup' },
      { label: '灵活就业人员', route: '/renshi?audience=flexible' },
      { label: '困难群体就业援助', route: '/renshi?audience=hardship' },
      { label: '返乡务工人员', route: '/renshi?audience=migrant' },
      { label: '通用', route: '/renshi?audience=general' },
    ],
    sectionTitle: '选类别',
    sectionHint: '条数与最近标题从发布数据读取',
    capabilities: [],
    quickLinks: [
      { title: '政策收藏', description: '登录后查看本人账号收藏', route: '/me/favorites?tab=policy', kind: 'account', icon: 'user' },
    ],
    truthTitle: '政策由发布机构自行审核发布。',
    truth: '以官方原文为准。',
    noteTitle: '可以打印一页办事清单',
    note: '不判断能不能领。',
  },
}
