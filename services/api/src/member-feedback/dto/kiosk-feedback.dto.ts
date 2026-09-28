import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'
import type { FeedbackCategory } from '../member-feedback.types'

/**
 * 一体机匿名反馈提交面的封闭词表。
 *
 * 为什么不让客户端直接传 category：一体机是公共位设备、免登录，提交面越窄越好。
 * 客户端只能从下面这张表里选一个 issueCode，category 由服务端映射得到 ——
 * 匿名面因此在协议层就无法表达打印/扫描域以外的诉求，比「校验 category 白名单」更紧。
 * 唯一例外是 ai_content_complaint（C3）：生成式 AI 服务须设便捷的投诉入口
 * （《生成式人工智能服务管理暂行办法》第十五条），没登录的人也要能投诉。
 *
 * 词表覆盖三处真实入口：
 *   - P06 s7 打印完成页问题上报：页数不对 / 发黑发花 / 卡住没出完 / 其他
 *   - P39 打印 Hub 反馈弹层：缺纸 / 质量 / 扫描 / 上传 / 费用 / 其他
 *   - AI 内容投诉（C3，页面入口另排）
 */
export const KIOSK_FEEDBACK_ISSUE_CODES = [
  'print_page_count_mismatch',
  'print_quality_defect',
  'print_incomplete_or_jam',
  'print_other',
  'device_out_of_paper',
  'scan_issue',
  'upload_issue',
  'billing_issue',
  'other',
  'ai_content_complaint',
] as const

export type KioskFeedbackIssueCode = typeof KIOSK_FEEDBACK_ISSUE_CODES[number]

/** issueCode → (既有 FeedbackCategory 枚举值, 后台可读标题)。 */
export const KIOSK_FEEDBACK_ISSUE_MAP: Record<
  KioskFeedbackIssueCode,
  { category: FeedbackCategory; label: string }
> = {
  print_page_count_mismatch: { category: 'print', label: '打印页数与预期不符' },
  print_quality_defect: { category: 'print', label: '打印质量问题（发黑/发花）' },
  print_incomplete_or_jam: { category: 'device', label: '打印卡住未出完' },
  print_other: { category: 'print', label: '其他打印问题' },
  device_out_of_paper: { category: 'device', label: '设备缺纸' },
  scan_issue: { category: 'file_process', label: '扫描问题' },
  upload_issue: { category: 'file_process', label: '上传问题' },
  billing_issue: { category: 'general', label: '费用问题' },
  other: { category: 'general', label: '其他问题' },
  ai_content_complaint: { category: 'ai_content', label: 'AI 内容投诉' },
}

/** 匿名面唯一允许留手机号的问题类型：投诉人要能收到处理结果；其余类型仍一律不收联系方式。 */
export const KIOSK_FEEDBACK_CONTACT_ALLOWED: readonly KioskFeedbackIssueCode[] = ['ai_content_complaint']

/** 打印完成页满意度三档。 */
export const KIOSK_FEEDBACK_SATISFACTIONS = ['good', 'fair', 'bad'] as const
export type KioskFeedbackSatisfaction = typeof KIOSK_FEEDBACK_SATISFACTIONS[number]

export const KIOSK_FEEDBACK_SATISFACTION_LABEL: Record<KioskFeedbackSatisfaction, string> = {
  good: '满意',
  fair: '一般',
  bad: '不满意',
}

/** 自由文本上限。比会员端 500 更短：匿名面不做长文诉求，只做现场问题定位。 */
export const KIOSK_FEEDBACK_CONTENT_MAX = 300

export class CreateKioskFeedbackDto {
  /** 必填：匿名限流与关联任务归属都按终端收敛，没有终端就无法约束滥用。 */
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  terminalId!: string

  @IsOptional()
  @IsIn(KIOSK_FEEDBACK_ISSUE_CODES)
  issueCode?: KioskFeedbackIssueCode

  @IsOptional()
  @IsIn(KIOSK_FEEDBACK_SATISFACTIONS)
  satisfaction?: KioskFeedbackSatisfaction

  /** 可选自由文本。长度上限在此拦第一道，清洗与 PII 拒绝在 service 里做。 */
  @IsOptional()
  @IsString()
  @MaxLength(KIOSK_FEEDBACK_CONTENT_MAX)
  content?: string

  /** 选填，只对 KIOSK_FEEDBACK_CONTACT_ALLOWED 里的类型接收（service 校验），加密落库。 */
  @IsOptional()
  @Matches(/^1[3-9]\d{9}$/)
  contactPhone?: string

  @IsOptional()
  @IsString()
  @MaxLength(80)
  relatedPrintTaskId?: string

  @IsOptional()
  @IsString()
  @MaxLength(80)
  relatedScanTaskId?: string
}
