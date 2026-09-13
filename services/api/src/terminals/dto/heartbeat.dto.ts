import { IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator'
import { Type } from 'class-transformer'

const WIRED_NETWORK_STATUSES = ['connected', 'disconnected', 'unknown'] as const
const PRINTER_NETWORK_STATUSES = ['reachable', 'unreachable', 'not_network_printer', 'unknown'] as const
export const SCAN_INPUT_HEALTHS = ['healthy', 'locked_out', 'unknown'] as const
export const SCAN_INPUT_ACTIONS = ['none', 'restart_required'] as const
export const SCAN_INPUT_REASONS = [
  'not_configured',
  'reparse_point_unverifiable',
  'reparse_point',
  'not_directory',
  'unavailable',
  'not_readable',
  'watcher_rebuild',
  'watcher_error',
  'identity_unavailable',
  'root_identity_changed',
  'readdir_failed',
  'watcher_ready_failed',
  'startup_backlog_failed',
  'startup_incomplete',
  'unknown',
] as const

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

  @IsIn(SCAN_INPUT_HEALTHS)
  @ValidateIf((_object, value) => value !== undefined)
  scanInputHealth?: (typeof SCAN_INPUT_HEALTHS)[number]

  @IsIn(SCAN_INPUT_ACTIONS)
  @ValidateIf((_object, value) => value !== undefined)
  scanInputAction?: (typeof SCAN_INPUT_ACTIONS)[number]

  @IsIn(SCAN_INPUT_REASONS)
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  scanInputReason?: (typeof SCAN_INPUT_REASONS)[number] | null

  @IsDateString({ strict: true })
  @IsString()
  @MaxLength(64)
  @ValidateIf((_object, value) => value !== undefined)
  scanInputObservedAt?: string
}
