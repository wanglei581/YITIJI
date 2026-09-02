import { BadRequestException, Body, Controller, Param, Post, UseGuards } from '@nestjs/common'
import { CurrentUser, type AuthedUser } from '../common/decorators/current-user.decorator'
import { Roles } from '../common/decorators/roles.decorator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { RolesGuard } from '../common/guards/roles.guard'
import { AdminMarkPaidDto, AdminRefundDto } from './dto/order-action.dto'
import { OrderStatusService } from './order-status.service'
import { RefundService } from './refund.service'

// Admin 端点只放行线下/人工确认；free 只由 0 元建单自动产生，绝不经 Admin 手动置 free；
// wechat/alipay/benefit 为未来扩展，禁止写入。
const ADMIN_ALLOWED_PAYMENT_SOURCES = ['offline', 'manual_confirmed'] as const

/**
 * Admin 订单动作（P0a 支付域，无 live 网关）。
 *
 * 只做后端端点 + 审计，**无 Admin 前端 UI**（前端联动另批）。
 * 状态机复用 OrderStatusService，不在 controller 重写；操作员身份由 OrderStatusService
 * 写入审计 payload（actorId 为 User 外键，服务级动作置 null，避免非 User 标识触发外键约束）。
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminOrderActionsController {
  constructor(
    private readonly orderStatus: OrderStatusService,
    private readonly refundService: RefundService,
  ) {}

  @Post('admin/orders/:id/mark-paid')
  async markPaid(
    @Param('id') id: string,
    @Body() body: AdminMarkPaidDto,
    @CurrentUser() user: AuthedUser,
  ) {
    // 防御纵深：即便绕过 ValidationPipe，controller 也强制只放行 offline / manual_confirmed。
    if (!(ADMIN_ALLOWED_PAYMENT_SOURCES as readonly string[]).includes(body.paymentSource)) {
      throw new BadRequestException('PAYMENT_SOURCE_NOT_ADMIN_ALLOWED')
    }
    const order = await this.orderStatus.markPaid(id, { paymentSource: body.paymentSource, operatorId: user.userId })
    // 只回入账结论，不把整行 Order 交给浏览器。
    //
    // markPaid 的返回值是完整 Prisma Order 行，其中含 pickupCodeEnc（到机码密文）。
    // schema.prisma 的 Order 段落写着「日志、审计、Admin 视图均不得返回 codeEnc」，
    // 只读订单视图也早已裁掉它。此前本端点把整行原样 res.json()，等于让密文进入
    // 管理员浏览器、DevTools 与任何记录响应体的反代日志。
    //
    // pickupCode 保留：一体机现场单的取件凭证码由 markPaid 现铸，运营就是要把它
    // 念给用户，这是线下收款模式的必要产出。而小程序云打印单的真码存在
    // pickupCodeHash/Enc 里、只在用户手机上解密显示，本服务已不再为这类单另铸码
    // （见 order-status.service.ts 的 mintPickupCode），此处恒为 null —— 正好避免
    // 运营念出一枚无法认领的幽灵码。
    return {
      id: order.id,
      payStatus: order.payStatus,
      paymentSource: order.paymentSource,
      paidAt: order.paidAt,
      pickupCode: order.pickupCode,
    }
  }

  // C5-4：Admin 退款走 canonical RefundService（Refund 账本 + sandbox provider 退款 + 幂等 + 审计）。
  // refundNo 缺省按订单派生（一单一退幂等）；仅 admin auth/role 放行，绝不新增匿名/会员自助退款入口。
  @Post('admin/orders/:id/refund')
  async refund(
    @Param('id') id: string,
    @Body() body: AdminRefundDto,
    @CurrentUser() user: AuthedUser,
  ) {
    return this.refundService.refund(id, { reason: body.refundReason, operatorId: user.userId })
  }
}
