import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { RedisService } from '../common/redis/redis.service'
import { resolveMiniappVirtualPayAppKeyForEnv } from '../config/production-runtime-gates'
import { MiniappAccessTokenService } from '../miniapp-access-token/miniapp-access-token.service'
import { PrismaService } from '../prisma/prisma.service'
import { getVirtualPayOrderForAdmin, type VirtualPayAdminOrderView } from './virtual-pay-admin-orders'
import { VIRTUAL_PAY_DIAGNOSTIC_ACTION } from './virtual-pay-order.service'
import { reconcileRefundingOrder, syncNonRefundingOrderWithWechat } from './virtual-pay-refund-reconcile'
import { queryWechatVirtualPayOrder } from './virtual-pay-xpay-client'
import {
  VIRTUAL_PAY_ADMIN_SYNC_AUDIT_ACTION,
  VIRTUAL_PAY_REFUND_ERRCODE_CONSUMED,
  VIRTUAL_PAY_REFUND_ERRCODE_IN_PROGRESS,
  VIRTUAL_PAY_REFUND_INITIATED_AUDIT_ACTION,
  markVirtualPayRefundFailed,
  newVirtualPayRefundOrderId,
  refundWechatVirtualPayOrder,
  settleVirtualPayRefundSucceeded,
} from './virtual-pay-xpay-refund'
import {
  VIRTUAL_PAY_REFUND_REASONS,
  VIRTUAL_PAY_REFUND_REQ_FROM_MERCHANT,
  VIRTUAL_PAY_REFUND_WINDOW_MS,
  type VirtualPayRefundReasonCode,
} from './virtual-pay.contract'

export interface VirtualPayRefundDeps {
  fetchImpl?: typeof fetch
  now?: Date
  timeoutMs?: number
}

export interface VirtualPaySyncResult {
  order: VirtualPayAdminOrderView
  wxStatus: number | null
  leftFee: number | null
}

function mapEnvType(envType: number | undefined): 0 | 1 | null {
  if (envType === 1) return 0
  if (envType === 2) return 1
  return null
}

function resolveRefundReasonCode(code?: string): VirtualPayRefundReasonCode {
  if (code && (VIRTUAL_PAY_REFUND_REASONS as readonly string[]).includes(code)) {
    return code as VirtualPayRefundReasonCode
  }
  return '0'
}

@Injectable()
export class VirtualPayRefundService {
  private readonly logger = new Logger(VirtualPayRefundService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tokens: MiniappAccessTokenService,
    @Optional() private readonly redis?: RedisService,
  ) {}

  /**
   * 管理员发起微信虚拟支付官方原路退款（/xpay/refund_order）。
   * 严格按核对表 §3.10–3.15、§5.1–5.8：
   * 1. 仅允许 paid + credit available + 有 openId + 支付 365 天内；
   * 2. 先调 query_order 取 left_fee（已退直接收敛到 refunded）；
   * 3. 事务内原子锁 credit（available → refunding）和 order（paid → refunding + 持久化 refundOrderId）；
   * 4. 调 /xpay/refund_order（pay_sig 签实际 body，refund_reason 与 req_from 为字符串）；
   * 5. 受理成功保持 refunding 等待通知/查单确认；失败绝不盲目恢复权益为 available。
   */
  async initiateRefund(
    orderId: string,
    input: { confirm?: boolean; reason?: string; refundReasonCode?: string; operatorId: string },
    deps?: VirtualPayRefundDeps,
  ): Promise<VirtualPayAdminOrderView> {
    if (input.confirm !== true) {
      throw new BadRequestException({
        error: { code: 'VPAY_REFUND_CONFIRM_REQUIRED', message: '发起原路退款必须二次确认' },
      })
    }
    const now = deps?.now ?? new Date()
    const fetchImpl = deps?.fetchImpl ?? fetch
    const order = await this.prisma.virtualPayOrder.findUnique({
      where: { id: orderId },
      include: { credit: true },
    })
    if (!order) {
      throw new NotFoundException({
        error: { code: 'VPAY_ORDER_NOT_FOUND', message: '没有找到这笔虚拟支付订单' },
      })
    }
    this.assertRefundPreconditions(order, now)
    const { appKey, token } = await this.requireWechatAuth(order.env, fetchImpl)

    let queried
    try {
      queried = await queryWechatVirtualPayOrder({
        openId: order.openId!,
        env: order.env,
        orderId: order.outTradeNo,
        appKey,
        token,
        fetchImpl,
        timeoutMs: deps?.timeoutMs,
      })
    } catch {
      throw new BadGatewayException({
        error: { code: 'VPAY_QUERY_FAILED', message: '向微信查询可退金额失败，请稍后重试' },
      })
    }
    if (queried.errcode !== 0 || !queried.order) {
      throw new BadGatewayException({
        error: { code: 'VPAY_QUERY_FAILED', message: '向微信查询可退金额未成功，请稍后重试' },
      })
    }
    const wxEnv = mapEnvType(queried.order.env_type)
    if (wxEnv !== null && wxEnv !== order.env) {
      throw new ConflictException({
        error: { code: 'VPAY_ENV_MISMATCH', message: '微信订单环境与本地记录不一致，已拦截退款' },
      })
    }
    if (queried.order.status === 6 || (queried.order.left_fee === 0 && Boolean(order.refundOrderId))) {
      await settleVirtualPayRefundSucceeded(this.prisma, this.audit, {
        orderId: order.id,
        outTradeNo: order.outTradeNo,
        refundOrderId: order.refundOrderId,
        wxRefundId: queried.order.wx_refund_id ?? order.wxRefundId,
        source: 'precheck',
      })
      return (await getVirtualPayOrderForAdmin(this.prisma, order.id))!
    }
    const leftFee = queried.order.left_fee
    if (typeof leftFee !== 'number' || !Number.isInteger(leftFee) || leftFee < order.priceCents) {
      throw new ConflictException({
        error: { code: 'VPAY_LEFT_FEE_INSUFFICIENT', message: '微信侧剩余可退金额不足，无法发起全额退款' },
      })
    }

    const reasonText = input.reason?.trim().slice(0, 200) || '管理员原路退款'
    const refundReasonCode = resolveRefundReasonCode(input.refundReasonCode)

    const locked = await this.prisma.$transaction(async (tx) => {
      const fresh = await tx.virtualPayOrder.findUnique({
        where: { id: order.id },
        include: { credit: true },
      })
      if (!fresh) {
        throw new NotFoundException({
          error: { code: 'VPAY_ORDER_NOT_FOUND', message: '没有找到这笔虚拟支付订单' },
        })
      }
      this.assertRefundPreconditions(fresh, now)
      const creditClaimed = await tx.memberServiceCredit.updateMany({
        where: {
          sourceOrderId: fresh.id,
          status: 'available',
          consumedAt: null,
          consumedServiceOrderId: null,
        },
        data: { status: 'refunding' },
      })
      if (creditClaimed.count !== 1) {
        throw new ConflictException({
          error: { code: 'VPAY_CREDIT_NOT_AVAILABLE', message: '该订单对应权益已被使用或正在退款中' },
        })
      }
      const refundOrderId = fresh.refundOrderId ?? newVirtualPayRefundOrderId()
      const orderClaimed = await tx.virtualPayOrder.updateMany({
        where: { id: fresh.id, status: 'paid' },
        data: {
          status: 'refunding',
          refundOrderId,
          refundReason: reasonText,
          lastDiagnosticReason: null,
        },
      })
      if (orderClaimed.count !== 1) {
        throw new ConflictException({
          error: { code: 'VPAY_REFUND_IN_PROGRESS', message: '订单状态已变化，请刷新后再查' },
        })
      }
      await this.audit.writeRequired(tx, {
        actorId: input.operatorId,
        actorRole: 'admin',
        action: VIRTUAL_PAY_REFUND_INITIATED_AUDIT_ACTION,
        targetType: 'virtual_pay_order',
        targetId: fresh.outTradeNo,
        payload: {
          refundOrderId,
          priceCents: fresh.priceCents,
          leftFee,
          reason: reasonText,
          refundReasonCode,
        },
      })
      return { refundOrderId }
    })

    try {
      const response = await refundWechatVirtualPayOrder({
        openId: order.openId!,
        orderId: order.outTradeNo,
        refundOrderId: locked.refundOrderId,
        leftFee,
        refundFee: order.priceCents,
        bizMeta: `vpay:${order.outTradeNo}`,
        refundReason: refundReasonCode,
        reqFrom: VIRTUAL_PAY_REFUND_REQ_FROM_MERCHANT,
        env: order.env,
        appKey,
        token,
        fetchImpl,
        timeoutMs: deps?.timeoutMs,
      })
      if (response.errcode === 0) {
        if (response.refund_wx_order_id) {
          await this.prisma.virtualPayOrder.updateMany({
            where: { id: order.id, status: 'refunding' },
            data: { wxRefundId: response.refund_wx_order_id },
          })
        }
      } else if (response.errcode === VIRTUAL_PAY_REFUND_ERRCODE_IN_PROGRESS) {
        await this.recordInProgressDiagnostic(order.id, order.outTradeNo, 'refund_in_progress_268490014')
      } else {
        const reason = response.errcode === VIRTUAL_PAY_REFUND_ERRCODE_CONSUMED
          ? 'refund_consumed_forbidden_268490013'
          : `refund_wechat_err_${response.errcode ?? 'unknown'}`
        await markVirtualPayRefundFailed(
          this.prisma,
          this.audit,
          { redis: this.redis, logger: this.logger, fetchImpl },
          {
            orderId: order.id,
            outTradeNo: order.outTradeNo,
            reason,
            source: 'initiate',
            extra: { errcode: response.errcode ?? null, refundOrderId: locked.refundOrderId },
          },
        )
      }
    } catch {
      await markVirtualPayRefundFailed(
        this.prisma,
        this.audit,
        { redis: this.redis, logger: this.logger, fetchImpl },
        {
          orderId: order.id,
          outTradeNo: order.outTradeNo,
          reason: 'refund_request_failed',
          source: 'initiate',
          extra: { refundOrderId: locked.refundOrderId },
        },
      )
    }

    return (await getVirtualPayOrderForAdmin(this.prisma, order.id))!
  }

  /**
   * 管理员单笔主动调 query_order 同步订单与权益状态。
   * 仅当微信明确回报已支付且 left_fee >= priceCents 时，才允许把 refund_failed 的单恢复回 paid + available
   *（并保留 refundOrderId 以满足同参重发幂等）。
   */
  async syncOrder(
    orderId: string,
    operatorId: string,
    deps?: VirtualPayRefundDeps,
  ): Promise<VirtualPaySyncResult> {
    const fetchImpl = deps?.fetchImpl ?? fetch
    const order = await this.prisma.virtualPayOrder.findUnique({
      where: { id: orderId },
      include: { credit: true },
    })
    if (!order) {
      throw new NotFoundException({
        error: { code: 'VPAY_ORDER_NOT_FOUND', message: '没有找到这笔虚拟支付订单' },
      })
    }
    if (!order.openId) {
      throw new ConflictException({
        error: { code: 'VPAY_REFUND_OPENID_MISSING', message: '该订单对应会员已注销或缺少微信标识，无法向微信查单' },
      })
    }
    const { appKey, token } = await this.requireWechatAuth(order.env, fetchImpl)

    let wxStatus: number | null = null
    let leftFee: number | null = null

    if (order.status === 'refunding') {
      const outcome = await reconcileRefundingOrder(
        { prisma: this.prisma, audit: this.audit, redis: this.redis, logger: this.logger, source: 'admin_sync' },
        order,
        token,
        fetchImpl,
        deps?.timeoutMs,
      )
      wxStatus = outcome.wxStatus
      leftFee = outcome.leftFee
    } else {
      const synced = await syncNonRefundingOrderWithWechat(
        { prisma: this.prisma, audit: this.audit, appKey, token, fetchImpl, timeoutMs: deps?.timeoutMs },
        order,
      )
      wxStatus = synced.wxStatus
      leftFee = synced.leftFee
    }

    await this.audit.write({
      actorId: operatorId,
      actorRole: 'admin',
      action: VIRTUAL_PAY_ADMIN_SYNC_AUDIT_ACTION,
      targetType: 'virtual_pay_order',
      targetId: order.outTradeNo,
      payload: { wxStatus, leftFee },
    })

    const updated = await getVirtualPayOrderForAdmin(this.prisma, order.id)
    return { order: updated!, wxStatus, leftFee }
  }

  private assertRefundPreconditions(
    order: {
      status: string
      openId: string | null
      paidAt: Date | null
      credit: { status: string } | null
    },
    now: Date,
  ): void {
    if (order.status === 'refunding') {
      throw new ConflictException({
        error: { code: 'VPAY_REFUND_IN_PROGRESS', message: '该订单正在退款处理中，请稍后同步查单确认结果' },
      })
    }
    if (order.status === 'refunded') {
      throw new ConflictException({
        error: { code: 'VPAY_ALREADY_REFUNDED', message: '该订单已退款，请勿重复退款' },
      })
    }
    if (order.status !== 'paid') {
      throw new ConflictException({
        error: { code: 'VPAY_ORDER_NOT_REFUNDABLE', message: '只有已支付订单才允许发起原路退款' },
      })
    }
    if (!order.credit) {
      throw new ConflictException({
        error: { code: 'VPAY_CREDIT_NOT_AVAILABLE', message: '该订单没有可退回的可用权益' },
      })
    }
    if (order.credit.status === 'consumed') {
      throw new ConflictException({
        error: { code: 'VPAY_CREDIT_CONSUMED', message: '该订单对应权益已核销，不允许退款' },
      })
    }
    if (order.credit.status !== 'available') {
      throw new ConflictException({
        error: { code: 'VPAY_CREDIT_NOT_AVAILABLE', message: '该订单对应权益当前不可退' },
      })
    }
    if (!order.openId) {
      throw new ConflictException({
        error: { code: 'VPAY_REFUND_OPENID_MISSING', message: '该会员账号已注销或缺少微信标识，无法发起微信原路退款' },
      })
    }
    if (!order.paidAt || now.getTime() - order.paidAt.getTime() > VIRTUAL_PAY_REFUND_WINDOW_MS) {
      throw new ConflictException({
        error: { code: 'VPAY_REFUND_WINDOW_EXPIRED', message: '支付时间已超过 365 天，无法通过微信虚拟支付发起退款' },
      })
    }
  }

  private async requireWechatAuth(orderEnv: number, fetchImpl: typeof fetch): Promise<{ appKey: string; token: string }> {
    if (process.env['NODE_ENV'] === 'production' && orderEnv === 1) {
      throw new ServiceUnavailableException({
        error: { code: 'VPAY_SANDBOX_FORBIDDEN', message: '生产环境禁止操作沙箱虚拟支付订单' },
      })
    }
    const appKey = resolveMiniappVirtualPayAppKeyForEnv(orderEnv)
    if (!appKey) {
      throw new ServiceUnavailableException({
        error: { code: 'VPAY_CONFIG_MISSING', message: '缺少对应环境的微信虚拟支付密钥配置' },
      })
    }
    try {
      const token = await this.tokens.getAccessToken(fetchImpl)
      return { appKey, token }
    } catch {
      throw new ServiceUnavailableException({
        error: { code: 'VPAY_TOKEN_UNAVAILABLE', message: '获取微信接口凭证失败，请稍后重试' },
      })
    }
  }

  private async recordInProgressDiagnostic(orderId: string, outTradeNo: string, reason: string): Promise<void> {
    await this.prisma.virtualPayOrder.updateMany({
      where: { id: orderId, status: 'refunding' },
      data: { lastDiagnosticReason: reason },
    })
    await this.audit.write({
      actorId: null,
      actorRole: 'system',
      action: VIRTUAL_PAY_DIAGNOSTIC_ACTION,
      targetType: 'virtual_pay_order',
      targetId: outTradeNo,
      payload: { reason },
    })
  }
}
