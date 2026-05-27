import { IsIn, IsOptional, IsString } from 'class-validator'

export class PatchTaskStatusDto {
  /** Terminal Agent reports one of these three status values. */
  @IsIn(['printing', 'completed', 'failed'])
  status!: 'printing' | 'completed' | 'failed'

  /** Present only when status = 'failed'. */
  @IsString()
  @IsOptional()
  errorCode?: string

  @IsString()
  @IsOptional()
  errorMessage?: string
}
