import { MaintenanceBlocked } from '../ai-access/ai-access.decorator'
import { Body, Controller, Get, Header, Headers, HttpCode, Ip, Param, Post, Query, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { MemberOrderTimelinePage, MemberPendingTaskItem, MemberPrintOrderItem } from './member-print-orders.types'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { MemberPrintOrdersService } from './member-print-orders.service'
import { parseMemberPageQuery } from '../common/utils/member-page'
import { CancelMemberPrintOrderDto } from './dto/cancel-member-print-order.dto'
import { CreateMemberPrintOrderDto } from './dto/create-member-print-order.dto'
import { ResolveOrderSubmissionsDto } from './dto/resolve-order-submissions.dto'
import { assertMemberPrintOrderIdempotencyKey, MemberPrintOrderCreateService } from './member-print-order-create.service'
import { PickupCodeReissueService } from './pickup-code-reissue.service'
import { MemberOrderTimelineService, parseTimelineQuery } from './member-order-timeline.service'
import { MemberOrderClaimHereService } from './member-order-claim-here.service'
import { TerminalIdentityGuard } from '../terminals/terminal-identity.guard'

/**
 * 会员「我的打印订单」接口（Phase C-2C 后续小步）。路由前缀 /api/v1/me/print-orders。
 *
 * 全部受 EndUserAuthGuard 保护：
 * - 必须携带有效会员 token（Bearer，audience=enduser，且 Redis 会话有效）。
 * - 匿名 / 缺 token / 失效 token / 过期会话 / 内部运营 token → 401。
 * - endUserId 来自校验后的 token（req.endUser），service 只按本人 endUserId 读，
 *   不接受任何外部传入用户 id → 跨用户越权天然不可能。
 *
 * 合规（CLAUDE.md §10/§11/§12）：历史列表只返回本人安全元数据；M2 建单
 * 只返回服务端报价、状态和到机码，不返回文件原文、签名链接、哈希或支付会话凭证。
 */
@Controller('me/print-orders')
@UseGuards(EndUserAuthGuard)
export class MemberPrintOrdersController {
  constructor(
    private readonly orders: MemberPrintOrdersService,
    private readonly cloudOrders: MemberPrintOrderCreateService,
    private readonly reissueCodes: PickupCodeReissueService,
    private readonly timeline: MemberOrderTimelineService,
    private readonly claimHereOrders: MemberOrderClaimHereService,
  ) {}

  /** 我的历史 PrintTask 订单列表（本人，只读；游标分页，pageSize 封顶 50）。 */
  @Get()
  async list(
    @CurrentEndUser() user: AuthedEndUser,
    @Query('cursor') cursor?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<ApiResponse<{ items: MemberPrintOrderItem[]; nextCursor: string | null; total: number }>> {
    return ApiResponse.ok(await this.orders.list(user.endUserId, parseMemberPageQuery(cursor, pageSize)))
  }

  /** M2 第一片：创建 Order-only 待到机订单；不会提前创建 Agent 可领取的 PrintTask。 */
  @Post()
  @MaintenanceBlocked()
  async create(
    @CurrentEndUser() user: AuthedEndUser,
    @Body() dto: CreateMemberPrintOrderDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    assertMemberPrintOrderIdempotencyKey(idempotencyKey)
    return ApiResponse.ok(await this.cloudOrders.create(user.endUserId, dto, idempotencyKey))
  }

  /**
   * Owner-scoped batch resolve for print and package Idempotency-Key values.
   * Static path must stay beside POST / so Nest does not treat `submissions` as an orderId.
   */
  @Post('submissions/resolve')
  @HttpCode(200)
  async resolveSubmissions(
    @CurrentEndUser() user: AuthedEndUser,
    @Body() dto: ResolveOrderSubmissionsDto,
  ) {
    for (const key of dto.keys) assertMemberPrintOrderIdempotencyKey(key)
    return ApiResponse.ok(await this.cloudOrders.resolveSubmissions(user.endUserId, dto.keys))
  }

  /** 小程序专用 Order-only 列表；与历史 PrintTask-first 列表分开，避免游标契约漂移。 */
  @Get('cloud')
  async listCloud(@CurrentEndUser() user: AuthedEndUser) {
    return ApiResponse.ok(await this.cloudOrders.listCloud(user.endUserId))
  }

  /**
   * 跨端订单时间线（一体机「我的打印订单」）：一体机现场任务 + 手机单件未到机 + 材料包。
   * 必须声明在 `@Get(':orderId')` 之前，否则 'timeline' 会被当成 orderId。
   * 终端头可选：会话验签通过才算本机（claimableHere）；验不过按无终端处理，不报错。
   */
  @Get('timeline')
  @Header('Cache-Control', 'no-store')
  async listTimeline(
    @CurrentEndUser() user: AuthedEndUser,
    @Headers('x-terminal-id') terminalId: string | undefined,
    @Headers('x-terminal-session-token') sessionToken: string | undefined,
    @Query('cursor') cursor?: string,
    @Query('pageSize') pageSize?: string,
    @Query('status') status?: string,
    @Query('kind') kind?: string,
  ): Promise<ApiResponse<MemberOrderTimelinePage>> {
    const query = parseTimelineQuery({ cursor, pageSize, status, kind })
    const verifiedTerminalId = await this.timeline.resolveVerifiedTerminal(terminalId, sessionToken)
    return ApiResponse.ok(await this.timeline.list(user.endUserId, query, verifiedTerminalId))
  }

  @Get(':orderId')
  async detail(@CurrentEndUser() user: AuthedEndUser, @Param('orderId') orderId: string) {
    return ApiResponse.ok(await this.cloudOrders.detail(user.endUserId, orderId))
  }

  /** 作废当前到机码并重发。旧码立即失效；截止仍是付款起 7 天。 */
  @Post(':orderId/reissue-pickup-code')
  async reissuePickupCode(@CurrentEndUser() user: AuthedEndUser, @Param('orderId') orderId: string) {
    return ApiResponse.ok(await this.reissueCodes.reissue(user.endUserId, orderId))
  }

  /**
   * 会员在一体机上领取自己的单（不用输到机码）。会员身份与终端身份都必需。
   * 响应与 POST /print/jobs/claim-pickup 同形（不包 ApiResponse 信封），一体机可直接复用取件结果处理。
   * 不挂 @MaintenanceBlocked：与 claim-pickup 一样，维护模式不拦已下单的领取。
   */
  @Post(':orderId/claim-here')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @UseGuards(TerminalIdentityGuard)
  claimHere(
    @CurrentEndUser() user: AuthedEndUser,
    @Param('orderId') orderId: string,
    @Headers('x-terminal-id') terminalId: string | undefined,
    @Ip() ip: string,
  ) {
    return this.claimHereOrders.claimHere(user.endUserId, orderId, terminalId, ip || 'unknown')
  }

  @Post(':orderId/cancel')
  async cancel(
    @CurrentEndUser() user: AuthedEndUser,
    @Param('orderId') orderId: string,
    @Body() dto: CancelMemberPrintOrderDto,
  ) {
    return ApiResponse.ok(await this.cloudOrders.cancel(user.endUserId, orderId, dto))
  }
}

@Controller('me/pending-tasks')
@UseGuards(EndUserAuthGuard)
export class MemberPendingTasksController {
  constructor(private readonly orders: MemberPrintOrdersService) {}

  /** 当前登录会员本人可续办的真实任务；无任务返回 []。 */
  @Get()
  @Header('Cache-Control', 'no-store')
  async list(@CurrentEndUser() user: AuthedEndUser): Promise<ApiResponse<MemberPendingTaskItem[]>> {
    return ApiResponse.ok(await this.orders.listPending(user.endUserId))
  }
}
