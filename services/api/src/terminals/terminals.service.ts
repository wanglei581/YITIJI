// ============================================================
// TerminalsService — 薄 façade 委托层
//
// 保持对外公共方法签名不变，所有实现委托给：
//   - TerminalAgentService（Agent 生命周期）
//   - TerminalAdminService（Admin 管理端）
//
// 控制器和外部模块继续注入 TerminalsService，无需修改。
// ============================================================

import { Injectable } from '@nestjs/common'
import { TerminalAgentService } from './terminals-agent.service'
import { TerminalAdminService } from './terminals-admin.service'
import type { RegisterTerminalDto } from './dto/register-terminal.dto'
import type { HeartbeatDto } from './dto/heartbeat.dto'
import type { ClaimTasksDto } from './dto/claim-tasks.dto'
import type { PatchTaskStatusDto } from './dto/patch-task-status.dto'
import type { ExchangeTerminalBindCodeDto } from './dto/exchange-terminal-bind-code.dto'
import type { UpdateTerminalProfileDto } from './dto/update-terminal-profile.dto'

// Re-export all types so existing import paths remain valid
export type {
  ClaimTaskResponse,
  TerminalBindCodeCreated,
  TerminalBindCodeExchangeResult,
} from './terminals-agent.service'

export {
  SAMPLE_PNG,
  SAMPLE_PNG_MD5,
  SAMPLE_VISIBLE_PDF,
  SAMPLE_VISIBLE_PDF_MD5,
  SAMPLE_VISIBLE_PDF_SHA256,
} from './terminals-agent.service'

export type {
  AdminTerminalView,
  AdminOrganizationOption,
  AssignTerminalOrgResult,
  UpdateTerminalProfileResult,
  AdminPrinterView,
} from './terminals-admin.service'

@Injectable()
export class TerminalsService {
  constructor(
    private readonly agent: TerminalAgentService,
    private readonly admin: TerminalAdminService,
  ) {}

  // ── Agent lifecycle ───────────────────────────────────────────────────────────

  register(dto: RegisterTerminalDto) {
    return this.agent.register(dto)
  }

  createBindCode(terminalRef: string, actorId: string | null, ttlMinutes?: number) {
    return this.agent.createBindCode(terminalRef, actorId, ttlMinutes)
  }

  exchangeBindCode(dto: ExchangeTerminalBindCodeDto) {
    return this.agent.exchangeBindCode(dto)
  }

  heartbeat(terminalId: string, dto: HeartbeatDto, authHeader: string | undefined) {
    return this.agent.heartbeat(terminalId, dto, authHeader)
  }

  claimTasks(terminalId: string, dto: ClaimTasksDto, authHeader: string | undefined) {
    return this.agent.claimTasks(terminalId, dto, authHeader)
  }

  patchTaskStatus(
    taskId: string,
    dto: PatchTaskStatusDto,
    authHeader: string | undefined,
    terminalIdHeader: string | undefined,
  ) {
    return this.agent.patchTaskStatus(taskId, dto, authHeader, terminalIdHeader)
  }

  validateTerminalToken(terminalId: string, authHeader: string | undefined) {
    return this.agent.validateTerminalToken(terminalId, authHeader)
  }

  assertAgentAuthorized(
    terminalId: string,
    authHeader: string | undefined,
    options?: { allowDisabled?: boolean },
  ) {
    return this.agent.assertAgentAuthorized(terminalId, authHeader, options)
  }

  // ── Admin management ──────────────────────────────────────────────────────────

  listTerminals() {
    return this.admin.listTerminals()
  }

  listTerminalsForAdmin() {
    return this.admin.listTerminalsForAdmin()
  }

  listOrganizationOptions() {
    return this.admin.listOrganizationOptions()
  }

  assignTerminalOrg(terminalId: string, orgId: string | null) {
    return this.admin.assignTerminalOrg(terminalId, orgId)
  }

  updateTerminalProfile(terminalId: string, dto: UpdateTerminalProfileDto) {
    return this.admin.updateTerminalProfile(terminalId, dto)
  }

  getKioskTerminalConfig(terminalRef: string) {
    return this.admin.getKioskTerminalConfig(terminalRef)
  }

  listPrintersForAdmin() {
    return this.admin.listPrintersForAdmin()
  }

  listPrintTasks() {
    return this.admin.listPrintTasks()
  }

  getTerminalPrinterStatus(terminalId: string) {
    return this.admin.getTerminalPrinterStatus(terminalId)
  }
}
