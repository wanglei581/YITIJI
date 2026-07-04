import { IsNotEmpty, IsString, MaxLength } from 'class-validator'

/**
 * C5-4 订单核销请求体：会员本人用某个已拥有的权益（BenefitGrant）全额抵扣一个未支付订单。
 * endUserId 来自校验后的会员 token（不接受前端传入用户 id）；orderId 来自路由 param。
 */
export class RedeemOrderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  benefitGrantId!: string
}
