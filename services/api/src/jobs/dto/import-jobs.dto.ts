import {
  IsArray,
  IsIn,
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

export class ImportJobItemDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  externalId!: string

  @IsString() @IsNotEmpty() @MaxLength(200)
  title!: string

  @IsString() @IsNotEmpty() @MaxLength(200)
  company!: string

  @IsString() @IsNotEmpty() @MaxLength(100)
  city!: string

  @IsString() @IsNotEmpty() @MaxLength(500)
  sourceUrl!: string

  @IsOptional() @IsString() @MaxLength(100)
  salary?: string

  @IsOptional() @IsArray() @IsString({ each: true })
  tags?: string[]

  @IsOptional() @IsString() @MaxLength(5000)
  description?: string

  @IsOptional() @IsString() @MaxLength(5000)
  requirements?: string

  @IsOptional() @IsString() @MaxLength(100)
  industry?: string

  @IsOptional() @IsIn(['full_time', 'part_time', 'internship', 'contract'])
  workType?: string

  @IsOptional() @IsNumber() @Min(1)
  headcount?: number
}

export class ImportJobsDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  sourceOrgId!: string

  @IsString() @IsNotEmpty() @MaxLength(200)
  sourceName!: string

  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ImportJobItemDto)
  items!: ImportJobItemDto[]
}
