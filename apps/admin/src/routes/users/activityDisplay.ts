import type { AdminUserActivityItem } from '@ai-job-print/shared'
import { auditTerminalText } from '../audit/auditPresentation'
import { taskStatusText } from '../orders/orderDisplay'

export interface ActivityText {
  label: string
  title?: string
}

/** 文件用途。resume_upload 用「上传简历」，与用户详情示例一致；其余沿用文件页中文名。 */
const FILE_PURPOSE_LABELS: Record<string, string> = {
  resume_upload: '上传简历',
  resume_scan: '简历扫描',
  id_scan: '身份证',
  print_doc: '打印文档',
  fair_material: '招聘会资料',
  cover_letter: '求职信',
  partner_profile: '机构资料',
  partner_image: '岗位图片',
  partner_video: '机构视频',
  job_fair_material: '招聘会资料',
  screensaver_material: '宣传屏素材',
  admin_upload: '管理员上传',
  temp: '临时文件',
  contract_upload: '合同上传',
  contract_review_report: '合同风险提示报告',
  signature_image: '签名图片',
  member_data_export: '会员数据导出',
  self_assessment_report: '自我探索报告',
}

/** 与 services/api/src/files/file-validation.ts 的 MIME_EXTS 一致。 */
const MIME_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WEBP',
  'video/mp4': 'MP4',
  'video/webm': 'WEBM',
  'text/plain': 'TXT',
  'text/markdown': 'MD',
  'application/json': 'JSON',
}

/** FileStatus。active 是上传完成，不是账号「正常」。 */
const FILE_STATUS_LABELS: Record<string, string> = {
  uploading: '上传中',
  active: '上传完成',
  quarantined: '已隔离',
  deleted: '已删除',
}

/** 一体机「我的 AI 记录」的种类名；草稿、确认稿、原始填写、诊断提交来自服务端 kind 注释。 */
const AI_KIND_LABELS: Record<string, string> = {
  parse: '简历诊断',
  optimize: '简历优化',
  generate: 'AI 简历生成',
  job_fit: '简历对照',
  career_plan: '职业规划建议',
  fair_visit_plan: '招聘会准备单',
  self_assessment: '自我探索 / 个人倾向参考（仅本人可见）',
  optimize_draft: '简历优化草稿',
  optimize_confirmed: '简历优化确认稿',
  generate_input: '简历生成时的原始填写',
  parse_intent: '简历诊断提交',
}

const AI_STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  processing: '处理中',
  completed: '已完成',
  failed: '失败',
}

/** resume-parse-submission.service.ts 的 PHASES。unknown 是租约结束仍无结果。 */
const PARSE_INTENT_PHASE_LABELS: Record<string, string> = {
  quota_pending: '等待额度',
  admitted: '已受理',
  provider_started: '模型处理中',
  completed: '已完成',
  revoked: '已撤回',
  unknown: '结果未确认',
}

const TARGET_LABELS: Record<string, string> = {
  job: '岗位',
  job_fair: '招聘会',
  policy: '政策',
  company_profile: '企业',
  fair_company: '参展企业',
}

const JUMP_ACTION_LABELS: Record<string, string> = {
  external_apply: '打开来源投递入口',
  external_appointment: '打开来源预约入口',
  external_checkin_open: '打开来源签到入口',
  external_open: '打开来源入口',
}

function unknown(value: string): ActivityText {
  return { label: `未归类（${value}）`, title: value }
}

function knownOrUnknown(table: Record<string, string>, value: string): ActivityText {
  if (!Object.prototype.hasOwnProperty.call(table, value)) return unknown(value)
  return { label: table[value] }
}

type ActivityFields = Pick<AdminUserActivityItem, 'type'> & Partial<Pick<AdminUserActivityItem, 'category' | 'status' | 'action'>>

export function activityCategoryText(activity: ActivityFields): ActivityText {
  const category = activity.category
  if (!category) return { label: '—' }
  if (activity.type === 'file') {
    const colon = category.indexOf(':')
    const purpose = colon === -1 ? category : category.slice(0, colon)
    const mime = colon === -1 ? '' : category.slice(colon + 1)
    const purposeLabel = Object.prototype.hasOwnProperty.call(FILE_PURPOSE_LABELS, purpose) ? FILE_PURPOSE_LABELS[purpose] : undefined
    if (!purposeLabel) return unknown(category)
    if (!mime) return { label: purposeLabel }
    const mimeLabel = Object.prototype.hasOwnProperty.call(MIME_LABELS, mime) ? MIME_LABELS[mime] : undefined
    return mimeLabel
      ? { label: `${purposeLabel}（${mimeLabel}）`, title: category }
      : { label: `${purposeLabel}（${mime}）`, title: category }
  }
  if (activity.type === 'ai') return knownOrUnknown(AI_KIND_LABELS, category)
  if (activity.type === 'browse' || activity.type === 'external_jump') return knownOrUnknown(TARGET_LABELS, category)
  return unknown(category)
}

export function activityStatusText(activity: ActivityFields): ActivityText {
  const status = activity.status
  if (!status) return { label: '—' }
  if (activity.type === 'print') {
    const view = taskStatusText(status)
    return { label: view.label, title: view.title }
  }
  if (activity.type === 'file') return knownOrUnknown(FILE_STATUS_LABELS, status)
  if (activity.type === 'ai' && activity.category === 'parse_intent') {
    if (status === 'unknown') return { label: PARSE_INTENT_PHASE_LABELS.unknown, title: status }
    return knownOrUnknown(PARSE_INTENT_PHASE_LABELS, status)
  }
  if (activity.type === 'ai') return knownOrUnknown(AI_STATUS_LABELS, status)
  return unknown(status)
}

export function activityActionText(activity: ActivityFields): ActivityText {
  const action = activity.action
  if (!action) return { label: '—' }
  if (activity.type === 'external_jump') return knownOrUnknown(JUMP_ACTION_LABELS, action)
  return unknown(action)
}

/** 最近活动接口没有终端编号，只给内部 ID。完整值放悬停。 */
export function activityTerminalText(terminalId: string | null): ActivityText {
  if (!terminalId) return { label: '—' }
  return { label: auditTerminalText(terminalId, {}), title: terminalId }
}
