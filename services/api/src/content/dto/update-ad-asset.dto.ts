import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'

export class UpdateAdAssetDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string

  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(1800)
  durationSec?: number

  @IsOptional()
  @IsIn(['active', 'disabled'])
  status?: 'active' | 'disabled'
}
