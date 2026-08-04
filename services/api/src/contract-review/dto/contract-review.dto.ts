import { Equals, IsBoolean, IsIn, IsInt, IsISO8601, IsNotEmpty, IsString, Matches, Max, MaxLength, Min } from 'class-validator'
import type { ContractType } from '../contract-review.types'

const CONTRACT_TYPES: readonly ContractType[] = [
  'labor_contract',
  'internship_agreement',
  'non_compete',
  'offer',
]

export class CreateContractReviewDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  sourceFileId!: string

  @IsIn(CONTRACT_TYPES)
  contractType!: ContractType

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  consentVersion!: string

  @IsISO8601({ strict: true })
  consentedAt!: string

  @Matches(/^[a-f0-9]{64}$/u)
  consentScopeHash!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  disclaimerVersion!: string
}

export class ConfirmContractReviewDto {
  @IsIn(CONTRACT_TYPES)
  contractType!: ContractType

  @IsInt()
  @Min(1)
  @Max(50)
  totalPages!: number

  @IsInt()
  @Min(0)
  @Max(50)
  analyzedPages!: number

  @IsBoolean()
  truncated!: boolean

  @IsBoolean()
  @Equals(true)
  ocrCoverageConfirmed!: true

  @IsBoolean()
  @Equals(true)
  personalUseConfirmed!: true
}
