import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class LoginDto {
  /** 兼容旧前端 username 字段;新前端优先传 loginId(用户名或手机号)。 */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  username?: string

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  loginId?: string

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string

  @IsIn(['admin', 'partner', 'kiosk'])
  portal!: 'admin' | 'partner' | 'kiosk'
}
