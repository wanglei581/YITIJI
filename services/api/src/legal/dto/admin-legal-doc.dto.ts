import { IsIn, IsString, MaxLength, MinLength } from 'class-validator'
import { LEGAL_DOC_TYPES, type LegalDocType } from '../legal.service'

export class CreateLegalDocDto {
  @IsIn(LEGAL_DOC_TYPES)
  docType!: LegalDocType

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  version!: string

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string

  @IsString()
  @MinLength(1)
  @MaxLength(200_000)
  content!: string
}
