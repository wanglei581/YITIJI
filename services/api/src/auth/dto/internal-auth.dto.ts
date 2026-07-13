import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'

export class SendInternalSmsCodeDto {
  @Matches(/^1[3-9]\d{9}$/, { message: '必须是有效的中国大陆手机号' })
  phone!: string

  @IsIn(['login', 'reset_password', 'bind_phone'])
  purpose!: 'login' | 'reset_password' | 'bind_phone'

  @IsOptional()
  @IsIn(['admin', 'partner'])
  portal?: 'admin' | 'partner'

  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string
}

export class SmsLoginDto {
  @Matches(/^1[3-9]\d{9}$/, { message: '必须是有效的中国大陆手机号' })
  phone!: string

  @Matches(/^\d{6}$/, { message: '必须是 6 位数字验证码' })
  code!: string

  @IsIn(['admin', 'partner'])
  portal!: 'admin' | 'partner'
}

export class PasswordResetStartDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  loginIdOrPhone!: string
}

export class PasswordResetVerifyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  loginIdOrPhone!: string

  @Matches(/^\d{6}$/, { message: '必须是 6 位数字验证码' })
  code!: string
}

export class PasswordResetCompleteDto {
  @IsString()
  @MinLength(16)
  @MaxLength(128)
  resetTicket!: string

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword!: string
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(72)
  currentPassword!: string

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  newPassword!: string
}

export class SelfPhoneCodeDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string
}

export class SelfPhoneVerifyDto {
  @Matches(/^\d{6}$/, { message: '必须是 6 位数字验证码' })
  code!: string
}
