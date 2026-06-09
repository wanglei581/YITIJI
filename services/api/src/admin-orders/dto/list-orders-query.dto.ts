import { Type } from 'class-transformer'
import { IsOptional, IsString, IsIn, IsInt, Min, Max, MaxLength } from 'class-validator'

/**
 * Admin 订单列表查询。配合 main.ts ValidationPipe（whitelist + forbidNonWhitelisted + transform）：
 * 非法枚举 / 越界分页 / 未知字段 → 400。limit/offset 经 @Type 转 number。
 */
export class ListOrdersQueryDto {
  @IsOptional()
  @IsIn(['print', 'scan', 'photo', 'ai'])
  type?: string

  @IsOptional()
  @IsIn(['unpaid', 'paid', 'refunded', 'failed'])
  payStatus?: string

  @IsOptional()
  @IsIn(['pending', 'claimed', 'printing', 'completed', 'failed', 'cancelled'])
  taskStatus?: string

  /** 按订单号模糊匹配（contains）。 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  search?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number
}
