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

  /**
   * 面值（分）—— 单次可抵扣的平台服务额度。缺省 / null = 不定义面值，
   * 该权益**不可用于订单金额抵扣**（后端 fail-closed 拒 BENEFIT_NOT_VALUED）。
   * 上限 100000 分（1000 元）：一体机打印单价远低于此，更大的值几乎必然是录入错误（分/元写反）。
   */
  @ValidateIf((o: GrantBenefitDto) => o.amountCents !== null && o.amountCents !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  amountCents?: number | null

  /** 单次抵扣上限（分）。缺省 / null = 不额外设限；实际抵扣恒 = min(面值, 上限, 订单应付)。 */
  @ValidateIf((o: GrantBenefitDto) => o.maxDiscountCents !== null && o.maxDiscountCents !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  maxDiscountCents?: number | null

  /** 适用服务范围：逗号分隔的订单类型白名单（当前唯一取值 "print"）；缺省 / null = 不限服务类型。 */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  serviceScope?: string | null

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
