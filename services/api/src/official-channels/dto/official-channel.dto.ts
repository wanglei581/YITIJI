import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator'
import { Transform } from 'class-transformer'

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value

export class ReplaceVerifiedDomainsDto {
  @IsArray()
  @ArrayMaxSize(10)
  @Transform(({ value }: { value: unknown }) => Array.isArray(value) ? value.map((item) => typeof item === 'string' ? item.trim() : item) : value)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(253, { each: true })
  domains!: string[]
}

export class CreateOfficialChannelDto {
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(40)
  name!: string

  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(500)
  url!: string

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  displayOrder?: number

  @IsOptional()
  @IsBoolean()
  enabled?: boolean
}

export class UpdateOfficialChannelDto {
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(40)
  name?: string

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(500)
  url?: string

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  displayOrder?: number

  @IsOptional()
  @IsBoolean()
  enabled?: boolean
}
