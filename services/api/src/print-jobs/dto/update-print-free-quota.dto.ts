import { IsInt, Max, Min } from 'class-validator'

export class UpdatePrintFreeQuotaDto {
  @IsInt()
  @Min(1)
  @Max(10000)
  terminalDailySides!: number

  @IsInt()
  @Min(1)
  @Max(10000)
  memberDailySides!: number

  @IsInt()
  @Min(1)
  @Max(10000)
  guestPerOrderSides!: number

  @IsInt()
  @Min(50)
  @Max(100)
  alertPercent!: number
}
