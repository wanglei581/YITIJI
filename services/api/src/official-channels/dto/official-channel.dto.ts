import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator'
import { Transform } from 'class-transformer'
import { OFFICIAL_CHANNEL_AUDIENCES, type OfficialChannelAudience } from '../official-channel.constants'

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

  @IsIn(OFFICIAL_CHANNEL_AUDIENCES)
  @ValidateIf((_object, value) => value !== undefined)
  audience?: OfficialChannelAudience
}

export class UpdateOfficialChannelDto {
  // 不传就不改；传了就不许是 null（null 会把渠道当成停用写进去，或让名称、链接报 500）
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(40)
  name?: string

  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(500)
  url?: string

  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(999)
  displayOrder?: number

  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  enabled?: boolean

  @IsIn(OFFICIAL_CHANNEL_AUDIENCES)
  @ValidateIf((_object, value) => value !== undefined)
  audience?: OfficialChannelAudience
}
