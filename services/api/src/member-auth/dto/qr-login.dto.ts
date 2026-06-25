import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'

export class CreateQrLoginDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string

  @IsOptional()
  @IsString()
  @MaxLength(80)
  deviceLabel?: string

  @IsOptional()
  @IsString()
  @MaxLength(256)
  returnTo?: string
}

export class ConfirmQrLoginDto {
  @Matches(/^1[3-9]\d{9}$/, { message: '必须是有效的中国大陆手机号' })
  phone!: string

  @Matches(/^\d{6}$/, { message: '必须是 6 位数字验证码' })
  code!: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string
}

export class ClaimQrLoginDto {
  @IsString()
  @MinLength(16)
  @MaxLength(128)
  claimToken!: string
}
