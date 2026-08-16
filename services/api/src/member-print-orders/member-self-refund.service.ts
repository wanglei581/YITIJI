/**
 * 会员自助退款受限触发面（A3-S3）。
 *
 * **这不是第二套退款实现。** 出款、幂等、CAS、渠道三分法、收敛与同号重试全部仍在
 * `RefundService.refund()` 里；本服务只做「允不允许这个人现在按下这一单的退款」，
 * 通过后原样调 canonical 入口，且**不传自定义 refundNo** —— 沿用它派生的
 * `RFD-<orderNo>`（一单一退），重复提交天然幂等，绝不换号二次出款。
 *
 * 闸门顺序（错误码互不覆盖，前一闸拒了就不会进下一闸）：
 *   1. 本人归属：只查 `endUserId = 当前会员` 的订单，查不到一律 404（不泄露订单是否存在）。
 *      → 游客单（`endUserId=null`）在本路径上不可达：controller 挂 EndUserAuthGuard，
 *        匿名调用连 401 都过不去。一体机匿名单的退款仍然只能走服务台 + Admin 端点，
 *        这一点是刻意保留的，理由见 PR 与 docs/progress。
 *   2. 资金通道：只放行退款会自动原路回到付款人的通道（见 self-refund-policy）。
 *   3. 可退金额：`amountCents - discountCents <= 0` 直接拒，**绝不建 0 元退款记录**。
 *   4. 状态组合：`payStatus × taskStatus` 查表，未知取值 fail-closed。
 *   5. 按会员限流（落库计数）。
 *   6. → `RefundService.refund()`。
 *
 * 审计走既有 AuditService（不新起表）：成功写 `member.print_order.self_refund`，
 * 触发限流写 `member.print_order.self_refund_rate_limited`。
 */
import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import { RefundService } from '../payment/refund.service'
import { detectKioskFeedbackPii, sanitizeKioskFeedbackText } from '../member-feedback/kiosk-feedback-text'
import type { RequestSelfRefundDto } from './dto/request-self-refund.dto'
import {
  SELF_REFUND_RATE_LIMITS,
  decideSelfRefundState,
  isSelfRefundableChannel,
  selfRefundOperatorId,
  selfRefundReasonText,
  type SelfRefundReasonCode,
} from './self-refund-policy'

/** 会员侧退款回执。刻意不含 `channelRefundNo`（内部账本流水，对用户无意义）。 */
export interface MemberSelfRefundReceipt {
  refundNo: string
  /** 本次退款金额（分）= 实付金额。全额退，不做部分退款。 */
  amountCents: number
  /**
   * 退款单状态，**原样透传**渠道真实结果，绝不提前宣称到账：
   * `pending` = 渠道受理中/结果待确认；`success` = 已确认退款成功；`failed` = 明确失败。
   */
  status: string
  /** 退款去向通道（= 原支付通道，原路退回）。 */
  channel: string
  reasonCode: SelfRefundReasonCode
  order: {
    orderNo: string
    payStatus: string
    refundedAmountCents: number
    refundedAt: string | null
  }
  /** true = 命中既有退款记录（重复提交），本次未产生新的出款动作。 */
  idempotent: boolean
}

function conflict(code: string, message: string): never {
  throw new ConflictException({ error: { code, message } })
}

/** 拒绝码 → 用户可读文案。文案不承诺任何结果，只说明当前为什么不能自助退。 */
const DENY_MESSAGES: Record<string, string> = {
  SELF_REFUND_ORDER_NOT_PAID: '该订单没有已支付的款项，无需退款',
  SELF_REFUND_IN_PROGRESS: '该订单已有一笔退款正在处理中',
  SELF_REFUND_ALREADY_REFUNDED: '该订单已退款',
  SELF_REFUND_TASK_IN_PROGRESS: '正在出纸，暂时不能退款；如有问题请联系现场工作人员',
  SELF_REFUND_TASK_COMPLETED: '该订单已打印完成，如有问题请联系现场工作人员',
  SELF_REFUND_ORDER_CANCELLED: '该订单已取消',
  SELF_REFUND_STATE_UNSUPPORTED: '该订单当前状态不支持自助退款，请联系现场工作人员',
}

@Injectable()
export class MemberSelfRefundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly refunds: RefundService,
  ) {}

  async request(endUserId: string, orderId: string, dto: RequestSelfRefundDto): Promise<MemberSelfRefundReceipt> {
    // ① 自由文本先做纯计算清洗（不打 DB）。只进审计，不参与判定。
    const note = this.resolveNote(dto.note)

    // ② 本人归属。查不到（不存在 / 是别人的 / 是游客单）统一 404，不区分——防订单号枚举。
    const order = await this.prisma.order.findFirst({ where: { id: orderId, endUserId } })
    if (!order) {
      throw new NotFoundException({ error: { code: 'PRINT_ORDER_NOT_FOUND', message: '打印订单不存在' } })
    }

    // ③ 资金通道闸。线下/人工/免费/券单标「已退款」不等于钱回到了用户手里 —— 不伪造能力。
    if (!isSelfRefundableChannel(order.paymentSource)) {
      conflict('SELF_REFUND_CHANNEL_UNSUPPORTED', '该订单的付款方式不支持自助退款，请联系现场工作人员')
    }

    // ④ 金额闸。免费试运营期打印单价为 0，实付 0 的单**没有钱可退**：
    //    这里必须显式拒，既不能建一条 0 元退款记录污染退款账本/对账，也不能 500。
    const refundableAmountCents = order.amountCents - order.discountCents
    if (refundableAmountCents <= 0) {
      conflict('SELF_REFUND_NO_REFUNDABLE_AMOUNT', '该订单实付金额为 0，没有可退款项')
    }

    // ⑤ 状态组合闸（查表，未知取值 fail-closed）。
    const decision = decideSelfRefundState(order.payStatus, order.taskStatus)
    if (!decision.allowed) {
      conflict(decision.code, DENY_MESSAGES[decision.code] ?? '该订单当前状态不支持自助退款')
    }

    // ⑥ 按会员限流（落库计数，跨实例一致）。放在最后：被前面闸拒掉的请求不消耗额度。
    const operatorId = selfRefundOperatorId(endUserId)
    await this.assertWithinRateLimit(operatorId, order.id)

    // ⑦ canonical 退款。**不传 refundNo** —— 沿用 RefundService 派生的 RFD-<orderNo>，
    //    一单一退，重复提交由它自己的幂等门收敛，绝不在这里另造一套。
    const result = await this.refunds.refund(order.id, {
      reason: selfRefundReasonText(dto.reasonCode),
      operatorId,
    })

    await this.audit.write({
      actorId: null,
      actorRole: 'end_user',
      action: 'member.print_order.self_refund',
      targetType: 'order',
      targetId: order.id,
      payload: {
        endUserId,
        reasonCode: dto.reasonCode,
        note,
        refundNo: result.refund.refundNo,
        refundStatus: result.refund.status,
        amountCents: result.refund.amountCents,
        paymentSource: order.paymentSource,
        payStatusBefore: order.payStatus,
        taskStatusBefore: order.taskStatus,
        idempotent: result.idempotent,
      },
    })

    return {
      refundNo: result.refund.refundNo,
      amountCents: result.refund.amountCents,
      status: result.refund.status,
      channel: result.refund.channel,
      reasonCode: dto.reasonCode,
      order: {
        orderNo: result.order.orderNo,
        payStatus: result.order.payStatus,
        refundedAmountCents: result.order.refundedAmountCents,
        refundedAt: result.order.refundedAt,
      },
      idempotent: result.idempotent,
    }
  }

  /**
   * 自由文本清洗 + PII 拒绝，复用匿名反馈那套（`kiosk-feedback-text`）：
   * 退款说明同样没有正当理由出现手机号/身份证/银行卡/邮箱，且这里是「拒绝」不是「脱敏」——
   * 脱敏等于先接收再处理，原文仍会穿过进程与日志。
   */
  private resolveNote(raw: string | undefined): string | null {
    const cleaned = sanitizeKioskFeedbackText(raw ?? '')
    if (!cleaned) return null
    const hit = detectKioskFeedbackPii(cleaned)
    if (hit) {
      // 只回规则名，绝不回显原文片段。
      throw new BadRequestException({
        error: { code: 'SELF_REFUND_NOTE_PII_REJECTED', message: `退款说明请勿填写个人敏感信息（${hit.rule}）` },
      })
    }
    return cleaned
  }

  /**
   * 按会员的落库限流。只统计**自助退款**产生的 Refund 行（`operatorId` 带 member_self: 前缀），
   * Admin 代退与系统收敛不占用户额度。
   */
  private async assertWithinRateLimit(operatorId: string, orderId: string): Promise<void> {
    const now = Date.now()
    for (const limit of SELF_REFUND_RATE_LIMITS) {
      const since = new Date(now - limit.windowMs)
      const used = await this.prisma.refund.count({ where: { operatorId, createdAt: { gte: since } } })
      if (used >= limit.max) {
        await this.audit.write({
          actorId: null,
          actorRole: 'end_user',
          action: 'member.print_order.self_refund_rate_limited',
          targetType: 'order',
          targetId: orderId,
          payload: { operatorId, windowMs: limit.windowMs, max: limit.max, used },
        })
        throw new HttpException(
          { error: { code: 'SELF_REFUND_RATE_LIMITED', message: '退款申请过于频繁，请稍后再试或联系现场工作人员' } },
          HttpStatus.TOO_MANY_REQUESTS,
        )
      }
    }
  }
}
