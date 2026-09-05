import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'
import type { SelfAssessmentSubmitInput } from '../resume/self-assessment.service'
import type { SelfAssessmentDimensionKey } from '../resume/self-assessment.types'

const DIMENSION_KEYS = ['interest', 'style', 'team', 'value', 'motivation'] as const satisfies readonly SelfAssessmentDimensionKey[]

class SelfAssessmentConsentDto {
  @IsBoolean()
  nonSensitive!: boolean

  @IsBoolean()
  sensitive!: boolean

  @IsOptional()
  @IsString()
  @MaxLength(64)
  consentVersion?: string
}

class SelfAssessmentAnswerDto {
  @IsIn(DIMENSION_KEYS)
  dim!: SelfAssessmentDimensionKey

  @IsInt()
  @Min(0)
  @Max(40)
  idx!: number

  @IsString()
  @IsNotEmpty()
  @MaxLength(16)
  choice!: string
}

export class SubmitSelfAssessmentDto implements SelfAssessmentSubmitInput {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => SelfAssessmentAnswerDto)
  answers!: SelfAssessmentAnswerDto[]

  @ValidateNested()
  @Type(() => SelfAssessmentConsentDto)
  consent!: SelfAssessmentConsentDto
}

export class AppendSelfAssessmentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  resumeFileId!: string
}
