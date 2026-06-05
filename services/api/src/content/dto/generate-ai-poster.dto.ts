import { IsOptional, IsString, MaxLength } from 'class-validator'

export class GenerateAiPosterDto {
  @IsString()
  @MaxLength(500)
  prompt!: string

  /** 目标尺寸,例 '1080x1920' */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  size?: string
}
