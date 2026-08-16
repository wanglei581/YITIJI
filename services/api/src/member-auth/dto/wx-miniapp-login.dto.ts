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

/**
 * POST /member/auth/wx-resignin
 *
 * 续签：只凭 wx.login() 的 code 换 openid，不再索取 phoneCode。
 *
 * 为什么不需要 phoneCode：openid 由 code2session 服务端换取、无法伪造，
 * 且只对「该 openid 已绑定手机号的存量账号」签发 token——手机号在首次
 * 登录时已验证并落库，续签不是一次新的身份认证，而是同一身份的会话延续。
 * 此路径永不创建账号；查不到绑定关系一律退回完整登录。
 *
 * 存在的原因：enduser JWT 仅 30 分钟且全仓无 refresh 机制，用户中午下单、
 * 下午走到一体机前打开取件页必然 401。而 phoneCode 只能由用户点按
 * open-type="getPhoneNumber" 按钮产生，无法在拦截 401 后静默补签。
 */
export class WxMiniappResigninDto {
  @IsString()
  @MaxLength(512)
  code!: string
}
