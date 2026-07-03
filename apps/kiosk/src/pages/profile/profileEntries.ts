import {
  BellIcon,
  BotIcon,
  BoxIcon,
  BriefcaseIcon,
  CalendarIcon,
  CopyIcon,
  ExternalLinkIcon,
  EyeIcon,
  FilesIcon,
  FileTextIcon,
  GiftIcon,
  HeartIcon,
  HelpCircleIcon,
  LandmarkIcon,
  LayoutTemplateIcon,
  MessageSquareIcon,
  PackageIcon,
  PrinterIcon,
  QrCodeIcon,
  RepeatIcon,
  ScanLineIcon,
  SettingsIcon,
  SparklesIcon,
  TicketIcon,
} from 'lucide-react'
import type { Entry, EntrySectionData } from './profileTypes'

// 1. 我的资产
const ASSETS: Entry[] = [
  { icon: FileTextIcon, iconBg: 'bg-primary-50', iconColor: 'text-primary-600', label: '我的简历', route: '/me/resumes' },
  { icon: FilesIcon,    iconBg: 'bg-primary-50',    iconColor: 'text-primary-600',    label: '我的文档', route: '/me/documents' },
  { icon: SparklesIcon, iconBg: 'bg-plum-soft',  iconColor: 'text-plum',  label: 'AI服务记录', route: '/me/ai-records' },
  { icon: PrinterIcon,  iconBg: 'bg-warning-bg',   iconColor: 'text-warning-fg',   label: '打印订单', route: '/me/print-orders' },
  { icon: HeartIcon,    iconBg: 'bg-error-bg',    iconColor: 'text-error-fg',    label: '我的收藏', route: '/me/favorites' },
  { icon: TicketIcon,   iconBg: 'bg-success-bg', iconColor: 'text-success-fg', label: '我的权益', route: '/me/benefits' },
]

// 2. 常用服务（均跳转既有功能页）
const SERVICES: Entry[] = [
  { icon: SparklesIcon,        iconBg: 'bg-primary-50', iconColor: 'text-primary-600', label: 'AI简历服务', route: '/resume/source' },
  { icon: LayoutTemplateIcon,  iconBg: 'bg-plum-soft',  iconColor: 'text-plum',  label: '简历模板',   route: '/resume/templates' },
  { icon: PrinterIcon,         iconBg: 'bg-primary-50',    iconColor: 'text-primary-600',    label: '文档打印',   route: '/print/upload' },
  { icon: CopyIcon,            iconBg: 'bg-neutral-100',   iconColor: 'text-neutral-700',    label: '打印扫描',   route: '/print-scan' },
  { icon: ScanLineIcon,        iconBg: 'bg-info-bg',    iconColor: 'text-info',    label: '扫描文件',   route: '/scan/start' },
  { icon: BriefcaseIcon,       iconBg: 'bg-info-bg',     iconColor: 'text-info',     label: '岗位信息',   route: '/jobs' },
  { icon: CalendarIcon,        iconBg: 'bg-success-bg',   iconColor: 'text-success-fg',   label: '招聘会',     route: '/job-fairs' },
  { icon: BotIcon,             iconBg: 'bg-plum-soft',  iconColor: 'text-plum',  label: 'AI助手',     route: '/assistant' },
]

// 3. 招聘会与活动（外部来源信息入口 / 记录）
// 浏览 / 外部跳转记录跨类型（岗位/招聘会/政策/企业），由 /me/activity 两 Tab 页承载。
// 来源平台后续动作与结果以来源平台为准，本系统不记录。
const FAIRS: Entry[] = [
  { icon: EyeIcon,          iconBg: 'bg-info-bg',     iconColor: 'text-info',     label: '浏览记录',     route: '/me/activity' },
  { icon: ExternalLinkIcon, iconBg: 'bg-primary-50',    iconColor: 'text-primary-600',    label: '外部跳转记录', route: '/me/activity?tab=jump' },
  { icon: QrCodeIcon,       iconBg: 'bg-plum-soft',  iconColor: 'text-plum',  label: '招聘会扫码凭证',     tag: '建设中' },
  { icon: GiftIcon,         iconBg: 'bg-error-bg',    iconColor: 'text-error-fg',    label: '权益活动',           route: '/activities?source=fair' },
]

// 4. 权益活动与服务套餐（均建设中，不接支付）
const BENEFITS: Entry[] = [
  { icon: TicketIcon,   iconBg: 'bg-error-bg',    iconColor: 'text-error-fg',    label: '权益活动',     route: '/activities' },
  { icon: PackageIcon,  iconBg: 'bg-warning-bg',   iconColor: 'text-warning-fg',   label: '求职打印套餐', tag: '建设中' },
  { icon: BoxIcon,      iconBg: 'bg-plum-soft',  iconColor: 'text-plum',  label: 'AI服务套餐',   tag: '建设中' },
  // 政策补贴指引：跳转既有政策服务页「就业政策」Tab（info-only 政策说明 / 材料清单 / 官方入口），不代办、不承诺到账。
  { icon: LandmarkIcon, iconBg: 'bg-success-bg', iconColor: 'text-success-fg', label: '政策补贴指引', route: '/renshi?tab=policy' },
]

// 5. 账户与服务（已接线入口直达本人消息、账号、帮助与反馈）
const ACCOUNT: Entry[] = [
  { icon: BellIcon,          iconBg: 'bg-primary-50',   iconColor: 'text-primary-600',   label: '消息通知', route: '/me/notifications' },
  // 账号设置轻量版：登录/游客状态、脱敏手机号、会话说明、协议入口、退出登录；不做换绑/注销。
  { icon: SettingsIcon,      iconBg: 'bg-neutral-100',  iconColor: 'text-neutral-600',   label: '账号设置', route: '/me/settings' },
  // 身份切换 = 退出当前账号后重新登录（不做多角色系统）；统一收口到账号设置页操作，避免数据串号。
  { icon: RepeatIcon,        iconBg: 'bg-plum-soft', iconColor: 'text-plum', label: '身份切换', route: '/me/settings' },
  { icon: HelpCircleIcon,    iconBg: 'bg-info-bg',   iconColor: 'text-info',   label: '帮助中心', route: '/help' },
  { icon: MessageSquareIcon, iconBg: 'bg-warning-bg',  iconColor: 'text-warning-fg',  label: '意见反馈', route: '/me/feedback' },
]

export const SECTIONS: EntrySectionData[] = [
  { title: '我的资产', entries: ASSETS },
  { title: '常用服务', entries: SERVICES },
  { title: '招聘会与活动', entries: FAIRS },
  { title: '权益活动与服务套餐', entries: BENEFITS },
  { title: '账户与服务', entries: ACCOUNT },
]
