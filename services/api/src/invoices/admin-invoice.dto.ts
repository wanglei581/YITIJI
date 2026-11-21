import { IsOptional, IsString, MaxLength } from 'class-validator'

export class IssueInvoiceDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  invoiceNo?: string
}

export class ReturnInvoiceDto {
  @IsString()
  @MaxLength(200)
  reason!: string
}
