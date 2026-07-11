/**
 * Admin 打印扫描统一任务中心（Task 10）。
 *
 * Routes（/api/v1 前缀，全部 admin-only）：
 *   GET  /admin/print-scan/tasks                 — 按类型分页列表（未上线类型返回空 + implemented=false）
 *   GET  /admin/print-scan/tasks/:type/:taskId   — 类型感知详情（不含签名 URL / 原文错误信息）
 *   POST /admin/print-scan/tasks/:type/:taskId/actions — 类型感知动作（print.retry / scan.cancel，写审计）
 */

import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { ApiResponse } from '../common/dto/api-response.dto'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { AuditService } from '../audit/audit.service'
import { AdminPrintScanService } from './admin-print-scan.service'
import { ApplyPrintScanActionDto } from './dto/apply-print-scan-action.dto'
import type {
  AdminPrintScanActionResult,
  AdminPrintScanTaskDetail,
  AdminPrintScanTaskPage,
} from './admin-print-scan.types'

interface AuditReq {
  headers: Record<string, string | string[] | undefined>
  requestId?: string
  ip?: string
  socket?: { remoteAddress?: string }
}

function safeInt(value: string | undefined, defaultValue: number, min: number, max: number): number {
  const n = value !== undefined ? Number(value) : defaultValue
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : defaultValue
}

@Controller('admin/print-scan')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminPrintScanController {
  constructor(
    private readonly printScan: AdminPrintScanService,
    private readonly audit: AuditService,
  ) {}

  @Get('tasks')
  async listTasks(
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('terminalId') terminalId?: string,
    @Query('page') pageStr?: string,
    @Query('pageSize') sizeStr?: string,
  ): Promise<ApiResponse<AdminPrintScanTaskPage>> {
    return ApiResponse.ok(
      await this.printScan.listTasks({
        type: type?.trim() || 'print',
        status: status?.trim() || undefined,
        terminalId: terminalId?.trim() || undefined,
        page: safeInt(pageStr, 1, 1, 10_000),
        pageSize: safeInt(sizeStr, 20, 1, 100),
      }),
    )
  }

  @Get('tasks/:type/:taskId')
  async getTaskDetail(
    @Param('type') type: string,
    @Param('taskId') taskId: string,
  ): Promise<ApiResponse<AdminPrintScanTaskDetail>> {
    return ApiResponse.ok(await this.printScan.getTaskDetail(type, taskId))
  }

  @Post('tasks/:type/:taskId/actions')
  async applyAction(
    @Param('type') type: string,
    @Param('taskId') taskId: string,
    @Body() dto: ApplyPrintScanActionDto,
    @CurrentUser() user: AuthedUser,
    @Req() req: AuditReq,
  ): Promise<ApiResponse<AdminPrintScanActionResult>> {
    const result = await this.printScan.applyAction(type, taskId, dto.action)
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: `print_scan.task.${result.action}`,
      targetType: 'print_scan_task',
      targetId: result.taskId,
      payload: {
        taskType: result.type,
        action: result.action,
        fromStatus: result.fromStatus,
        toStatus: result.toStatus,
      },
      ipAddress: extractIp(req),
      userAgent: extractUa(req),
      requestId: req.requestId ?? null,
    })
    return ApiResponse.ok(result)
  }
}

function extractIp(req: AuditReq): string | null {
  const fwd = req.headers['x-forwarded-for']
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0]!.trim()
  return req.ip ?? req.socket?.remoteAddress ?? null
}

function extractUa(req: AuditReq): string | null {
  const ua = req.headers['user-agent']
  return typeof ua === 'string' ? ua : null
}
