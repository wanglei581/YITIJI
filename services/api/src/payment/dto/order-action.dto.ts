import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'

/**
 * Admin 线下/人工确认收款请求体（P0a，无 live 网关）。
 * 只允许 offline / manual_confirmed —— `free` 只由 0 元建单自动产生，绝不经 Admin 手动置 free；
 * `wechat` / `alipay` / `benefit` 为未来扩展，禁止写入。
 */
export class AdminMarkPaidDto {
  @IsIn(['offline', 'manual_confirmed'])
  paymentSource!: 'offline' | 'manual_confirmed'
}

/** Admin 整单退款请求体：refundReason 必填。 */
export class AdminRefundDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  refundReason!: string
}

/** 按商户平台核实结果登记（长期查不到渠道结果时）。必须重输订单号确认；必填项由服务端按结果再判。 */
export class AdminRegisterChannelResultDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  refundNo!: string

  @IsIn(['refunded', 'not_refunded'])
  result!: 'refunded' | 'not_refunded'

  @IsOptional()
  @IsString()
  @MaxLength(64)
  channelRefundNo?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  confirmOrderNo!: string
}
