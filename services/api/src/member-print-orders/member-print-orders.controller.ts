import { Controller, Get, UseGuards } from '@nestjs/common'
import type { MemberPrintOrderItem } from './member-print-orders.types'
import { ApiResponse } from '../common/dto/api-response.dto'
import { CurrentEndUser, type AuthedEndUser } from '../common/decorators/current-end-user.decorator'
import { EndUserAuthGuard } from '../common/guards/end-user-auth.guard'
import { MemberPrintOrdersService } from './member-print-orders.service'

/**
 * 会员「我的打印订单」接口（Phase C-2C 后续小步）。路由前缀 /api/v1/me/print-orders。
 *
 * 全部受 EndUserAuthGuard 保护：
 * - 必须携带有效会员 token（Bearer，audience=enduser，且 Redis 会话有效）。
 * - 匿名 / 缺 token / 失效 token / 过期会话 / 内部运营 token → 401。
 * - endUserId 来自校验后的 token（req.endUser），service 只按本人 endUserId 读，
 *   不接受任何外部传入用户 id → 跨用户越权天然不可能。
 *
 * 合规（CLAUDE.md §10/§11/§12）：只读安全元数据；不返回文件原文 / 签名链接 / 哈希 /
 * 支付字段；不新增任何支付 / 退款 / 套餐 / 核销逻辑。
 */
@Controller('me/print-orders')
@UseGuards(EndUserAuthGuard)
export class MemberPrintOrdersController {
  constructor(private readonly orders: MemberPrintOrdersService) {}

  /** 我的打印订单列表（本人，只读）。无订单返回 []。 */
  @Get()
  async list(@CurrentEndUser() user: AuthedEndUser): Promise<ApiResponse<MemberPrintOrderItem[]>> {
    return ApiResponse.ok(await this.orders.list(user.endUserId))
  }
}
