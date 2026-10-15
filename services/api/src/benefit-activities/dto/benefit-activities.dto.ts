import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import {
  BENEFIT_ACTIVITY_SOURCE_TYPES,
  BENEFIT_ACTIVITY_STATUS,
  BENEFIT_ACTIVITY_TYPES,
} from '../benefit-activities.types'

export class ListBenefitActivitiesQueryDto {
  @IsOptional()
  @IsIn([...BENEFIT_ACTIVITY_SOURCE_TYPES])
  source?: string
}

export class AdminListBenefitActivitiesQueryDto {
  @IsOptional()
  @IsIn([...BENEFIT_ACTIVITY_STATUS])
  status?: string

  @IsOptional()
  @IsIn([...BENEFIT_ACTIVITY_SOURCE_TYPES])
  source?: string
}

export class UpsertBenefitActivityDto {
  @IsString()
  @MaxLength(80)
  title!: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  rulesText?: string | null

  @IsIn([...BENEFIT_ACTIVITY_TYPES])
  benefitType!: string

  @IsIn([...BENEFIT_ACTIVITY_SOURCE_TYPES])
  sourceType!: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9999)
  quantityTotal?: number | null

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(999999)
  stockTotal?: number | null

  /**
   * 券面值模板（分）—— 领取时逐字写入 BenefitGrant.amountCents。
   * 缺省 / null = 不定义面值，领到的券**不可用于订单金额抵扣**（fail-closed）。
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  amountCents?: number | null

  /** 单次抵扣上限模板（分）；缺省 / null = 不额外设限。 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  maxDiscountCents?: number | null

  /** 适用服务范围模板：逗号分隔的订单类型白名单（当前唯一取值 "print"）；缺省 = 不限。 */
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

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  grantValidDays?: number | null
}
