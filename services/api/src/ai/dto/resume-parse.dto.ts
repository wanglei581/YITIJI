import { IsString, IsIn, IsNotEmpty, MaxLength } from 'class-validator'
import type { ParseResumeOutput } from '../interfaces/ai-provider.interface'

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
}

/** Response aligns with shared ResumeParseResponse */
export type ResumeParseResponseDto = ParseResumeOutput
