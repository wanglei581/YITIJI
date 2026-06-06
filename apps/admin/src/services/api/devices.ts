import { API_MODE } from './client'
import { adminMockAdapter } from './adminMockAdapter'
import { adminHttpAdapter } from './adminHttpAdapter'
import type {
  AdminPrintersResponse,
  AdminPrinterRecord,
  AdminTerminalsResponse,
  AdminTerminalRecord,
  TerminalPrinterStatus,
} from './types'

export type {
  AdminPrintersResponse,
  AdminPrinterRecord,
  AdminTerminalsResponse,
  AdminTerminalRecord,
  TerminalPrinterStatus,
}

interface AdminDeviceServiceInterface {
  getTerminals(): Promise<AdminTerminalsResponse>
  getPrinters(): Promise<AdminPrintersResponse>
}

const adapter: AdminDeviceServiceInterface =
  API_MODE === 'http' ? adminHttpAdapter : adminMockAdapter

/** 拉取终端列表(契约 C1 GET /admin/terminals)。http 走真实后端,mock 返回示例数据。 */
export const getTerminals = () => adapter.getTerminals()

/** 拉取打印机列表(GET /admin/printers)。由终端心跳聚合,不编造耗材/SN 等未上报字段。 */
export const getPrinters = () => adapter.getPrinters()
