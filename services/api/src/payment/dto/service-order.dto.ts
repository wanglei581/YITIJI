import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { SERVICE_ORDER_KEYS, type ServiceOrderKey } from '../service-order.policy'

export class CreateServiceOrderDto {
  @IsIn(SERVICE_ORDER_KEYS)
  serviceKey!: ServiceOrderKey

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  kioskSessionId!: string

  /**
   * 只用来和会员登录态核对，不作订单归属依据（归属人取自登录身份）。
   * 字段保留：旧一体机前端仍会带它，去掉会被白名单校验拒成 400。
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  endUserId?: string
}
