import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { MemberPendingTaskItem, MemberPrintOrderItem } from './member-print-orders.types'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { MemberPrintOrdersService } from './member-print-orders.service'
import { parseMemberPageQuery } from '../common/utils/member-page'
import { CancelMemberPrintOrderDto } from './dto/cancel-member-print-order.dto'
import { CreateMemberPrintOrderDto } from './dto/create-member-print-order.dto'
import { RequestSelfRefundDto } from './dto/request-self-refund.dto'
import { MemberPrintOrderCreateService } from './member-print-order-create.service'
import { MemberSelfRefundService, type MemberSelfRefundReceipt } from './member-self-refund.service'

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
    private readonly selfRefund: MemberSelfRefundService,
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
  async create(@CurrentEndUser() user: AuthedEndUser, @Body() dto: CreateMemberPrintOrderDto) {
    return ApiResponse.ok(await this.cloudOrders.create(user.endUserId, dto))
  }

  /** 小程序专用 Order-only 列表；与历史 PrintTask-first 列表分开，避免游标契约漂移。 */
  @Get('cloud')
  async listCloud(@CurrentEndUser() user: AuthedEndUser) {
    return ApiResponse.ok(await this.cloudOrders.listCloud(user.endUserId))
  }

  @Get(':orderId')
  async detail(@CurrentEndUser() user: AuthedEndUser, @Param('orderId') orderId: string) {
    return ApiResponse.ok(await this.cloudOrders.detail(user.endUserId, orderId))
  }

  @Post(':orderId/cancel')
  async cancel(
    @CurrentEndUser() user: AuthedEndUser,
    @Param('orderId') orderId: string,
    @Body() dto: CancelMemberPrintOrderDto,
  ) {
    return ApiResponse.ok(await this.cloudOrders.cancel(user.endUserId, orderId, dto))
  }

  /**
   * A3-S3：会员自助退款受限触发面。
   *
   * 退款实现仍是 `RefundService.refund()`（幂等 / CAS / 渠道三分法），本端点只是它前面的门禁：
   * 原因码白名单 + 资金通道白名单 + 可退金额 > 0 + `payStatus × taskStatus` 组合表 + 本人归属 + 限流。
   * 拒绝一律是明确 4xx（403/404/409/429）并带机器码，前端据码出文案，绝不吞成 500。
   *
   * **不覆盖游客单**：本控制器挂 `EndUserAuthGuard`，匿名一体机订单（`endUserId=null`）
   * 在这里拿到的是 401 —— 它们的退款仍然只能走服务台 + `POST /admin/orders/:id/refund`。
   *
   * `@Throttle` 6 次/分钟是 IP 层的突发保护（全局默认 60 次/分钟，这里收紧 10 倍）；
   * 跨实例一致的额度由 service 里按会员落库计数负责。
   */
  @Post(':orderId/refund')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 6 } })
  async requestRefund(
    @CurrentEndUser() user: AuthedEndUser,
    @Param('orderId') orderId: string,
    @Body() dto: RequestSelfRefundDto,
  ): Promise<ApiResponse<MemberSelfRefundReceipt>> {
    return ApiResponse.ok(await this.selfRefund.request(user.endUserId, orderId, dto))
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
