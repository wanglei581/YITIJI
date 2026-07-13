import { ArrayMaxSize, ArrayMinSize, IsArray, IsDefined, IsIn, IsString, ValidateNested } from 'class-validator'
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
  // @ValidateNested() 本身不会在整个属性缺失（undefined）时报错——必须显式
  // @IsDefined() 才能拒绝"target"/"signature"整体缺失的请求体，否则会在
  // service 层访问 undefined.fileId 时变成未捕获的 500 而不是契约声明的 400。
  @IsDefined()
  @ValidateNested()
  @Type(() => SignatureOverlayTargetDto)
  target!: SignatureOverlayTargetDto

  @IsDefined()
  @ValidateNested()
  @Type(() => SignatureOverlaySignatureDto)
  signature!: SignatureOverlaySignatureDto

  @IsIn(OVERLAY_POSITIONS)
  position!: OverlayPosition

  @IsIn(OVERLAY_SIZES)
  size!: OverlaySize
}
