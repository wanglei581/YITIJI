import { IsInt, Max, Min } from 'class-validator'

export class UpdatePrintQueueTimeoutDto {
  @IsInt()
  @Min(5)
  @Max(120)
  minutes!: number
}
