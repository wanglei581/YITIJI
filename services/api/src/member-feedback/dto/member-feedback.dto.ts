import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'

// ai_content（C3）：AI 内容投诉。个人信息请求不另开类别，会员走现有隐私请求（导出、删除）。
export const FEEDBACK_CATEGORIES = ['device', 'print', 'file_process', 'general', 'ai_content'] as const
export const FEEDBACK_STATUSES = ['pending', 'processing', 'replied', 'closed'] as const
/** 后台按提交方筛选用的白名单。member 与 anonymous_kiosk 的处置方式不同，需要分开成队列。 */
export const FEEDBACK_SUBMITTER_TYPES = ['member', 'anonymous_kiosk'] as const

export class CreateFeedbackDto {
  @IsIn(FEEDBACK_CATEGORIES)
  category!: typeof FEEDBACK_CATEGORIES[number]

  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  content!: string

  @IsOptional()
  @Matches(/^1[3-9]\d{9}$/)
  contactPhone?: string

  @IsOptional()
  @IsString()
  @MaxLength(80)
  terminalId?: string

  @IsOptional()
  @IsString()
  @MaxLength(80)
  relatedPrintTaskId?: string
}

export class AddFeedbackReplyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  content!: string
}

export class UpdateFeedbackStatusDto {
  @IsIn(FEEDBACK_STATUSES)
  status!: typeof FEEDBACK_STATUSES[number]
}
