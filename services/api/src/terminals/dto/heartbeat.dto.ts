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
  @MaxLength(64)
  @IsOptional()
  status?: string

  @IsString()
  @MaxLength(128)
  @IsOptional()
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
  @MaxLength(64)
  @IsOptional()
  agentVersion?: string

  @IsString()
  @MaxLength(64)
  @IsOptional()
  ipAddress?: string

  @IsString()
  @MaxLength(64)
  @IsOptional()
  macAddress?: string

  @IsString()
  @MaxLength(120)
  @IsOptional()
  displayName?: string

  @IsString()
  @MaxLength(200)
  @IsOptional()
  locationLabel?: string

  @IsString()
  @MaxLength(64)
  @IsOptional()
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
