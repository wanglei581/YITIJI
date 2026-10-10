import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import { PRINT_SCAN_CAPABILITY_STATUSES } from '../terminal-capabilities.types'

export class UpdateTerminalCapabilityDto {
  @IsIn(PRINT_SCAN_CAPABILITY_STATUSES as readonly string[])
  status!: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string

  /** null = 用全局默认。缺省表示这次不改这一列。 */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  dailyFreePrintSides?: number | null
}
