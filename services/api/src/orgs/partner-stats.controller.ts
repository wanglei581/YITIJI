// Partner 数据统计 HTTP 端点
//
//   GET /partner/stats?period=week|month|quarter
//   GET /partner/terminal-operations?period=week|month|quarter
//
// orgId 取自 JWT token（user.orgId），不接受外部传参 → 跨机构不可达。
// 后端计算所有聚合，前端只做展示，不在客户端拼凑经营数据。
//
// ── C1 契约裁定（2026-08-16）────────────────────────────────────────────────
//
// 1. 响应信封：**保持裸对象，不套 ApiResponse.ok()**。
//    依据：`services/api/src/orgs/` 全部 9 个文件 ApiResponse 出现 0 次，
//    同模块的 partner-org / admin-orgs / partner-account-action 控制器一律返回裸对象，
//    对应前端 adapter（`orgSelf.ts` / `policies.ts`）也一律 `res.json() as Promise<T>`。
//    只给 /partner/stats 套信封会让它成为本模块唯一的异类。
//    修复方向改为前端 adapter 不再取 `body.data`（该端点当前 0 消费者，改前端零影响）。
//
// 2. timezone：**不进 DTO**。分桶时区在 service 里硬编码 Asia/Shanghai，
//    加一个不被消费的字段只是让请求「通过」，属于另一种假实现。
//    改为服务端在响应里单向声明 `timezone`，前端照实渲染。
//    因此本 DTO 仍只有 period —— 全局 ValidationPipe 的
//    `forbidNonWhitelisted: true`（main.ts:88-91）会继续把 ?timezone= 拒成 400，
//    这是**刻意保留**的防注入行为，前端不再发送该参数。

import { Controller, ForbiddenException, Get, Query, UseGuards } from '@nestjs/common'
import { IsEnum, IsOptional } from 'class-validator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { Roles } from '../common/decorators/roles.decorator'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { PartnerOrgRequiredError, requirePartnerOrgId, type PartnerOrgId } from '../console-screen/console-screen.org'
import { PartnerStatsService, type StatsPeriod } from './partner-stats.service'
import type { PartnerTerminalOperations } from './partner-terminal-ops'

export class PartnerStatsQueryDto {
  @IsOptional()
  @IsEnum(['week', 'month', 'quarter'])
  period?: StatsPeriod
}

/**
 * orgId 只来自 JwtAuthGuard 回源后的当前用户。未绑定机构 → 403 ORG_REQUIRED，
 * 绝不退化成全局查询（与数据大屏 console-screen.partner.controller 同一写法）。
 */
function scopedPartnerOrgId(orgId: unknown): PartnerOrgId {
  try {
    return requirePartnerOrgId(orgId)
  } catch (error) {
    if (error instanceof PartnerOrgRequiredError) {
      throw new ForbiddenException({
        error: { code: 'ORG_REQUIRED', message: '当前账号未绑定机构' },
      })
    }
    throw error
  }
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('partner')
export class PartnerStatsController {
  constructor(private readonly stats: PartnerStatsService) {}

  /** GET /partner/stats */
  @Get('partner/stats')
  getStats(
    @CurrentUser() user: AuthedUser,
    @Query() query: PartnerStatsQueryDto,
  ) {
    return this.stats.getStats(scopedPartnerOrgId(user.orgId), query.period ?? 'week')
  }

  /**
   * GET /partner/terminal-operations?period=week|month|quarter
   *
   * 本机构终端的打印扫描服务次数、出纸成功率与故障恢复。查询参数只白名单 period，
   * ?orgId= 或任何未知参数由全局 ValidationPipe 拒成 400。
   */
  @Get('partner/terminal-operations')
  getTerminalOperations(
    @CurrentUser() user: AuthedUser,
    @Query() query: PartnerStatsQueryDto,
  ): Promise<PartnerTerminalOperations> {
    return this.stats.getTerminalOperations(scopedPartnerOrgId(user.orgId), query.period ?? 'week')
  }
}
