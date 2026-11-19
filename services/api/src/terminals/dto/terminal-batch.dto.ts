import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator'

const TERMINAL_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

export class TerminalBatchRangeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  @Matches(TERMINAL_CODE, { message: '编号前缀只能包含字母、数字、下划线和连字符' })
  prefix!: string

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  start!: number

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  end!: number

  @IsOptional()
  @IsString()
  @MaxLength(200)
  locationLabel?: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  orgId?: string
}

export class TerminalBatchRowDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(TERMINAL_CODE, { message: '终端编号只能包含字母、数字、下划线和连字符' })
  terminalCode!: string

  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  locationLabel?: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  orgId?: string
}

export class CreateTerminalBatchDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => TerminalBatchRangeDto)
  range?: TerminalBatchRangeDto

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => TerminalBatchRowDto)
  rows?: TerminalBatchRowDto[]
}

export class TerminalBatchSelectionDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  terminalIds?: string[]

  @IsOptional()
  @IsString()
  @MaxLength(64)
  batchId?: string

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  ttlMinutes?: number
}
