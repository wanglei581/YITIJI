import { IsBoolean, IsOptional, IsString, ValidateIf } from 'class-validator'

export class UpdateTerminalProfileDto {
  @ValidateIf((o: UpdateTerminalProfileDto) => o.displayName !== null && o.displayName !== undefined)
  @IsString()
  displayName?: string | null

  @ValidateIf((o: UpdateTerminalProfileDto) => o.macAddress !== null && o.macAddress !== undefined)
  @IsString()
  macAddress?: string | null

  @ValidateIf((o: UpdateTerminalProfileDto) => o.locationLabel !== null && o.locationLabel !== undefined)
  @IsString()
  locationLabel?: string | null

  @IsOptional()
  @IsBoolean()
  enabled?: boolean
}
