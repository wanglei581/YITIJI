import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import {
  SCAN_DEVICE_COLOR_MODES,
  SCAN_DEVICE_SOURCES,
  SCAN_START_MODES,
  type ScanDeviceColorMode,
  type ScanDeviceSource,
  type ScanStartMode,
} from '../scan-device-protocol'

export class CreateScanTaskDto {
  @IsIn(['resume', 'id', 'document', 'contract'])
  scanType!: 'resume' | 'id' | 'document' | 'contract'

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  terminalId!: string

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  retryOfScanTaskId?: string

  /**
   * 屏上扫描（2026-11-02）。不传 = 面板扫描（现有行为，一字不变）。
   * 取值范围在这里校验；「device 时 source / colorMode 必填、panel 时不许带」这类字段组合
   * 由 resolveScanStartParams 判（scan-device-protocol.ts）。
   */
  @IsOptional()
  @IsIn(SCAN_START_MODES)
  startMode?: ScanStartMode

  /** 原件放哪：flatbed 玻璃台 / feeder 进纸器。只在 startMode=device 时允许。 */
  @IsOptional()
  @IsIn(SCAN_DEVICE_SOURCES)
  source?: ScanDeviceSource

  /** gray = 屏上「黑白」/ color。只在 startMode=device 时允许。 */
  @IsOptional()
  @IsIn(SCAN_DEVICE_COLOR_MODES)
  colorMode?: ScanDeviceColorMode
}
