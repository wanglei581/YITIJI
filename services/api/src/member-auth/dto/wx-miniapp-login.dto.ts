import { IsString, MaxLength } from 'class-validator'

/**
 * POST /member/auth/wx-login
 *
 * code      — wx.login() 返回的临时凭证，服务端用于换取 openid。
 * phoneCode — open-type="getPhoneNumber" 事件返回的 detail.code，服务端换取真实手机号。
 * termsVersion / privacyVersion — 客户端当前展示的法务版本号，服务端强校验一致性。
 *
 * appSecret 全程只存服务端，禁止出现在此 DTO 或前端。
 */
export class WxMiniappLoginDto {
  @IsString()
  @MaxLength(512)
  code!: string

  @IsString()
  @MaxLength(512)
  phoneCode!: string

  @IsString()
  @MaxLength(64)
  termsVersion!: string

  @IsString()
  @MaxLength(64)
  privacyVersion!: string
}
