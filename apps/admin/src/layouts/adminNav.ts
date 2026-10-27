import type { NavItem } from '@ai-job-print/ui'
import {
  AlertTriangleIcon,
  BotIcon,
  BriefcaseIcon,
  Building2Icon,
  ClipboardListIcon,
  FileTextIcon,
  FolderIcon,
  GaugeIcon,
  GiftIcon,
  LayoutDashboardIcon,
  MonitorIcon,
  MonitorPlayIcon,
  PrinterIcon,
  ScaleIcon,
  ScrollTextIcon,
  ShieldIcon,
  UsersIcon,
  WalletIcon,
} from 'lucide-react'

/** 地址 → 侧栏高亮 key。合并后的页高亮所在菜单；账号设置不进侧栏，单独占一个 key，避免误亮工作台。 */
export const PATH_TO_KEY: Record<string, string> = {
  '/': 'dashboard',
  '/screen': 'screen',
  '/partners': 'partners',
  '/devices': 'devices',
  '/terminals': 'devices',
  '/printers': 'devices',
  '/peripherals': 'devices',
  '/print-scan': 'print-scan',
  '/alerts': 'alerts',
  '/member-feedback': 'alerts',
  '/member-notifications': 'alerts',
  '/screensaver': 'screensaver',
  '/toolbox': 'screensaver',
  '/smart-campus': 'screensaver',
  '/job-materials': 'job-materials',
  '/ai-services': 'ai-services',
  '/ai-config': 'ai-services',
  '/orders': 'orders',
  '/billing': 'orders',
  '/member-benefits': 'member-benefits',
  '/benefit-activities': 'member-benefits',
  '/policy-sources': 'policy-sources',
  '/job-sources': 'job-sources',
  '/fair-sources': 'job-sources',
  '/fairs': 'job-sources',
  '/companies': 'job-sources',
  '/sync-sources': 'job-sources',
  '/users': 'users',
  '/permissions': 'permissions',
  '/files': 'files',
  '/legal-docs': 'legal-docs',
  '/privacy-requests': 'legal-docs',
  '/audit': 'audit',
  '/import-batches': 'audit',
  '/account-settings': 'account-settings',
  // 3.15：线下机构整页停放，旧地址重定向到合作机构，侧栏同样高亮它。
  '/offline-agencies': 'partners',
}

/** 18 个菜单的落地地址。写成显式对象，不从 PATH_TO_KEY 反推。 */
export const KEY_TO_PATH: Record<string, string> = {
  dashboard: '/',
  screen: '/screen',
  partners: '/partners',
  devices: '/devices',
  'print-scan': '/print-scan',
  alerts: '/alerts',
  screensaver: '/screensaver',
  'job-materials': '/job-materials',
  'ai-services': '/ai-services',
  orders: '/orders',
  'member-benefits': '/member-benefits',
  'policy-sources': '/policy-sources',
  'job-sources': '/job-sources',
  users: '/users',
  permissions: '/permissions',
  files: '/files',
  'legal-docs': '/legal-docs',
  audit: '/audit',
}

export interface ConsoleTab {
  path: string
  label: string
}

export interface ConsoleTabGroup {
  key: string
  label: string
  tabs: ConsoleTab[]
}

/** 八个标签组。第一个标签是该菜单的默认地址。 */
export const TAB_GROUPS: ConsoleTabGroup[] = [
  {
    key: 'alerts',
    label: '告警与反馈',
    tabs: [
      { path: '/alerts', label: '告警中心' },
      { path: '/member-feedback', label: '意见反馈' },
      { path: '/member-notifications', label: '消息通知' },
    ],
  },
  {
    key: 'screensaver',
    label: '终端应用与展示',
    tabs: [
      { path: '/screensaver', label: '宣传屏' },
      { path: '/toolbox', label: '百宝箱' },
      { path: '/smart-campus', label: '智慧校园' },
    ],
  },
  {
    key: 'ai-services',
    label: 'AI服务',
    tabs: [
      { path: '/ai-services', label: 'AI服务管理' },
      { path: '/ai-config', label: 'AI大模型' },
    ],
  },
  {
    key: 'orders',
    label: '订单与计费',
    tabs: [
      { path: '/orders', label: '订单管理' },
      { path: '/billing', label: '计费与对账' },
    ],
  },
  {
    key: 'member-benefits',
    label: '会员权益',
    tabs: [
      { path: '/member-benefits', label: '会员权益' },
      { path: '/benefit-activities', label: '权益活动' },
    ],
  },
  {
    key: 'job-sources',
    label: '招聘紧急下架',
    tabs: [
      { path: '/job-sources', label: '岗位' },
      { path: '/fair-sources', label: '招聘会' },
      { path: '/fairs', label: '招聘会详情' },
      { path: '/companies', label: '企业' },
      { path: '/sync-sources', label: '接入通道' },
    ],
  },
  {
    key: 'legal-docs',
    label: '法务与数据权利',
    tabs: [
      { path: '/legal-docs', label: '法务文档版本' },
      { path: '/privacy-requests', label: '数据权利工单' },
    ],
  },
  {
    key: 'audit',
    label: '日志审计',
    tabs: [
      { path: '/audit', label: '日志审计' },
      { path: '/import-batches', label: 'Excel 导入记录' },
    ],
  },
]

const TAB_GROUP_BY_PATH: Record<string, ConsoleTabGroup> = {}
for (const group of TAB_GROUPS) {
  for (const tab of group.tabs) TAB_GROUP_BY_PATH[tab.path] = group
}

export function tabGroupForPath(pathname: string): ConsoleTabGroup | undefined {
  return TAB_GROUP_BY_PATH[pathname]
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: '工作台', icon: LayoutDashboardIcon, href: KEY_TO_PATH.dashboard },
  { key: 'screen', label: '数据大屏', icon: GaugeIcon, href: KEY_TO_PATH.screen },
  { key: 'partners', label: '合作机构', icon: Building2Icon, group: '客户与设备', href: KEY_TO_PATH.partners },
  { key: 'devices', label: '设备管理', icon: MonitorIcon, group: '客户与设备', href: KEY_TO_PATH.devices },
  { key: 'print-scan', label: '打印扫描运维', icon: PrinterIcon, group: '客户与设备', href: KEY_TO_PATH['print-scan'] },
  { key: 'alerts', label: '告警与反馈', icon: AlertTriangleIcon, group: '客户与设备', href: KEY_TO_PATH.alerts },
  { key: 'screensaver', label: '终端应用与展示', icon: MonitorPlayIcon, group: '终端与 AI', href: KEY_TO_PATH.screensaver },
  { key: 'job-materials', label: '求职材料库', icon: FileTextIcon, group: '终端与 AI', href: KEY_TO_PATH['job-materials'] },
  { key: 'ai-services', label: 'AI服务', icon: BotIcon, group: '终端与 AI', href: KEY_TO_PATH['ai-services'] },
  { key: 'orders', label: '订单与计费', icon: WalletIcon, group: '费用与权益', href: KEY_TO_PATH.orders },
  { key: 'member-benefits', label: '会员权益', icon: GiftIcon, group: '费用与权益', href: KEY_TO_PATH['member-benefits'] },
  { key: 'policy-sources', label: '政策信息源', icon: ScrollTextIcon, group: '内容安全', href: KEY_TO_PATH['policy-sources'] },
  { key: 'job-sources', label: '招聘紧急下架', icon: BriefcaseIcon, group: '内容安全', href: KEY_TO_PATH['job-sources'] },
  { key: 'users', label: '用户管理', icon: UsersIcon, group: '账号与合规', href: KEY_TO_PATH.users },
  { key: 'permissions', label: '权限管理', icon: ShieldIcon, group: '账号与合规', href: KEY_TO_PATH.permissions },
  { key: 'files', label: '文件管理', icon: FolderIcon, group: '账号与合规', href: KEY_TO_PATH.files },
  { key: 'legal-docs', label: '法务与数据权利', icon: ScaleIcon, group: '账号与合规', href: KEY_TO_PATH['legal-docs'] },
  { key: 'audit', label: '日志审计', icon: ClipboardListIcon, group: '账号与合规', href: KEY_TO_PATH.audit },
]
