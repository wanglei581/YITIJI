import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator'

export class CreatePrintJobDto {
  @IsString()
  @IsNotEmpty()
  fileUrl!: string

  /** MD5 digest of the file. If omitted, Terminal Agent skips integrity check. */
  @IsString()
  @IsOptional()
  fileMd5?: string

  @IsString()
  @IsOptional()
  fileName?: string

  /** Serialized PrintJobParams — validated loosely and stored as JSON. */
  @IsObject()
  @IsOptional()
  params?: Record<string, unknown>
}
