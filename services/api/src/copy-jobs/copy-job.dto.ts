import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator'
import { COPY_COLOR_MODES, COPY_DUPLEX_MODES, COPY_SOURCES } from './copy-job.types'
import type { CopyColorMode, CopyDuplex, CopySource, CopyPrintResultState } from './copy-job.types'

export class CreateCopyJobDto {
  @IsString() @MaxLength(128) @Matches(/^[\w-]+$/) terminalId!: string
  @IsString() @MaxLength(128) @Matches(/^[\w-]{16,128}$/) requestKey!: string
  @IsIn(COPY_SOURCES) source!: CopySource
  @IsIn(COPY_COLOR_MODES) colorMode!: CopyColorMode
  @IsIn(COPY_DUPLEX_MODES) duplex!: CopyDuplex
  @IsInt() @Min(1) copies!: number
}

export class CopyGenerationDto {
  @IsInt() @Min(1) @Max(2_147_483_647) generation!: number
}

export class CopyScanResultDto extends CopyGenerationDto {
  @IsInt() @Min(1) pageCount!: number
}

export class ConfirmCopyJobDto {
  @IsString() @Matches(/^[a-f0-9]{64}$/) quoteVersion!: string
}

export class CopyPrintResultDto extends CopyGenerationDto {
  @IsIn(['handed', 'failed', 'unconfirmed']) state!: CopyPrintResultState
  @IsString() @Matches(/^[\w-]{16,128}$/) eventId!: string
  @IsOptional() @IsString() @Matches(/^[A-Z0-9_]{1,64}$/) errorCode?: string
}
