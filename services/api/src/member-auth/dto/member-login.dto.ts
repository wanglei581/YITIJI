import { IsOptional, IsString, Matches, MaxLength } from 'class-validator'

export class MemberLoginDto {
  @Matches(/^1[3-9]\d{9}$/, { message: '必须是有效的中国大陆手机号' })
  phone!: string

  @Matches(/^\d{6}$/, { message: '必须是 6 位数字验证码' })
  code!: string

  /** 登录时勾选同意的《用户服务协议》版本号（须与当前有效/草拟哨兵一致） */
  @IsString()
  @MaxLength(64)
  termsVersion!: string

  /** 登录时勾选同意的《隐私政策》版本号 */
  @IsString()
  @MaxLength(64)
  privacyVersion!: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string
}
