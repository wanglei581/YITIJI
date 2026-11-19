import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'

export class CreateInvoiceSessionDto {
  @IsIn(['print', 'service'])
  orderKind!: 'print' | 'service'

  @IsString()
  @MaxLength(80)
  orderId!: string
}

export class ResolveInvoiceSceneDto {
  @IsString()
  @MaxLength(64)
  scene!: string
}

export class SubmitInvoiceSessionDto {
  @IsString()
  @MaxLength(200)
  submitToken!: string

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
