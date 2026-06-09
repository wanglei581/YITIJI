import { Type } from 'class-transformer'
import { IsOptional, IsString, IsIn, IsInt, Min, Max, MaxLength } from 'class-validator'

/**
 * Admin 告警列表查询。分页用 page/pageSize；筛选 keyword/severity/status/type/terminalId。
 * 配合 ValidationPipe（whitelist + forbidNonWhitelisted + transform）：非法值/未知字段 → 400。
 */
export class ListAlertsQueryDto {
  /** 关键词：匹配 title / message / alertNo（contains）。 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  keyword?: string

  @IsOptional()
  @IsIn(['info', 'warning', 'critical'])
  severity?: string

  @IsOptional()
  @IsIn(['new', 'processing', 'resolved', 'ignored'])
  status?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  type?: string

  @IsOptional()
  @IsString()
  @MaxLength(64)
  terminalId?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number
}
