import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { SERVICE_ORDER_KEYS, type ServiceOrderKey } from '../service-order.policy'

export class CreateServiceOrderDto {
  @IsIn(SERVICE_ORDER_KEYS)
  serviceKey!: ServiceOrderKey

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  kioskSessionId!: string

  /** 只作标签，不拿来鉴权。 */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  endUserId?: string
}
