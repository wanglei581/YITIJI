import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsString, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import type { OverlayPosition, OverlaySize } from './print-conversion.types'

export class ConvertImageSourceDto {
  @IsString()
  fileId!: string

  @IsString()
  fileAccessUrl!: string
}

export class ConvertImagesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ConvertImageSourceDto)
  sources!: ConvertImageSourceDto[]
}

const OVERLAY_POSITIONS: OverlayPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center']
const OVERLAY_SIZES: OverlaySize[] = ['small', 'medium', 'large']

export class SignatureOverlayTargetDto {
  @IsString()
  fileId!: string

  @IsString()
  fileAccessUrl!: string
}

export class SignatureOverlaySignatureDto {
  @IsString()
  fileId!: string

  @IsString()
  fileAccessUrl!: string
}

export class ComposeSignatureOverlayDto {
  @ValidateNested()
  @Type(() => SignatureOverlayTargetDto)
  target!: SignatureOverlayTargetDto

  @ValidateNested()
  @Type(() => SignatureOverlaySignatureDto)
  signature!: SignatureOverlaySignatureDto

  @IsIn(OVERLAY_POSITIONS)
  position!: OverlayPosition

  @IsIn(OVERLAY_SIZES)
  size!: OverlaySize
}
