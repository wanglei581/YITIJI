import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator'
import type { ParseResumeOutput } from '../interfaces/ai-provider.interface'
import {
  RESUME_SCORING_DIMENSIONS,
  RESUME_TARGET_EXPERIENCE_OPTIONS,
  RESUME_TARGET_SCENE_OPTIONS,
  type ResumeScoringDimensionKey,
  type ResumeTargetExperience,
  type ResumeTargetScene,
} from '../interfaces/ai-provider.interface'

const RESUME_SCORING_DIMENSION_KEYS = RESUME_SCORING_DIMENSIONS.map((d) => d.key)

export class ResumeTargetContextDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  industry?: string

  @IsOptional()
  @IsString()
  @MaxLength(80)
  targetJob?: string

  @IsOptional()
  @IsIn(RESUME_TARGET_EXPERIENCE_OPTIONS)
  experience?: ResumeTargetExperience

  @IsOptional()
  @IsIn(RESUME_TARGET_SCENE_OPTIONS)
  scene?: ResumeTargetScene

  @IsOptional()
  @IsBoolean()
  skipped?: boolean
}

export class ResumeParseRequestDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  fileId!: string

  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  fileName!: string

  @IsNotEmpty()
  @IsString()
  @MaxLength(20)
  fileFormat!: string

  @IsIn(['upload', 'scan', 'manual'])
  source!: 'upload' | 'scan' | 'manual'

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsIn(RESUME_SCORING_DIMENSION_KEYS, { each: true })
  selectedDimensions?: ResumeScoringDimensionKey[]

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ResumeTargetContextDto)
  targetContext?: ResumeTargetContextDto
}

/** Response aligns with shared ResumeParseResponse */
export type ResumeParseResponseDto = ParseResumeOutput
