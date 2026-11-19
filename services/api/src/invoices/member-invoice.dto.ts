import { Allow, IsIn, IsString, MaxLength } from 'class-validator'

export class SubmitMemberInvoiceDto {
  @IsIn(['print', 'service'])
  orderKind!: 'print' | 'service'

  @IsString()
  @MaxLength(80)
  orderId!: string

  // 抬头类型、抬头、税号、邮箱只在服务端 normalizeInvoiceTitle 里校验，好让文档写的专用错误码
  // （INVOICE_TITLE_INVALID、INVOICE_EMAIL_INVALID 等）和中文句子原样回到小程序与手机页。
  // 这里只声明字段（全局白名单要求），不在管道里先拦成英文的 VALIDATION_FAILED。
  @Allow()
  titleType?: unknown

  @Allow()
  title?: unknown

  @Allow()
  taxId?: unknown

  @Allow()
  email?: unknown
}
