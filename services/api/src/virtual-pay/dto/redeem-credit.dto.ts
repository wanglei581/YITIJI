import { IsString, MaxLength, MinLength } from 'class-validator'

export class RedeemMiniappCreditDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  serviceKey!: string

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  kioskSessionId!: string
}
