// ============================================================
// Terminals Controller — Phase 8.1B
//
// Routes:
//   POST  /auth/terminal/register               — no auth
//   PUT   /terminals/:terminalId/heartbeat      — Bearer token
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
} from '@nestjs/common'
import type { Response } from 'express'
import { TerminalsService, SAMPLE_PNG, SAMPLE_VISIBLE_PDF } from './terminals.service'
import { RegisterTerminalDto } from './dto/register-terminal.dto'
import { HeartbeatDto } from './dto/heartbeat.dto'
import { ClaimTasksDto } from './dto/claim-tasks.dto'
import { PatchTaskStatusDto } from './dto/patch-task-status.dto'

@Controller()
export class TerminalsController {
  constructor(private readonly terminalsService: TerminalsService) {}

  // ── 1. Register ──────────────────────────────────────────────────────────
  // POST /api/v1/auth/terminal/register
  @Post('auth/terminal/register')
  @HttpCode(HttpStatus.OK)
  register(@Body() dto: RegisterTerminalDto) {
    return this.terminalsService.register(dto)
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

  // ── 3. Claim tasks ───────────────────────────────────────────────────────
  // POST /api/v1/terminals/:terminalId/tasks/claim
  @Post('terminals/:terminalId/tasks/claim')
  @HttpCode(HttpStatus.OK)
  claimTasks(
    @Param('terminalId') terminalId: string,
    @Body() dto: ClaimTasksDto,
    @Headers('authorization') auth: string | undefined,
  ) {
    return this.terminalsService.claimTasks(terminalId, dto, auth)
  }

  // ── 4. Patch task status ─────────────────────────────────────────────────
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

  // ── 5. Test file — mock task download ────────────────────────────────────
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
