import { IsString, MaxLength } from 'class-validator'

/**
 * POST /member/auth/wx-resignin
 *
 * 只收 wx.login() 的一次性 code，用来给**已绑定**会员静默续签。
 * 不收 phoneCode / 法务版本：本端点不建号、不绑手机、不重签协议。
 */
export class WxMiniappResigninDto {
  @IsString()
  @MaxLength(512)
  code!: string
}
