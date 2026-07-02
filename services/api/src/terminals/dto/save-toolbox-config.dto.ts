import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
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

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsIn(['toolbox', 'smart_campus'], { each: true })
  placements?: Array<'toolbox' | 'smart_campus'>

  @IsOptional()
  @IsIn(['internal_route', 'external_url', 'qr_code', 'mini_program_qr'])
  launchMode?: 'internal_route' | 'external_url' | 'qr_code' | 'mini_program_qr'

  @IsOptional()
  @IsString()
  @MaxLength(512)
  externalUrl?: string | null

  @IsOptional()
  @IsString()
  @MaxLength(512)
  qrImageUrl?: string | null

  @IsOptional()
  @IsString()
  @MaxLength(512)
  qrTargetUrl?: string | null
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
