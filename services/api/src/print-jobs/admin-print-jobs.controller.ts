// ============================================================
// AdminPrintJobsController
//
// Admin 专属打印任务操作端点（受 JwtAuthGuard + RolesGuard('admin') 保护）。
//
// 路由（均含 /api/v1 前缀）：
//   POST /admin/print-jobs/:id/abandon         — 废弃单条历史 pending 孤单
//   POST /admin/print-jobs/:id/verify-outcome  — 核查出纸结果（printed / not_printed）
// ============================================================

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { CurrentUser } from '../common/decorators/current-user.decorator'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import { AdminPrintJobsAbandonService } from './admin-print-jobs-abandon.service'
import { AdminPrintJobsVerifyOutcomeService } from './admin-print-jobs-verify-outcome.service'

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminPrintJobsController {
  constructor(
    private readonly abandonSvc: AdminPrintJobsAbandonService,
    private readonly verifyOutcomeSvc: AdminPrintJobsVerifyOutcomeService,
  ) {}

  /**
   * 废弃单条历史 pending 孤单（claimedAt===null，未被 Terminal Agent 领取）。
   *
   * 请求无需 body；:id 为 PrintTask.id。
   * 幂等：已处于 abandoned 状态则直接返回当前快照，不写入二次 AuditLog。
   *
   * 成功 200：{ taskId, previousStatus, newStatus, orderId, abandonedAt }
   * 失败 400/404/409：{ error: { code, message } }
   */
  @Post('admin/print-jobs/:id/abandon')
  @HttpCode(HttpStatus.OK)
  async abandonPending(
    @Param('id') id: string,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.abandonSvc.abandonPending(id, user.userId)
  }

  /**
   * 核查出纸结果。不改 errorCode / status，只写 printOutcome。
   *
   * body: { outcome: 'printed' | 'not_printed', confirm: 'VERIFY_PRINTED' | 'VERIFY_NOT_PRINTED' }
   */
  @Post('admin/print-jobs/:id/verify-outcome')
  @HttpCode(HttpStatus.OK)
  async verifyOutcome(
    @Param('id') id: string,
    @Body() body: { outcome?: unknown; confirm?: unknown },
    @CurrentUser() user: AuthedUser,
  ) {
    return this.verifyOutcomeSvc.verifyOutcome(id, body ?? {}, user.userId)
  }
}
