import { Transform } from 'class-transformer'
import { IsString, Matches, MaxLength, MinLength } from 'class-validator'
import { normalizePhone } from '../../common/crypto/phone-identity'

/**
 * 管理员为「临时密码且未自证手机」的机构账号登记联系人手机。
 * 只收这三个字段。多出来的字段会被拒绝，避免把验证码改发到别的号码。
 */
export class RegisterPartnerContactPhoneDto {
  @Transform(({ value }) => (typeof value === 'string' ? normalizePhone(value) : value))
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: '请填写中国大陆手机号' })
  phone!: string

  @Transform(({ value }) => (typeof value === 'string' ? value.replace(/\s+/g, '') : value))
  @IsString()
  @Matches(/^[A-Za-z0-9\-/]{4,64}$/, { message: '确认函编号应为 4 到 64 位字母、数字、横线或斜线' })
  confirmationLetterNo!: string

  @IsString({ message: '请填写管理员本人密码' })
  @MinLength(1, { message: '请填写管理员本人密码' })
  @MaxLength(72, { message: '请填写管理员本人密码' })
  currentPassword!: string
}
