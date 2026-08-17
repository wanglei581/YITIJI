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

  /**
   * 目标终端（id 或 terminalCode）。黑白单面报价可省略（历史调用方兼容）。
   *
   * 请求彩色 / 双面时**必填**：报价要按彩色单价算钱，就必须先证明这台机器验过彩色，
   * 否则会出现「预览页显示彩色价 → 建单被拒」甚至更糟的错价。缺失时 OrderQuoteService
   * fail-closed 拒绝，不会静默按黑白计价蒙混过去。
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  terminalId?: string

  @IsOptional()
  @ValidateNested()
  @Type(() => PrintJobParamsDto)
  params?: PrintJobParamsDto
}
