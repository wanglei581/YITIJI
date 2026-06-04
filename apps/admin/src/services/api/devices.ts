import { API_MODE } from './client'
import { adminMockAdapter } from './adminMockAdapter'
import { adminHttpAdapter } from './adminHttpAdapter'
import type { AdminTerminalsResponse, AdminTerminalRecord, TerminalPrinterStatus } from './types'

export type { AdminTerminalsResponse, AdminTerminalRecord, TerminalPrinterStatus }

interface AdminDeviceServiceInterface {
  getTerminals(): Promise<AdminTerminalsResponse>
}

const adapter: AdminDeviceServiceInterface =
  API_MODE === 'http' ? adminHttpAdapter : adminMockAdapter

/** 拉取终端列表(契约 C1 GET /admin/terminals)。http 走真实后端,mock 返回示例数据。 */
export const getTerminals = () => adapter.getTerminals()
