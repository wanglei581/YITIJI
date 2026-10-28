import { IsIn, IsOptional } from 'class-validator'

/** Existing list filters stay optional strings. Only the new flag is constrained. */
export class ListPrintScanTasksQueryDto {
  @IsOptional()
  type?: string

  @IsOptional()
  status?: string

  @IsOptional()
  terminalId?: string

  @IsOptional()
  page?: string

  @IsOptional()
  pageSize?: string

  @IsOptional()
  @IsIn(['1'], { message: '出纸未确认筛选无法识别，请重试' })
  unconfirmed?: string
}
