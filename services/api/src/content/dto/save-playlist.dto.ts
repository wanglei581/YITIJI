import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

export class PlaylistItemDto {
  @IsString()
  assetId!: string

  @IsInt()
  @Min(0)
  order!: number

  @IsOptional()
  @IsBoolean()
  enabled?: boolean
}

export class SavePlaylistDto {
  @IsString()
  @MaxLength(60)
  name!: string

  @IsOptional()
  @IsIn(['active', 'disabled'])
  status?: 'active' | 'disabled'

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PlaylistItemDto)
  items!: PlaylistItemDto[]
}
