import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

export type ReviewAction = 'reviewing' | 'approve' | 'reject'

export class ReviewActionDto {
  @IsIn(['reviewing', 'approve', 'reject'])
  action!: ReviewAction

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string
}
