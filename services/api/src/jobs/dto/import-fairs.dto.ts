import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
  ArrayMinSize,
  Min,
} from 'class-validator'
import { Type } from 'class-transformer'

export class ImportFairItemDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  externalId!: string

  @IsString() @IsNotEmpty() @MaxLength(200)
  name!: string

  @IsString() @IsNotEmpty() @MaxLength(200)
  organizer!: string

  @IsString() @IsNotEmpty() @MaxLength(50)
  startTime!: string

  @IsString() @IsNotEmpty() @MaxLength(50)
  endTime!: string

  @IsString() @IsNotEmpty() @MaxLength(200)
  venue!: string

  @IsString() @IsNotEmpty() @MaxLength(500)
  sourceUrl!: string

  @IsOptional() @IsString() @MaxLength(5000)
  description?: string

  @IsOptional() @IsNumber() @Min(1)
  boothCount?: number
}

export class ImportFairsDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  sourceOrgId!: string

  @IsString() @IsNotEmpty() @MaxLength(200)
  sourceName!: string

  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ImportFairItemDto)
  items!: ImportFairItemDto[]
}
