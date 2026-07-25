import type { Entry, EntrySectionData } from './profileTypes'

// 「我的」页入口配置。只展示已接真能力，不保留重复入口或建设中占位。

// 1. 我的资产
const ASSETS: Entry[] = [
  { icon: 'resume', tone: 'teal', label: '我的简历', desc: '原始 / 诊断 / 优化版', route: '/me/resumes' },
  { icon: 'files', tone: 'slate', label: '我的文档', desc: '扫描件、证明材料', route: '/me/documents' },
  { icon: 'sparkle', tone: 'plum', label: 'AI服务记录', desc: '建议、面试、问答', route: '/me/ai-records' },
  { icon: 'receipt', tone: 'wheat', label: '打印订单', desc: '取件码、打印状态', route: '/me/print-orders' },
  { icon: 'heart', tone: 'rose', label: '我的收藏', desc: '岗位、招聘会、政策', route: '/me/favorites' },
  { icon: 'ticket', tone: 'clay', label: '我的权益', desc: '券与活动权益', route: '/me/benefits' },
]

// 2. 常用服务（均跳转既有功能页）
const SERVICES: Entry[] = [
  { icon: 'sparkle', tone: 'teal', label: 'AI简历服务', desc: '诊断与优化', route: '/resume/source' },
  { icon: 'book', tone: 'plum', label: '简历模板', desc: '选择正式模板', route: '/resume/templates' },
  { icon: 'printer', tone: 'slate', label: '文档打印', desc: '上传与参数设置', route: '/print/upload' },
  { icon: 'swap', tone: 'ink', label: '打印扫描', desc: '查看服务中心', route: '/print-scan' },
  { icon: 'scan', tone: 'slate', label: '扫描文件', desc: '进入扫描流程', route: '/scan/start' },
  { icon: 'briefcase', tone: 'clay', label: '岗位信息', desc: '第三方或官方来源', route: '/jobs' },
  { icon: 'fair', tone: 'wheat', label: '招聘会', desc: '第三方或官方场次', route: '/job-fairs' },
  { icon: 'robot', tone: 'teal', label: 'AI助手', desc: '文字与语音咨询', route: '/assistant' },
]

// 3. 来源与活动（外部来源信息入口 / 记录）
// 浏览 / 外部跳转记录跨类型（岗位/招聘会/政策/企业），由 /me/activity 两 Tab 页承载。
// 来源平台后续动作与结果以来源平台为准，本系统不记录。
const FAIRS: Entry[] = [
  { icon: 'eye', tone: 'slate', label: '浏览记录', desc: '岗位、招聘会、政策、企业', route: '/me/activity' },
  { icon: 'external', tone: 'teal', label: '外部跳转记录', desc: '本人离场跳转记录', route: '/me/activity?tab=jump' },
]

// 4. 权益与政策（均为既有真实入口）
const BENEFITS: Entry[] = [
  { icon: 'ticket', tone: 'rose', label: '权益活动', desc: '查看正式活动入口', route: '/activities' },
  // 政策补贴指引：跳转既有政策服务页「就业政策」Tab（info-only 政策说明 / 材料清单 / 官方入口），不代办、不承诺到账。
  { icon: 'policy', tone: 'wheat', label: '政策补贴指引', desc: '政策说明与官方入口', route: '/renshi?tab=policy' },
]

// 5. 账户与支持（已接线入口直达本人消息、账号、帮助与反馈）
const ACCOUNT: Entry[] = [
  { icon: 'bell', tone: 'ink', label: '消息通知', desc: '查看本人消息', route: '/me/notifications' },
  // 账号设置轻量版：登录/游客状态、脱敏手机号、会话说明、协议入口、退出登录；不做换绑/注销。
  { icon: 'settings', tone: 'ink', label: '账号设置', desc: '登录状态与会话说明', route: '/me/settings' },
  { icon: 'help', tone: 'ink', label: '帮助中心', desc: '使用说明与服务边界', route: '/help' },
  { icon: 'feedback', tone: 'ink', label: '意见反馈', desc: '提交本人服务反馈', route: '/me/feedback' },
]

export const SECTIONS: EntrySectionData[] = [
  { title: '我的资产', subtitle: '本人简历、文档、订单与收藏。', layout: 'grid', rail: 'teal', entries: ASSETS },
  { title: '常用服务', subtitle: '直达既有功能页。', layout: 'chips', rail: 'slate', entries: SERVICES },
  { title: '招聘会与活动', subtitle: '外部来源信息入口与本人记录。', layout: 'chips', rail: 'wheat', entries: FAIRS },
  { title: '权益与政策', subtitle: '查看本人权益、真实活动和官方政策入口。', layout: 'chips', rail: 'plum', entries: BENEFITS },
  { title: '账户与支持', subtitle: '本人消息、账号、帮助与反馈入口。', layout: 'account', rail: 'teal', entries: ACCOUNT },
]
