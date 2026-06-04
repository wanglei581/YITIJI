import { IsOptional, IsString, Matches, MaxLength } from 'class-validator'

/**
 * 发送短信验证码。全局 ValidationPipe forbidNonWhitelisted=true,
 * 任何超出白名单的字段(如 candidate/email/简历 等)直接 400 拒绝。
 */
export class SendSmsCodeDto {
  @Matches(/^1[3-9]\d{9}$/, { message: '必须是有效的中国大陆手机号' })
  phone!: string

  /** 设备/终端标识,用于设备维度频控;一体机可传 terminalCode。 */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string
}
