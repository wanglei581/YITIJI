import { Transform, Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator'
import { INTERNAL_ACCOUNT_PAGE_SIZES, INTERNAL_ACCOUNT_ROLES, type InternalAccountRole } from '../internal-accounts.types'

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value)

export class ListInternalAccountsDto {
  @IsOptional()
  @IsIn([...INTERNAL_ACCOUNT_ROLES])
  role?: InternalAccountRole

  @IsOptional()
  @IsIn(['true', 'false'])
  enabled?: 'true' | 'false'

  @IsOptional()
  @IsString()
  @MaxLength(64)
  orgId?: string

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(50)
  keyword?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page = 1

  @IsOptional()
  @Type(() => Number)
  @IsIn([...INTERNAL_ACCOUNT_PAGE_SIZES])
  pageSize: (typeof INTERNAL_ACCOUNT_PAGE_SIZES)[number] = 20
}

/**
 * 启停管理员账号。reason 先 trim 再判长：纯空白必须被拒——这是权限动作，事后追责只能靠它。
 * adminCurrentPassword 长度下限 1（兼容既有短密码；强度由改密入口负责，同 partner-account-action）。
 */
export class SetInternalAccountStatusDto {
  @IsIn(['enable', 'disable'])
  action!: 'enable' | 'disable'

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  reason!: string

  @IsString()
  @MinLength(1)
  @MaxLength(72)
  adminCurrentPassword!: string
}

export class StartBackupAdminDto {
  @Transform(trim)
  @IsString()
  @Matches(/^1[3-9]\d{9}$/)
  phone!: string

  @IsString()
  @MinLength(1)
  @MaxLength(72)
  adminCurrentPassword!: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string
}

export class VerifyBackupAdminDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  ticket!: string

  @IsString()
  @Matches(/^\d{6}$/)
  code!: string
}
