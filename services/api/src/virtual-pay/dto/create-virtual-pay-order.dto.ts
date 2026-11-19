import { IsString, MaxLength, MinLength } from 'class-validator'

export class CreateVirtualPayOrderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  serviceKind!: string

  /** 小程序付款前现取的 wx.login code。服务端只用来换本次签名密钥。 */
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  code!: string
}
