import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

export class ToolboxItemDto {
  @IsString()
  @MaxLength(64)
  key!: string

  @IsString()
  @MaxLength(32)
  title!: string

  @IsOptional()
  @IsString()
  @MaxLength(80)
  description?: string

  @IsOptional()
  @IsString()
  @MaxLength(32)
  icon?: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  to?: string | null

  @IsOptional()
  @IsBoolean()
  disabled?: boolean

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number
}

export class SaveToolboxConfigDto {
  @IsBoolean()
  enabled!: boolean

  @IsArray()
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => ToolboxItemDto)
  items!: ToolboxItemDto[]
}
