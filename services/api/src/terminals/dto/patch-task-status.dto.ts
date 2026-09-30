import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator'

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

  /**
   * 这一轮打印的 attempt。缺省表示老 Agent，按现有状态机处理。
   * 小于任务当前 attempt（failed→pending 条数）时服务端拒绝，不改状态。
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  attempt?: number
}
