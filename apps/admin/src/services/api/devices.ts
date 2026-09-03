import { API_MODE } from './client'
import { adminMockAdapter } from './adminMockAdapter'
import { adminHttpAdapter } from './adminHttpAdapter'
import type {
  AdminPrintersResponse,
  AdminPrinterRecord,
  AdminTerminalsResponse,
  AdminTerminalRecord,
  TerminalLifecycleStatus,
  AdminOrgOptionsResponse,
  AdminOrganizationOption,
  AssignTerminalOrgResult,
  UpdateTerminalProfileInput,
  UpdateTerminalProfileResult,
  UpdateTerminalLifecycleInput,
  UpdateTerminalLifecycleResult,
  EmergencyRevokeTerminalInput,
  EmergencyRevokeTerminalResult,
  TerminalBindCodeCreated,
  CreatePlannedTerminalInput,
  PlannedTerminalCreated,
  TerminalPrinterStatus,
  DeviceFleetOverview,
  DeviceFleetTerminal,
  DeviceFleetHealth,
  DeviceFleetHealthReason,
  DeviceFleetConfigState,
  DeviceFleetConfigArea,
  DeviceFleetIssueKind,
  CreateReleaseObservationPlanInput,
  ReleaseObservationPlanRecord,
  ReleaseObservationPlansResponse,
  UpdateReleaseObservationPlanInput,
} from './types'

export type {
  AdminPrintersResponse,
  AdminPrinterRecord,
  AdminTerminalsResponse,
  AdminTerminalRecord,
  TerminalLifecycleStatus,
  AdminOrgOptionsResponse,
  AdminOrganizationOption,
  AssignTerminalOrgResult,
  UpdateTerminalProfileInput,
  UpdateTerminalProfileResult,
  UpdateTerminalLifecycleInput,
  UpdateTerminalLifecycleResult,
  EmergencyRevokeTerminalInput,
  EmergencyRevokeTerminalResult,
  TerminalBindCodeCreated,
  CreatePlannedTerminalInput,
  PlannedTerminalCreated,
  TerminalPrinterStatus,
  DeviceFleetOverview,
  DeviceFleetTerminal,
  DeviceFleetHealth,
  DeviceFleetHealthReason,
  DeviceFleetConfigState,
  DeviceFleetConfigArea,
  DeviceFleetIssueKind,
  CreateReleaseObservationPlanInput,
  ReleaseObservationPlanRecord,
  ReleaseObservationPlansResponse,
  UpdateReleaseObservationPlanInput,
}

interface AdminDeviceServiceInterface {
  getDeviceFleetOverview(): Promise<DeviceFleetOverview>
  getTerminals(): Promise<AdminTerminalsResponse>
  getPrinters(): Promise<AdminPrintersResponse>
  getOrgOptions(): Promise<AdminOrgOptionsResponse>
  assignTerminalOrg(terminalId: string, orgId: string | null): Promise<AssignTerminalOrgResult>
  updateTerminalProfile(terminalId: string, input: UpdateTerminalProfileInput): Promise<UpdateTerminalProfileResult>
  updateTerminalLifecycle(terminalId: string, input: UpdateTerminalLifecycleInput): Promise<UpdateTerminalLifecycleResult>
  emergencyRevokeTerminal(terminalId: string, input: EmergencyRevokeTerminalInput): Promise<EmergencyRevokeTerminalResult>
  createTerminalBindCode(terminalId: string, ttlMinutes?: number): Promise<TerminalBindCodeCreated>
  createPlannedTerminal(input: CreatePlannedTerminalInput): Promise<PlannedTerminalCreated>
  getReleaseObservationPlans(): Promise<ReleaseObservationPlansResponse>
  createReleaseObservationPlan(input: CreateReleaseObservationPlanInput): Promise<ReleaseObservationPlanRecord>
  updateReleaseObservationPlan(planId: string, input: UpdateReleaseObservationPlanInput): Promise<{
    planId: string
    status: 'active' | 'paused' | 'cancelled'
    version: number
    artifactVersion: string
  }>
}

const adapter: AdminDeviceServiceInterface =
  API_MODE === 'http' ? adminHttpAdapter : adminMockAdapter

/** 读取严格脱敏的终端集群 F0 总览。 */
export const getDeviceFleetOverview = () => adapter.getDeviceFleetOverview()

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

/** 设备运维状态切换：active ↔ maintenance，原因会进入审计。 */
export const updateTerminalLifecycle = (terminalId: string, input: UpdateTerminalLifecycleInput) =>
  adapter.updateTerminalLifecycle(terminalId, input)

/** 紧急吊销当前设备凭证并原子转为 suspended。 */
export const emergencyRevokeTerminal = (terminalId: string, input: EmergencyRevokeTerminalInput) =>
  adapter.emergencyRevokeTerminal(terminalId, input)

/** 生成一次性终端绑定码(POST /admin/terminals/:id/bind-code)。明文只在响应里返回一次。 */
export const createTerminalBindCode = (terminalId: string, ttlMinutes?: number) =>
  adapter.createTerminalBindCode(terminalId, ttlMinutes)

/** Admin 预创建 planned 设备资产；不签发 Agent 凭证。 */
export const createPlannedTerminal = (input: CreatePlannedTerminalInput) =>
  adapter.createPlannedTerminal(input)

/** F0.5 发布观察：仅显示与回报版本事实，不下载、不安装、不控制 Windows 服务。 */
export const getReleaseObservationPlans = () => adapter.getReleaseObservationPlans()

export const createReleaseObservationPlan = (input: CreateReleaseObservationPlanInput) =>
  adapter.createReleaseObservationPlan(input)

export const updateReleaseObservationPlan = (planId: string, input: UpdateReleaseObservationPlanInput) =>
  adapter.updateReleaseObservationPlan(planId, input)
