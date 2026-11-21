import { Allow, IsIn, IsString, MaxLength } from 'class-validator'

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

  // 与会员提交口同理：抬头四项交给 normalizeInvoiceTitle，手机页才能拿到中文句子和专用错误码。
  @Allow()
  titleType?: unknown

  @Allow()
  title?: unknown

  @Allow()
  taxId?: unknown

  @Allow()
  email?: unknown
}
