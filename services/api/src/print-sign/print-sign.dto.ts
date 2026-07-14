import { Equals, IsDefined, IsIn, IsInt, IsString, Min, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import {
  SIGN_STAMP_POSITIONS,
  SIGN_STAMP_SIZES,
  type SignStampPosition,
  type SignStampSize,
} from './print-sign.types'

export class SignSourceDto {
  @IsString()
  fileId!: string

  @IsString()
  fileAccessUrl!: string
}

export class SignPlacementDto {
  @IsInt()
  @Min(1)
  page!: number

  @IsIn([...SIGN_STAMP_POSITIONS])
  position!: SignStampPosition

  @IsIn([...SIGN_STAMP_SIZES])
  size!: SignStampSize
}

export class SignInspectDto {
  @IsString()
  terminalId!: string

  // @ValidateNested() 本身不会在整个属性缺失（undefined）时报错——必须显式
  // @IsDefined() 才能拒绝 document 整体缺失的请求体，否则会在 service 层
  // 访问 undefined.fileId 时变成未捕获的 500 而不是契约声明的 400。
  @IsDefined()
  @ValidateNested()
  @Type(() => SignSourceDto)
  document!: SignSourceDto
}

export class SignComposeDto {
  @IsString()
  terminalId!: string

  @IsDefined()
  @ValidateNested()
  @Type(() => SignSourceDto)
  document!: SignSourceDto

  @IsDefined()
  @ValidateNested()
  @Type(() => SignSourceDto)
  stamp!: SignSourceDto

  @IsDefined()
  @ValidateNested()
  @Type(() => SignPlacementDto)
  placement!: SignPlacementDto

  @Equals(true)
  authorizationConfirmed!: boolean
}
