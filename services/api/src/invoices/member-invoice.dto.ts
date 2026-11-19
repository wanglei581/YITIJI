import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

export class SubmitMemberInvoiceDto {
  @IsIn(['print', 'service'])
  orderKind!: 'print' | 'service'

  @IsString()
  @MaxLength(80)
  orderId!: string

  @IsIn(['personal', 'company'])
  titleType!: 'personal' | 'company'

  @IsString()
  @MaxLength(80)
  title!: string

  @IsOptional()
  @IsString()
  @MaxLength(32)
  taxId?: string

  @IsString()
  @MaxLength(120)
  email!: string
}
