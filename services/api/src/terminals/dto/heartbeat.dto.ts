import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator'
import { Type } from 'class-transformer'

const WIRED_NETWORK_STATUSES = ['connected', 'disconnected', 'unknown'] as const
const PRINTER_NETWORK_STATUSES = ['reachable', 'unreachable', 'not_network_printer', 'unknown'] as const

/**
 * HeartbeatDto — Phase 8.1B
 * All fields are optional: Agent may omit unknown fields and backend
 * should still accept the heartbeat gracefully.
 */
export class HeartbeatDto {
  @IsString()
  @IsOptional()
  @MaxLength(64)
  status?: string

  @IsString()
  @IsOptional()
  @MaxLength(64)
  printerStatus?: string

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  diskFreeGB?: number

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  cpuPercent?: number

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  memUsedPercent?: number

  @IsString()
  @IsOptional()
  @MaxLength(128)
  agentVersion?: string

  @IsString()
  @IsOptional()
  @MaxLength(64)
  ipAddress?: string

  @IsString()
  @IsOptional()
  @MaxLength(64)
  macAddress?: string

  @IsString()
  @IsOptional()
  @MaxLength(128)
  displayName?: string

  @IsString()
  @IsOptional()
  @MaxLength(256)
  locationLabel?: string

  @IsString()
  @IsOptional()
  @MaxLength(64)
  reportedAt?: string

  @IsBoolean()
  @IsOptional()
  localTaskDatabaseAvailable?: boolean

  @IsIn(WIRED_NETWORK_STATUSES)
  @IsOptional()
  wiredNetworkStatus?: (typeof WIRED_NETWORK_STATUSES)[number]

  @IsIn(PRINTER_NETWORK_STATUSES)
  @IsOptional()
  printerNetworkStatus?: (typeof PRINTER_NETWORK_STATUSES)[number]
}
