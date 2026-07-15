import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength, registerDecorator, type ValidationOptions } from 'class-validator'

/**
 * bcrypt(bcryptjs)只取密码的前 72 字节参与哈希,超出部分被静默截断。
 * @MaxLength(72) 校验的是字符数而非字节数:中文等多字节字符 24 个即达 72 字节,
 * 用户以为设置了完整密码,实际尾部被截断(极端情况下不同密码可能截出相同哈希)。
 * 这里按 UTF-8 字节数收紧校验,newPassword 全字段统一使用。
 */
function IsBcryptSafeByteLength(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isBcryptSafeByteLength',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= 72
        },
        defaultMessage() {
          return '新密码过长（按 UTF-8 字节计不能超过 72 字节，中文约 24 个字）'
        },
      },
    })
  }
}

/**
 * 商用内部账号密码规则：至少 12 位，并至少命中 4 类字符中的 3 类。
 * 服务端是最终安全边界；前端只做同规则的即时提示。
 */
function IsCommercialStrongPassword(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isCommercialStrongPassword',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string' || Array.from(value).length < 12) return false
          const categories = [
            /[a-z]/.test(value),
            /[A-Z]/.test(value),
            /\d/.test(value),
            /[^A-Za-z0-9]/u.test(value),
          ].filter(Boolean).length
          return categories >= 3
        },
        defaultMessage() {
          return '新密码至少 12 位，并至少包含大写字母、小写字母、数字、特殊字符中的 3 类'
        },
      },
    })
  }
}

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
  @MinLength(12)
  @MaxLength(72)
  @IsBcryptSafeByteLength()
  @IsCommercialStrongPassword()
  newPassword!: string
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(72)
  currentPassword!: string

  @IsString()
  @MinLength(12)
  @MaxLength(72)
  @IsBcryptSafeByteLength()
  @IsCommercialStrongPassword()
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
