import { API_MODE } from './client'
import { adminMockAdapter } from './adminMockAdapter'
import { adminHttpAdapter } from './adminHttpAdapter'
import type {
  AdminPrintersResponse,
  AdminPrinterRecord,
  AdminTerminalsResponse,
  AdminTerminalRecord,
  AdminOrgOptionsResponse,
  AdminOrganizationOption,
  AssignTerminalOrgResult,
  UpdateTerminalProfileInput,
  UpdateTerminalProfileResult,
  TerminalPrinterStatus,
} from './types'

export type {
  AdminPrintersResponse,
  AdminPrinterRecord,
  AdminTerminalsResponse,
  AdminTerminalRecord,
  AdminOrgOptionsResponse,
  AdminOrganizationOption,
  AssignTerminalOrgResult,
  UpdateTerminalProfileInput,
  UpdateTerminalProfileResult,
  TerminalPrinterStatus,
}

interface AdminDeviceServiceInterface {
  getTerminals(): Promise<AdminTerminalsResponse>
  getPrinters(): Promise<AdminPrintersResponse>
  getOrgOptions(): Promise<AdminOrgOptionsResponse>
  assignTerminalOrg(terminalId: string, orgId: string | null): Promise<AssignTerminalOrgResult>
  updateTerminalProfile(terminalId: string, input: UpdateTerminalProfileInput): Promise<UpdateTerminalProfileResult>
}

const adapter: AdminDeviceServiceInterface =
  API_MODE === 'http' ? adminHttpAdapter : adminMockAdapter

/** 拉取终端列表(契约 C1 GET /admin/terminals)。http 走真实后端,mock 返回示例数据。 */
export const getTerminals = () => adapter.getTerminals()

/** 拉取打印机列表(GET /admin/printers)。由终端心跳聚合,不编造耗材/SN 等未上报字段。 */
export const getPrinters = () => adapter.getPrinters()

/** 终端机构归属下拉选项(GET /admin/terminals/org-options，仅 enabled 机构)。 */
export const getOrgOptions = () => adapter.getOrgOptions()

/** 绑定/解绑终端机构归属(PATCH /admin/terminals/:id/org，orgId=null 解绑)。admin only，写审计。 */
export const assignTerminalOrg = (terminalId: string, orgId: string | null) =>
  adapter.assignTerminalOrg(terminalId, orgId)

/** 更新终端设备档案/MAC/启停状态(PATCH /admin/terminals/:id/profile)。 */
export const updateTerminalProfile = (terminalId: string, input: UpdateTerminalProfileInput) =>
  adapter.updateTerminalProfile(terminalId, input)
