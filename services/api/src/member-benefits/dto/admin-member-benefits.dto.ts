import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator'
import { Type } from 'class-transformer'

export const ADMIN_BENEFIT_TYPES = ['coupon', 'free_quota', 'package_entitlement', 'subsidy_eligibility_hint'] as const
export const ADMIN_BENEFIT_SOURCE_TYPES = ['platform', 'campus', 'gov', 'fair', 'partner'] as const

export class SearchEndUserByPhoneDto {
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: '请输入 11 位中国大陆手机号' })
  phone!: string
}

export class GrantBenefitDto {
  @IsString()
  @MaxLength(80)
  endUserId!: string

  @IsIn([...ADMIN_BENEFIT_TYPES])
  benefitType!: typeof ADMIN_BENEFIT_TYPES[number]

  @IsIn([...ADMIN_BENEFIT_SOURCE_TYPES])
  sourceType!: typeof ADMIN_BENEFIT_SOURCE_TYPES[number]

  @IsString()
  @MaxLength(80)
  title!: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null

  @ValidateIf((o: GrantBenefitDto) => o.quantityTotal !== null && o.quantityTotal !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9999)
  quantityTotal?: number | null

  @IsOptional()
  @IsString()
  validFrom?: string | null

  @IsOptional()
  @IsString()
  validUntil?: string | null
}

export class RevokeBenefitDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string | null
}
