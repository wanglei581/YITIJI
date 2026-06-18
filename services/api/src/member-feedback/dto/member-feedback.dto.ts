import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'

export const FEEDBACK_CATEGORIES = ['device', 'print', 'file_process', 'general'] as const
export const FEEDBACK_STATUSES = ['pending', 'processing', 'replied', 'closed'] as const

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
