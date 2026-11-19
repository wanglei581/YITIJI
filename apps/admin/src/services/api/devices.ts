import { API_MODE } from './client'
import { adminDeviceMock } from './adminDeviceMock'
import { adminHttpAdapter } from './adminHttpAdapter'
import type {
  AdminPrintersResponse,
  GetPrintersOptions,
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
import type {
  CreateTerminalBatchInput,
  TerminalBatchBindCodeResult,
  TerminalBatchCreated,
  TerminalBatchRevokeResult,
  TerminalBatchSelectionInput,
} from './terminalBatch'

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
  getPrinters(options?: GetPrintersOptions): Promise<AdminPrintersResponse>
  getOrgOptions(): Promise<AdminOrgOptionsResponse>
  assignTerminalOrg(terminalId: string, orgId: string | null): Promise<AssignTerminalOrgResult>
  updateTerminalProfile(terminalId: string, input: UpdateTerminalProfileInput): Promise<UpdateTerminalProfileResult>
  updateTerminalLifecycle(terminalId: string, input: UpdateTerminalLifecycleInput): Promise<UpdateTerminalLifecycleResult>
  emergencyRevokeTerminal(terminalId: string, input: EmergencyRevokeTerminalInput): Promise<EmergencyRevokeTerminalResult>
  createTerminalBindCode(terminalId: string, ttlMinutes?: number): Promise<TerminalBindCodeCreated>
  createPlannedTerminal(input: CreatePlannedTerminalInput): Promise<PlannedTerminalCreated>
  createTerminalBatch(input: CreateTerminalBatchInput): Promise<TerminalBatchCreated>
  issueTerminalBatchBindCodes(input: TerminalBatchSelectionInput): Promise<TerminalBatchBindCodeResult>
  revokeTerminalBatchBindCodes(input: TerminalBatchSelectionInput): Promise<TerminalBatchRevokeResult>
  reissueTerminalBatchBindCodes(input: TerminalBatchSelectionInput): Promise<TerminalBatchBindCodeResult>
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
  API_MODE === 'http' ? adminHttpAdapter : adminDeviceMock

/** 读取严格脱敏的终端集群 F0 总览。 */
export const getDeviceFleetOverview = () => adapter.getDeviceFleetOverview()

/** 拉取终端列表(契约 C1 GET /admin/terminals)。http 走真实后端,mock 返回示例数据。 */
export const getTerminals = () => adapter.getTerminals()

/** 拉取打印机列表(GET /admin/printers)。由终端心跳聚合,不编造耗材/SN 等未上报字段。只有 includeOutput 才带本系统出纸。 */
export const getPrinters = (options?: GetPrintersOptions) => adapter.getPrinters(options)

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

/** 一次预建多台，整批成功或整批不建。 */
export const createTerminalBatch = (input: CreateTerminalBatchInput) =>
  adapter.createTerminalBatch(input)

/** 给选中或整批未激活终端生成一次性绑定码。明文只在这次返回值里。 */
export const issueTerminalBatchBindCodes = (input: TerminalBatchSelectionInput) =>
  adapter.issueTerminalBatchBindCodes(input)

/** 作废选中终端尚未使用的绑定码。 */
export const revokeTerminalBatchBindCodes = (input: TerminalBatchSelectionInput) =>
  adapter.revokeTerminalBatchBindCodes(input)

/** 作废旧绑定码后再生成新码。 */
export const reissueTerminalBatchBindCodes = (input: TerminalBatchSelectionInput) =>
  adapter.reissueTerminalBatchBindCodes(input)

/** F0.5 发布观察：仅显示与回报版本事实，不下载、不安装、不控制 Windows 服务。 */
export const getReleaseObservationPlans = () => adapter.getReleaseObservationPlans()

export const createReleaseObservationPlan = (input: CreateReleaseObservationPlanInput) =>
  adapter.createReleaseObservationPlan(input)

export const updateReleaseObservationPlan = (planId: string, input: UpdateReleaseObservationPlanInput) =>
  adapter.updateReleaseObservationPlan(planId, input)
