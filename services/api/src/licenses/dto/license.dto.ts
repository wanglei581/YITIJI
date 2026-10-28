import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator'
import { LICENSE_MODES, type LicenseMode } from '../license.types'

/**
 * 授权接口的请求体。这里只管「类型对不对、不许多余字段」（全局 ValidationPipe 开了 whitelist + forbidNonWhitelisted），
 * 业务校验（信用代码校验位、时间带时区、期限重叠、理由长度……）在 license-input.ts，错误码按字段区分。
 * 时间一律用带时区的 ISO 8601 字符串，例：2027-10-29T00:00:00+08:00。
 */

export class CreateLicenseDto {
  @IsString() @MaxLength(400)
  licenseeName!: string

  @IsString() @MaxLength(64)
  creditCode!: string

  @IsString() @MaxLength(400)
  contractNo!: string

  @IsString() @MaxLength(64)
  startsAt!: string

  @IsString() @MaxLength(64)
  endsAt!: string

  @IsInt()
  terminalQuota!: number

  @IsOptional() @IsInt()
  graceDays?: number

  @IsOptional() @IsString() @MaxLength(4000)
  note?: string | null
}

export class UpdateLicenseDto {
  @IsOptional() @IsString() @MaxLength(400)
  licenseeName?: string

  @IsOptional() @IsString() @MaxLength(64)
  creditCode?: string

  @IsOptional() @IsString() @MaxLength(400)
  contractNo?: string

  @IsOptional() @IsString() @MaxLength(64)
  startsAt?: string

  @IsOptional() @IsString() @MaxLength(64)
  endsAt?: string

  @IsOptional() @IsInt()
  terminalQuota?: number

  @IsOptional() @IsInt()
  graceDays?: number

  @IsOptional() @IsString() @MaxLength(4000)
  note?: string | null
}

export class RenewLicenseDto {
  @IsOptional() @IsString() @MaxLength(64)
  startsAt?: string

  @IsString() @MaxLength(64)
  endsAt!: string

  @IsString() @MaxLength(400)
  contractNo!: string

  @IsOptional() @IsInt()
  terminalQuota?: number

  @IsOptional() @IsInt()
  graceDays?: number

  @IsOptional() @IsString() @MaxLength(4000)
  note?: string | null
}

export class LicenseStatusChangeDto {
  @IsString() @MaxLength(4000)
  reason!: string

  @IsOptional() @IsString() @MaxLength(400)
  ticketNo?: string | null
}

export class LicenseResumeDto {
  @IsOptional() @IsString() @MaxLength(4000)
  reason?: string | null
}

export class SetLicenseModeDto {
  @IsIn([...LICENSE_MODES])
  licenseMode!: LicenseMode

  @IsOptional() @IsBoolean()
  confirmLockout?: boolean

  @IsOptional() @IsString() @MaxLength(4000)
  reason?: string | null
}
