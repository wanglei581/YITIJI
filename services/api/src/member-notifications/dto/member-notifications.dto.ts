import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export const NOTIFICATION_CATEGORIES = ['system', 'print', 'ai', 'feedback'] as const
export const BROADCAST_CATEGORIES = ['system', 'maintenance', 'notice'] as const
export const NOTIFICATION_RELATED_TYPES = ['feedback_ticket', 'print_task', 'ai_resume_result'] as const

export class CreateBroadcastDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  title!: string

  @IsString()
  @MinLength(2)
  @MaxLength(800)
  content!: string

  @IsOptional()
  @IsIn(BROADCAST_CATEGORIES)
  category?: typeof BROADCAST_CATEGORIES[number]
}

export class CreateMemberNotificationInput {
  @IsString()
  @IsNotEmpty()
  endUserId!: string

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  title!: string

  @IsString()
  @MinLength(2)
  @MaxLength(500)
  content!: string

  @IsIn(NOTIFICATION_CATEGORIES)
  category!: typeof NOTIFICATION_CATEGORIES[number]

  @IsOptional()
  @IsIn(NOTIFICATION_RELATED_TYPES)
  relatedType?: typeof NOTIFICATION_RELATED_TYPES[number]

  @IsOptional()
  @IsString()
  @MaxLength(80)
  relatedId?: string
}
