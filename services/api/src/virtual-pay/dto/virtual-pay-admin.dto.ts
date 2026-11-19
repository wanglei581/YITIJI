import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { TERMINAL_CHARGE_MAX_UNIT_CENTS } from '../../payment/terminal-charge.contract'

/** 小程序虚拟支付开关。打开必须另带 confirm: true。不用 @Type(() => Boolean)，避免把字符串 "false" 收成 true。 */
export class UpdateMiniappVirtualPayDto {
  @IsBoolean()
  enabled!: boolean

  @IsOptional()
  @IsBoolean()
  confirm?: boolean
}

/** 单个服务的道具。价格只从这次请求进来，不写进仓库。 */
export class UpdateMiniappVirtualPayGoodsDto {
  @IsString()
  @MaxLength(20)
  productId!: string

  @IsInt()
  @Min(1)
  @Max(TERMINAL_CHARGE_MAX_UNIT_CENTS)
  priceCents!: number

  /** 缺省或 false 都由服务层拒绝，不能在校验层把「没带 confirm」收成别的 400。 */
  @IsOptional()
  @IsBoolean()
  confirm?: boolean
}
