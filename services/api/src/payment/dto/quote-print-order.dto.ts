import { IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import { PrintJobParamsDto } from '../../print-jobs/dto/create-print-job.dto'

/**
 * POST /orders/quote 入参（C5 / P0-1）。
 *
 * 与建单共用 PrintJobParamsDto 校验口径；报价**不落库**，只识别页数 + 依 PriceConfig 计算。
 * 绝不接受前端传入的 pages / billablePages / amountCents。
 */
export class QuotePrintOrderDto {
  @IsString()
  @IsNotEmpty()
  fileUrl!: string

  @IsOptional()
  @ValidateNested()
  @Type(() => PrintJobParamsDto)
  params?: PrintJobParamsDto
}
