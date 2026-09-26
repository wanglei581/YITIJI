import { IsBoolean, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator'
import {
  CHINA_LAT_MAX,
  CHINA_LAT_MIN,
  CHINA_LNG_MAX,
  CHINA_LNG_MIN,
  TERMINAL_AREA_LABEL_MAX_CHARS,
} from '../terminal-placement'

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

  @IsOptional()
  @ValidateIf((o: UpdateTerminalProfileDto) => o.areaLabel !== null && o.areaLabel !== undefined)
  @IsString()
  @MaxLength(TERMINAL_AREA_LABEL_MAX_CHARS)
  areaLabel?: string | null

  @IsOptional()
  @ValidateIf((o: UpdateTerminalProfileDto) => o.geoLat !== null && o.geoLat !== undefined)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(CHINA_LAT_MIN)
  @Max(CHINA_LAT_MAX)
  geoLat?: number | null

  @IsOptional()
  @ValidateIf((o: UpdateTerminalProfileDto) => o.geoLng !== null && o.geoLng !== undefined)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(CHINA_LNG_MIN)
  @Max(CHINA_LNG_MAX)
  geoLng?: number | null
}
