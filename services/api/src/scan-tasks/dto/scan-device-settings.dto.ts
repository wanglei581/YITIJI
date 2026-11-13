import { IsIn, IsOptional } from 'class-validator'
import {
  SCAN_DEVICE_COLOR_MODES,
  SCAN_DEVICE_SOURCES,
  type ScanDeviceColorMode,
  type ScanDeviceSource,
} from '../scan-device-protocol'

/**
 * POST /scan/sessions/:id/device-settings 的请求体（用户在放纸与设置屏换来源 / 颜色）。
 * 全局 ValidationPipe 开着 forbidNonWhitelisted：多出任何字段都是 400。
 * 取值范围在这里校验；「两个至少给一个」由 resolveScanDeviceSettingsInput 判（scan-device-protocol.ts）。
 */
export class ScanDeviceSettingsDto {
  /** 原件放哪：flatbed 玻璃台 / feeder 进纸器。没给 = 保持原值。 */
  @IsOptional()
  @IsIn(SCAN_DEVICE_SOURCES)
  source?: ScanDeviceSource

  /** gray = 屏上「黑白」/ color。没给 = 保持原值。 */
  @IsOptional()
  @IsIn(SCAN_DEVICE_COLOR_MODES)
  colorMode?: ScanDeviceColorMode
}
