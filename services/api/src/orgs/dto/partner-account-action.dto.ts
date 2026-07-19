import { BadRequestException } from '@nestjs/common'
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator'
import type {
  PartnerAccountAction,
  PartnerAccountVerificationMethod,
} from '../../common/redis/partner-account-action-redis.types'

export class CreatePartnerAccountActionChallengeDto {
  @IsIn(['delete_account', 'rebind_phone'])
  action!: PartnerAccountAction

  @IsIn(['sms', 'password'])
  verifyMethod!: PartnerAccountVerificationMethod

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(72)
  adminCurrentPassword?: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string
}

export class VerifyPartnerAccountActionChallengeDto {
  @IsOptional()
  @Matches(/^\d{6}$/)
  code?: string

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  currentPassword?: string
}

export class StartPartnerPhoneRebindDto {
  @IsString()
  @Matches(/^1[3-9]\d{9}$/)
  newPhone!: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string
}

export class VerifyPartnerPhoneRebindDto {
  @Matches(/^\d{6}$/)
  code!: string
}

export class ResendPartnerPhoneRebindDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string
}

export function assertExactCredentialDto(
  dto: VerifyPartnerAccountActionChallengeDto,
): { code: string } | { currentPassword: string } {
  const hasCode = typeof dto.code === 'string'
  const hasPassword = typeof dto.currentPassword === 'string'
  if (!(hasCode !== hasPassword)) {
    throw new BadRequestException({
      error: { code: 'VALIDATION_FAILED', message: '验证请求必须且只能提交一种凭据' },
    })
  }
  return hasCode ? { code: dto.code! } : { currentPassword: dto.currentPassword! }
}
