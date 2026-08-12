import { IsOptional, IsString, MaxLength } from 'class-validator'

export class CancelMemberPrintOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reason?: string
}
