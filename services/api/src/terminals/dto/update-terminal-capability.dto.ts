import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'
import { PRINT_SCAN_CAPABILITY_STATUSES } from '../terminal-capabilities.types'

export class UpdateTerminalCapabilityDto {
  @IsIn(PRINT_SCAN_CAPABILITY_STATUSES as readonly string[])
  status!: string

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string
}
