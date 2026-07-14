import type { Entry, EntrySectionData } from './profileTypes'

// 「我的」页入口配置。
// 入口 label / route / 建设中标签保持既有业务合同不变；仅由入口页重组为 4188 目录排版。

// 1. 我的资产
const ASSETS: Entry[] = [
  { icon: 'resume', tone: 'teal', label: '我的简历', desc: '原始 / 诊断 / 优化版', route: '/me/resumes' },
  { icon: 'files', tone: 'slate', label: '我的文档', desc: '扫描件、证明材料', route: '/me/documents' },
  { icon: 'sparkle', tone: 'plum', label: 'AI服务记录', desc: '建议、面试、问答', route: '/me/ai-records' },
  { icon: 'receipt', tone: 'wheat', label: '打印订单', desc: '取件码、打印状态', route: '/me/print-orders' },
  { icon: 'heart', tone: 'rose', label: '我的收藏', desc: '岗位、招聘会、政策', route: '/me/favorites' },
  { icon: 'ticket', tone: 'clay', label: '我的权益', desc: '套餐、券、活动', route: '/me/benefits' },
]

// 2. 常用服务（均跳转既有功能页）
const SERVICES: Entry[] = [
  { icon: 'sparkle', tone: 'teal', label: 'AI简历服务', route: '/resume/source' },
  { icon: 'book', tone: 'plum', label: '简历模板', route: '/resume/templates' },
  { icon: 'printer', tone: 'slate', label: '文档打印', route: '/print/upload' },
  { icon: 'swap', tone: 'ink', label: '打印扫描', route: '/print-scan' },
  { icon: 'scan', tone: 'slate', label: '扫描文件', route: '/scan/start' },
  { icon: 'briefcase', tone: 'clay', label: '岗位信息', route: '/jobs' },
  { icon: 'fair', tone: 'wheat', label: '招聘会', route: '/job-fairs' },
  { icon: 'robot', tone: 'teal', label: 'AI助手', route: '/assistant' },
]

// 3. 来源与活动（外部来源信息入口 / 记录）
// 浏览 / 外部跳转记录跨类型（岗位/招聘会/政策/企业），由 /me/activity 两 Tab 页承载。
// 来源平台后续动作与结果以来源平台为准，本系统不记录。
const FAIRS: Entry[] = [
  { icon: 'eye', tone: 'slate', label: '浏览记录', route: '/me/activity' },
  { icon: 'external', tone: 'teal', label: '外部跳转记录', route: '/me/activity?tab=jump' },
  { icon: 'qr', tone: 'plum', label: '招聘会扫码凭证', tag: '建设中' },
  { icon: 'ticket', tone: 'rose', label: '权益活动', route: '/activities?source=fair' },
]

// 4. 权益活动与服务套餐（均建设中，不接支付）
const BENEFITS: Entry[] = [
  { icon: 'ticket', tone: 'rose', label: '权益活动', route: '/activities' },
  { icon: 'receipt', tone: 'wheat', label: '求职打印套餐', tag: '建设中' },
  { icon: 'sparkle', tone: 'plum', label: 'AI服务套餐', tag: '建设中' },
  // 政策补贴指引：跳转既有政策服务页「就业政策」Tab（info-only 政策说明 / 材料清单 / 官方入口），不代办、不承诺到账。
  { icon: 'policy', tone: 'wheat', label: '政策补贴指引', route: '/renshi?tab=policy' },
]

// 5. 账户与支持（已接线入口直达本人消息、账号、帮助与反馈）
const ACCOUNT: Entry[] = [
  { icon: 'bell', tone: 'ink', label: '消息通知', route: '/me/notifications' },
  // 账号设置轻量版：登录/游客状态、脱敏手机号、会话说明、协议入口、退出登录；不做换绑/注销。
  { icon: 'settings', tone: 'ink', label: '账号设置', route: '/me/settings' },
  // 身份切换 = 退出当前账号后重新登录（不做多角色系统）；统一收口到账号设置页操作，避免数据串号。
  { icon: 'swap', tone: 'ink', label: '身份切换', route: '/me/settings' },
  { icon: 'help', tone: 'ink', label: '帮助中心', route: '/help' },
  { icon: 'feedback', tone: 'ink', label: '意见反馈', route: '/me/feedback' },
]

export const SECTIONS: EntrySectionData[] = [
  { title: '我的资产', subtitle: '本人简历、文档、订单与收藏。', layout: 'grid', rail: 'teal', entries: ASSETS },
  { title: '常用服务', subtitle: '直达既有功能页。', layout: 'chips', rail: 'slate', entries: SERVICES },
  { title: '来源与活动', subtitle: '外部来源信息入口与本人记录。', layout: 'chips', rail: 'wheat', entries: [...FAIRS, ...BENEFITS] },
  { title: '账户与支持', subtitle: '消息、设置与帮助入口。', layout: 'account', rail: 'teal', entries: ACCOUNT },
]
