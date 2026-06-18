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
