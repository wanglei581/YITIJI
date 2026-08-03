import { IsOptional, IsString, Matches, MaxLength } from 'class-validator'

/**
 * 手机号换绑请求体（Wave 2）。
 *
 * 安全约束：
 * - stepUpToken：旧号二次验证后签发的 opaque grant，由 /member/auth/step-up/verify 返回；
 *   action 必须是 phone_rebind，服务端 consumeGrant 时强制校验。
 * - newPhone：符合大陆手机号格式；服务端同时校验：与当前号不同、不被其他账号占用。
 * - newPhoneCode：6 位数字，与 /member/auth/sms-code（newPhone 发起）对应的验证码。
 * - 全局 ValidationPipe forbidNonWhitelisted=true：超出白名单字段直接 400 拒绝。
 */
export class PhoneRebindDto {
  @IsString()
  @MaxLength(200)
  stepUpToken!: string

  @Matches(/^1[3-9]\d{9}$/, { message: '必须是有效的中国大陆手机号' })
  newPhone!: string

  @Matches(/^\d{6}$/, { message: '验证码必须是 6 位数字' })
  newPhoneCode!: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string
}
