import { IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import type { IdPhotoSpecId } from './id-photo.types'

export class IdPhotoLayoutSourceDto {
  @IsString()
  fileId!: string

  @IsString()
  fileAccessUrl!: string
}

export class CreateIdPhotoLayoutDto {
  @ValidateNested()
  @Type(() => IdPhotoLayoutSourceDto)
  source!: IdPhotoLayoutSourceDto

  @IsIn(['one_inch', 'small_one_inch', 'two_inch', 'small_two_inch'])
  specId!: IdPhotoSpecId

  @IsString()
  @MaxLength(64)
  terminalId!: string
}

export class DeleteIdPhotoSourceDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  deleteToken?: string
}
