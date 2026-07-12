import { Equals, IsIn, IsInt, IsString, Min, ValidateNested } from 'class-validator'
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

  @ValidateNested()
  @Type(() => SignSourceDto)
  document!: SignSourceDto
}

export class SignComposeDto {
  @IsString()
  terminalId!: string

  @ValidateNested()
  @Type(() => SignSourceDto)
  document!: SignSourceDto

  @ValidateNested()
  @Type(() => SignSourceDto)
  stamp!: SignSourceDto

  @ValidateNested()
  @Type(() => SignPlacementDto)
  placement!: SignPlacementDto

  @Equals(true)
  authorizationConfirmed!: boolean
}
