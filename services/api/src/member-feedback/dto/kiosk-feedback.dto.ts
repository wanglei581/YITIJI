import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import type { FeedbackCategory } from '../member-feedback.types'

/**
 * 一体机匿名反馈提交面的封闭词表。
 *
 * 为什么不让客户端直接传 category：一体机是公共位设备、免登录，提交面越窄越好。
 * 客户端只能从下面这张表里选一个 issueCode，category 由服务端映射得到 ——
 * 匿名面因此在协议层就无法表达打印/扫描域以外的诉求，比「校验 category 白名单」更紧。
 *
 * 词表覆盖两处真实入口：
 *   - P06 s7 打印完成页问题上报：页数不对 / 发黑发花 / 卡住没出完 / 其他
 *   - P39 打印 Hub 反馈弹层：缺纸 / 质量 / 扫描 / 上传 / 费用 / 其他
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
}

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

  @IsOptional()
  @IsString()
  @MaxLength(80)
  relatedPrintTaskId?: string

  @IsOptional()
  @IsString()
  @MaxLength(80)
  relatedScanTaskId?: string
}
