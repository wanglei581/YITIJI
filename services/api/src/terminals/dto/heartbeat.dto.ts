import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator'
import { Type } from 'class-transformer'

/**
 * HeartbeatDto — Phase 8.1B
 * All fields are optional: Agent may omit unknown fields and backend
 * should still accept the heartbeat gracefully.
 */
export class HeartbeatDto {
  @IsString()
  @IsOptional()
  status?: string

  @IsString()
  @IsOptional()
  printerStatus?: string

  @IsBoolean()
  @IsOptional()
  localTaskDatabaseAvailable?: boolean

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
  agentVersion?: string

  @IsString()
  @IsOptional()
  ipAddress?: string

  @IsString()
  @IsOptional()
  macAddress?: string

  @IsString()
  @IsOptional()
  displayName?: string

  @IsString()
  @IsOptional()
  locationLabel?: string

  @IsString()
  @IsOptional()
  reportedAt?: string
}
