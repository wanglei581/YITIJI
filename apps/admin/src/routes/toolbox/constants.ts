import type {
  KioskAppLaunchMode,
  KioskAppPlacement,
  ToolboxAllowedHostPurpose,
  ToolboxAllowedHostStatus,
  ToolboxMicroAppCategory,
  ToolboxMicroAppPriority,
  ToolboxMicroAppRiskLevel,
} from '@ai-job-print/shared'

export const ICON_OPTIONS = [
  { value: 'wrench', label: '工具' },
  { value: 'file-text', label: '文档' },
  { value: 'printer', label: '打印' },
  { value: 'sparkles', label: 'AI' },
  { value: 'book-open', label: '指南' },
  { value: 'help-circle', label: '帮助' },
]

export const PLACEMENT_OPTIONS: { value: KioskAppPlacement; label: string }[] = [
  { value: 'toolbox', label: '百宝箱' },
  { value: 'smart_campus', label: '智慧校园' },
]

export const LAUNCH_MODE_OPTIONS: { value: KioskAppLaunchMode; label: string; placeholder: string }[] = [
  { value: 'internal_route', label: '站内页面', placeholder: '/resume/source' },
  { value: 'external_url', label: '外部 H5', placeholder: 'https://trusted.example.com/app' },
  { value: 'qr_code', label: '二维码', placeholder: '/api/v1/assets/app-qr.png' },
  { value: 'mini_program_qr', label: '小程序码', placeholder: '/api/v1/assets/mini-program.png' },
]

export const CATEGORY_OPTIONS: { value: ToolboxMicroAppCategory; label: string }[] = [
  { value: 'print', label: '打印服务' },
  { value: 'exam', label: '考试练习' },
  { value: 'career', label: '求职辅助' },
  { value: 'legal', label: '风险审查' },
  { value: 'hr', label: 'HR 知识' },
  { value: 'campus', label: '校园服务' },
  { value: 'life', label: '生活服务' },
]

export const PRIORITY_OPTIONS: { value: ToolboxMicroAppPriority; label: string }[] = [
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
]

export const RISK_OPTIONS: { value: ToolboxMicroAppRiskLevel; label: string }[] = [
  { value: 'low', label: '低风险' },
  { value: 'medium', label: '中风险' },
  { value: 'high', label: '高风险' },
  { value: 'restricted', label: '受限' },
]

export const HOST_PURPOSE_OPTIONS: { value: ToolboxAllowedHostPurpose; label: string }[] = [
  { value: 'web_app', label: '外部 H5' },
  { value: 'qr_target', label: '二维码目标' },
  { value: 'asset', label: '静态资源' },
]

export const HOST_REVIEW_OPTIONS: { value: Exclude<ToolboxAllowedHostStatus, 'pending_review'>; label: string }[] = [
  { value: 'active', label: '通过' },
  { value: 'suspended', label: '暂停' },
  { value: 'expired', label: '过期' },
  { value: 'archived', label: '归档' },
]

export const STATUS_LABELS: Record<string, string> = {
  planned: '规划中',
  draft: '草稿',
  submitted: '待审核',
  approved: '已通过',
  published: '已发布',
  rejected: '已驳回',
  suspended: '已熔断',
  archived: '已归档',
  pending_review: '待审核',
  active: '已生效',
  expired: '已过期',
}

export const BLOCK_REASON_LABELS: Record<string, string> = {
  app_not_approved: '版本尚未审核通过，不能发布。',
  app_suspended: '微应用已熔断，不能发布。',
  app_archived: '微应用已归档，不能发布。',
  self_review: '提交人与审核人不能相同。',
  host_required: '外部地址缺少可审核目标域名。',
  host_not_allowed: '目标域名未进入 DB 审核表。',
  host_not_active: '目标域名尚未审核生效。',
  host_expired: '目标域名白名单已过期。',
  host_suspended: '目标域名已暂停。',
  host_local_or_private: '不能使用本地或内网地址。',
  content_blocked: '标题或说明包含非合规招聘闭环文案。',
  missing_disclaimer: '高风险或受限应用缺少免责声明。',
  forbidden_capability: '申请了平台禁止的能力。',
  external_url_disabled: '服务端未开启外部 H5 总开关。',
  invalid_target_url: '目标地址不是合法 HTTPS 地址。',
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value)
}
