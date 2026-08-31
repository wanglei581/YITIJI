// ============================================================
// Terminals Controller — Phase 8.1B
//
// Routes:
//   POST  /auth/terminal/register               — no auth
//   PUT   /terminals/:terminalId/heartbeat      — Bearer token
//   GET   /terminals/:terminalId/config         — public, read-only kiosk config
//   POST  /terminals/:terminalId/tasks/claim    — Bearer token
//   PATCH /print-tasks/:taskId/status           — Bearer token + X-Terminal-Id
//   GET   /test/sample.png                      — public, for mock task download
// ============================================================

import {
  Controller,
  Post,
  Put,
  Patch,
  Get,
  Param,
  Body,
  Headers,
  Res,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { TerminalScopedThrottle } from '../common/throttler/terminal-throttle'
import type { Response } from 'express'
import { TerminalsService, SAMPLE_PNG, SAMPLE_VISIBLE_PDF } from './terminals.service'
import { TerminalToolboxService } from './terminal-toolbox.service'
import { TerminalCapabilitiesService } from './terminal-capabilities.service'
import { RegisterTerminalDto } from './dto/register-terminal.dto'
import { ExchangeTerminalBindCodeDto } from './dto/exchange-terminal-bind-code.dto'
import { HeartbeatDto } from './dto/heartbeat.dto'
import { ClaimTasksDto } from './dto/claim-tasks.dto'
import { PatchTaskStatusDto } from './dto/patch-task-status.dto'
import { RecordToolboxLaunchEventDto } from './dto/record-toolbox-launch-event.dto'
import { ReportScanDeletionAuditDto } from './dto/report-scan-deletion-audit.dto'
import { ReportReleaseObservationDto } from './dto/report-release-observation.dto'
import { ReleaseObservationService } from './release-observation.service'

@Controller()
export class TerminalsController {
  constructor(
    private readonly terminalsService: TerminalsService,
    private readonly toolbox: TerminalToolboxService,
    private readonly capabilities: TerminalCapabilitiesService,
    private readonly releases: ReleaseObservationService,
  ) {}

  // ── 1. Register ──────────────────────────────────────────────────────────
  // POST /api/v1/auth/terminal/register
  @Post('auth/terminal/register')
  @HttpCode(HttpStatus.OK)
  register(@Body() dto: RegisterTerminalDto) {
    return this.terminalsService.register(dto)
  }

  // POST /api/v1/auth/terminal/exchange-bind-code
  // Windows 新主机用一次性绑定码换取 terminalToken；不需要、不允许携带 adminSecret。
  @Post('auth/terminal/exchange-bind-code')
  @HttpCode(HttpStatus.OK)
  exchangeBindCode(@Body() dto: ExchangeTerminalBindCodeDto) {
    return this.terminalsService.exchangeBindCode(dto)
  }

  // ── 2. Heartbeat ─────────────────────────────────────────────────────────
  // PUT /api/v1/terminals/:terminalId/heartbeat
  @Put('terminals/:terminalId/heartbeat')
  @HttpCode(HttpStatus.OK)
  heartbeat(
    @Param('terminalId') terminalId: string,
    @Body() dto: HeartbeatDto,
    @Headers('authorization') auth: string | undefined,
  ) {
    return this.terminalsService.heartbeat(terminalId, dto, auth)
  }

  // F0.5 only: the Agent receives release identity for observation. It never
  // receives an artifact URL, command, schedule, service instruction or install action.
  @Get('terminals/:terminalId/release-observation-plan')
  @HttpCode(HttpStatus.OK)
  getReleaseObservationPlan(
    @Param('terminalId') terminalId: string,
    @Headers('authorization') auth: string | undefined,
  ) {
    return this.releases.getPlanForTerminal(terminalId, auth)
  }

  @Put('terminals/:terminalId/release-observation')
  @HttpCode(HttpStatus.OK)
  reportReleaseObservation(
    @Param('terminalId') terminalId: string,
    @Body() dto: ReportReleaseObservationDto,
    @Headers('authorization') auth: string | undefined,
  ) {
    return this.releases.reportObservation(terminalId, dto, auth)
  }

  // ── 3. Claim tasks ───────────────────────────────────────────────────────
  // GET /api/v1/terminals/public — 小程序只读安全服务点目录。
  @Get('terminals/public')
  @HttpCode(HttpStatus.OK)
  listPublicTerminals() {
    return this.terminalsService.listPublicTerminals()
  }

  // GET /api/v1/terminals/:terminalId/config
  @Get('terminals/:terminalId/config')
  @HttpCode(HttpStatus.OK)
  getTerminalConfig(@Param('terminalId') terminalId: string) {
    return this.terminalsService.getKioskTerminalConfig(terminalId)
  }

  // POST /api/v1/terminals/:terminalId/toolbox-events
  // 公开匿名运营事件写入面: 只收 itemKey/action/placement,后端反查配置派生标题/域名。
  @Post('terminals/:terminalId/toolbox-events')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  recordToolboxLaunchEvent(
    @Param('terminalId') terminalId: string,
    @Body() dto: RecordToolboxLaunchEventDto,
  ) {
    return this.toolbox.recordLaunchEvent(terminalId, dto)
  }

  // ── 3. Claim tasks ───────────────────────────────────────────────────────
  // POST /api/v1/terminals/:terminalId/tasks/claim
  //
  // 本端点此前无 @Throttle，落进 60 次/分钟的**每 IP** 默认桶。Terminal Agent 每
  // 5 秒 claim 一次（task-runner.ts `claimIntervalMs ?? 5_000`）= 12 次/分钟/台，
  // 而一个大厅的 Agent 共用同一个 NAT 出口 IP：
  //
  //     5 台 Agent × 12 次/分钟 = 60 次/分钟 = 桶满 → 第 6 台起 claim 429
  //     → 打印任务领不走 → **整个大厅停印**（不只是进度条不动）
  //
  // Agent 本来就发 X-Terminal-Id（api-client.ts:52），所以按台计数无需改 Agent。
  @Post('terminals/:terminalId/tasks/claim')
  @HttpCode(HttpStatus.OK)
  @TerminalScopedThrottle(30)
  claimTasks(
    @Param('terminalId') terminalId: string,
    @Body() dto: ClaimTasksDto,
    @Headers('authorization') auth: string | undefined,
  ) {
    return this.terminalsService.claimTasks(terminalId, dto, auth)
  }

  // ── 4. Report expired scan deletion audit ────────────────────────────────
  // Agent-authenticated PII-safe receipt for expired local scan deletion evidence.
  @Post('terminals/:terminalId/scan-deletion-audits')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  reportScanDeletionAudit(
    @Param('terminalId') terminalId: string,
    @Body() dto: ReportScanDeletionAuditDto,
    @Headers('authorization') auth: string | undefined,
  ) {
    return this.terminalsService.reportScanDeletionAudit(terminalId, dto, auth)
  }

  // ── 5. Patch task status ─────────────────────────────────────────────────
  // PATCH /api/v1/print-tasks/:taskId/status
  @Patch('print-tasks/:taskId/status')
  @HttpCode(HttpStatus.OK)
  patchTaskStatus(
    @Param('taskId') taskId: string,
    @Body() dto: PatchTaskStatusDto,
    @Headers('authorization') auth: string | undefined,
    @Headers('x-terminal-id') terminalIdHeader: string | undefined,
  ) {
    return this.terminalsService.patchTaskStatus(taskId, dto, auth, terminalIdHeader)
  }

  // ── 6. Printer status for Kiosk ─────────────────────────────────────────
  // GET /api/v1/terminals/:terminalId/printer-status  (no auth — read-only, non-sensitive)
  @Get('terminals/:terminalId/printer-status')
  @HttpCode(HttpStatus.OK)
  async getTerminalPrinterStatus(@Param('terminalId') terminalId: string) {
    const { found, ...rest } = await this.terminalsService.getTerminalPrinterStatus(terminalId)
    if (!found) {
      throw new NotFoundException({ error: { code: 'TERMINAL_NOT_FOUND', message: '终端不存在' } })
    }
    // 终端存在但未上报心跳：返回 isOnline=false（不是 404）
    return rest
  }

  // ── 5b. Capability gates for Kiosk ──────────────────────────────────────
  // GET /api/v1/terminals/:terminalId/capabilities  (no auth — read-only, non-sensitive)
  // Kiosk 服务中心按此决定能力卡片可用态；未配置的键 configured=false，
  // 前端按各自保守默认处理，不得把 not_verified 放大成可用。
  @Get('terminals/:terminalId/capabilities')
  @HttpCode(HttpStatus.OK)
  async getTerminalCapabilities(@Param('terminalId') terminalId: string) {
    return this.capabilities.listForTerminal(terminalId)
  }

  // ── 6. Test file — mock task download ────────────────────────────────────
  // GET /api/v1/test/sample.png
  @Get('test/sample.png')
  getSamplePng(@Res() res: Response) {
    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Content-Length', SAMPLE_PNG.length)
    res.send(SAMPLE_PNG)
  }

  // GET /api/v1/test/sample-visible.pdf
  @Get('test/sample-visible.pdf')
  getSampleVisiblePdf(@Res() res: Response) {
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Length', SAMPLE_VISIBLE_PDF.length)
    res.send(SAMPLE_VISIBLE_PDF)
  }
}
