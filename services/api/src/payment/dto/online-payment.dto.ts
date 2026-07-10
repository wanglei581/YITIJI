import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator'

/**
 * 出码请求体（C5-6 多通道）：只允许选择服务端已启用的通道；
 * 金额/订单字段一律来自服务端落库数据，请求体不接受。
 */
export class CreatePayAttemptDto {
  @IsOptional()
  @IsIn(['sandbox', 'wechat', 'alipay'])
  channel?: 'sandbox' | 'wechat' | 'alipay'
}

export class CreateCodePayAttemptDto {
  @IsOptional()
  @IsIn(['sandbox', 'wechat', 'alipay'])
  channel?: 'sandbox' | 'wechat' | 'alipay'

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{18}$/)
  @MaxLength(18)
  authCode!: string
}

/**
 * 沙箱模拟支付请求体（仅开发/联调；生产环境端点直接 404）。
 * 只允许指定「哪个已存在的支付尝试」与「成功/失败」——回调报文由服务端按库内
 * 真实数据构造并签名，前端/调用方不可能借此注入金额或订单字段。
 */
export class SandboxSimulateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  attemptId!: string

  @IsIn(['success', 'failed'])
  result!: 'success' | 'failed'
}
