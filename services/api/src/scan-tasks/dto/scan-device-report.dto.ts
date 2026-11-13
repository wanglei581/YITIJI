import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator'
import {
  SCAN_DEVICE_COLOR_MODES,
  SCAN_DEVICE_ERROR_CODES,
  SCAN_DEVICE_MAX_PAGE_COUNT,
  SCAN_DEVICE_SOURCES,
  SCAN_DEVICE_STATES,
  type ScanDeviceColorMode,
  type ScanDeviceErrorCode,
  type ScanDeviceSource,
  type ScanDeviceState,
} from '../scan-device-protocol'

/**
 * POST /terminals/:terminalId/scan-tasks/:taskId/device-report 的请求体（终端程序回报屏上扫描进度）。
 * 全局 ValidationPipe 开着 forbidNonWhitelisted：多出任何字段都是 400。
 * 取值范围在这里校验；状态转移、页数不减、errorCode 与 state 的搭配由 planScanDeviceReport 判。
 */
export class ScanDeviceReportDto {
  @IsIn(SCAN_DEVICE_STATES)
  state!: ScanDeviceState

  /** 只数整页收到的图；缺省 = 不变。 */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(SCAN_DEVICE_MAX_PAGE_COUNT)
  pageCount?: number

  /** 仅 state=error 时必填、其余不许带。 */
  @IsOptional()
  @IsIn(SCAN_DEVICE_ERROR_CODES)
  errorCode?: ScanDeviceErrorCode

  /** 这一场实际在用的来源。不给 = 旧终端程序，服务端不比对。 */
  @IsOptional()
  @IsIn(SCAN_DEVICE_SOURCES)
  source?: ScanDeviceSource

  /** 这一场实际在用的颜色。不给 = 旧终端程序，服务端不比对。 */
  @IsOptional()
  @IsIn(SCAN_DEVICE_COLOR_MODES)
  colorMode?: ScanDeviceColorMode
}
