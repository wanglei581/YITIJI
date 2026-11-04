import { IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, Matches, MaxLength, ValidateBy, ValidateIf, type ValidationOptions } from 'class-validator'
import { Type } from 'class-transformer'
import { SCAN_DEVICE_HEALTHS } from '../printer-status'
import { isAcceptablePrinterQueueName } from '../heartbeat-printer-queue'

/** 调 isAcceptablePrinterQueueName。规则和终端程序同一条，改一边要改两边。 */
function IsAcceptablePrinterQueueName(validationOptions?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'isAcceptablePrinterQueueName',
      validator: {
        validate(value: unknown) {
          return typeof value === 'string' && isAcceptablePrinterQueueName(value)
        },
        defaultMessage() {
          return '打印队列名不符合终端程序的队列名规则'
        },
      },
    },
    validationOptions,
  )
}

const WIRED_NETWORK_STATUSES = ['connected', 'disconnected', 'unknown'] as const
const PRINTER_NETWORK_STATUSES = ['reachable', 'unreachable', 'not_network_printer', 'unknown'] as const
export const SCAN_INPUT_HEALTHS = ['healthy', 'locked_out', 'unknown'] as const
export const SCAN_INPUT_ACTIONS = ['none', 'restart_required'] as const
export const PRINTER_QUEUE_PORT_KINDS = ['usb', 'network', 'wsd', 'other', 'unknown'] as const
export const PRINTER_QUEUE_SPOOLERS = ['running', 'stopped', 'other', 'unknown'] as const
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

  @IsString()
  @MaxLength(128)
  @IsAcceptablePrinterQueueName()
  @ValidateIf((_o, v) => v !== undefined)
  printerQueueName?: string

  @IsIn(PRINTER_QUEUE_PORT_KINDS)
  @ValidateIf((_o, v) => v !== undefined)
  printerQueuePortKind?: (typeof PRINTER_QUEUE_PORT_KINDS)[number]

  @IsString()
  @MaxLength(8)
  @Matches(/^(USB|DOT4_)\d{1,3}$/)
  @ValidateIf((_o, v) => v !== undefined)
  printerQueuePortName?: string

  @IsString()
  @MaxLength(64)
  @Matches(/^(\d{0,10},\d{0,10},(True|False)?,\d{0,10},\d{0,10}|not_found|query_failed)$/)
  @ValidateIf((_o, v) => v !== undefined)
  printerQueueRawStatus?: string

  @IsIn(PRINTER_QUEUE_SPOOLERS)
  @ValidateIf((_o, v) => v !== undefined)
  printerQueueSpooler?: (typeof PRINTER_QUEUE_SPOOLERS)[number]

  /**
   * 屏上扫描：终端程序最近一次探测扫描仪的结果与探测时刻。两项都可选、可单独出现；
   * 旧版终端程序不带，照常收下。探测时刻必须带时区（见 TerminalAgentService.parseScanDeviceObservedAt）。
   */
  @IsIn(SCAN_DEVICE_HEALTHS)
  @ValidateIf((_object, value) => value !== undefined)
  scanDeviceHealth?: (typeof SCAN_DEVICE_HEALTHS)[number]

  @IsDateString({ strict: true })
  @IsString()
  @MaxLength(64)
  @ValidateIf((_object, value) => value !== undefined)
  scanDeviceObservedAt?: string
}
