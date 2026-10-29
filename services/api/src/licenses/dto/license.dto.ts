import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator'
import { LICENSE_MODES, type LicenseMode } from '../license.types'

/**
 * 授权接口的请求体。这里只管「类型对不对、不许多余字段」（全局 ValidationPipe 开了 whitelist + forbidNonWhitelisted），
 * 业务校验（信用代码校验位、日期真实存在、期限重叠、理由 2–200 字、工单号字符集……）在 license-input.ts，错误码按字段区分。
 * 期限一律用含当天的北京日期字符串 YYYY-MM-DD（startsOn / endsOn），不再收带时区的时刻。
 */

export class CreateLicenseDto {
  @IsString() @MaxLength(400)
  licenseeName!: string

  @IsString() @MaxLength(64)
  creditCode!: string

  @IsString() @MaxLength(400)
  contractNo!: string

  @IsString() @MaxLength(32)
  startsOn!: string

  @IsString() @MaxLength(32)
  endsOn!: string

  @IsInt()
  terminalQuota!: number

  @IsOptional() @IsInt()
  graceDays?: number

  @IsOptional() @IsString() @MaxLength(4000)
  note?: string | null
}

export class UpdateLicenseDto {
  @IsInt()
  version!: number

  @IsString() @MaxLength(4000)
  reason!: string

  @IsOptional() @IsString() @MaxLength(400)
  licenseeName?: string

  @IsOptional() @IsString() @MaxLength(64)
  creditCode?: string

  @IsOptional() @IsString() @MaxLength(400)
  contractNo?: string

  @IsOptional() @IsString() @MaxLength(32)
  startsOn?: string

  @IsOptional() @IsString() @MaxLength(32)
  endsOn?: string

  @IsOptional() @IsInt()
  terminalQuota?: number

  @IsOptional() @IsInt()
  graceDays?: number

  @IsOptional() @IsString() @MaxLength(4000)
  note?: string | null
}

export class RenewLicenseDto {
  @IsString() @MaxLength(400)
  licenseeName!: string

  @IsString() @MaxLength(64)
  creditCode!: string

  @IsString() @MaxLength(400)
  contractNo!: string

  @IsOptional() @IsString() @MaxLength(32)
  startsOn?: string

  @IsString() @MaxLength(32)
  endsOn!: string

  @IsOptional() @IsInt()
  terminalQuota?: number

  @IsOptional() @IsInt()
  graceDays?: number

  @IsOptional() @IsString() @MaxLength(4000)
  note?: string | null
}

/** 暂停与吊销共用：版本、理由、审批工单号都必填。 */
export class LicenseStatusChangeDto {
  @IsInt()
  version!: number

  @IsString() @MaxLength(4000)
  reason!: string

  @IsString() @MaxLength(400)
  approvalTicketNo!: string
}

export class LicenseResumeDto {
  @IsInt()
  version!: number

  @IsString() @MaxLength(4000)
  reason!: string
}

export class SetLicenseModeDto {
  @IsIn([...LICENSE_MODES])
  licenseMode!: LicenseMode

  @IsOptional() @IsBoolean()
  confirmLockout?: boolean

  @IsString() @MaxLength(4000)
  reason!: string
}
