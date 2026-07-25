import { Equals, IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator'

/**
 * Admin 为 Partner 账号代绑/换绑登录邮箱。
 * confirmVerified 必须为 true：表示管理员已人工核验邮箱归属并承担责任。
 * Wave 1 不发送邮件；emailVerifiedAt 语义为 admin_manual。
 */
export class BindAccountEmailDto {
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(254)
  email!: string

  @Equals(true, { message: '必须确认已人工核验该邮箱归属' })
  confirmVerified!: true
}
