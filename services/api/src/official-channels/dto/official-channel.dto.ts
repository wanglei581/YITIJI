import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator'

export class ReplaceVerifiedDomainsDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(253, { each: true })
  domains!: string[]
}

export class CreateOfficialChannelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name!: string

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  url!: string

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  displayOrder?: number

  @IsOptional()
  @IsBoolean()
  enabled?: boolean
}

export class UpdateOfficialChannelDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  name?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  displayOrder?: number

  @IsOptional()
  @IsBoolean()
  enabled?: boolean
}
