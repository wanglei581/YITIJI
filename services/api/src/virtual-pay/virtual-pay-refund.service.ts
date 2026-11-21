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
import { sendVirtualPayOpsAlert } from './virtual-pay-alert'
import { VIRTUAL_PAY_DIAGNOSTIC_ACTION } from './virtual-pay-order.service'
import { reconcileRefundingOrder, syncNonRefundingOrderWithWechat } from './virtual-pay-refund-reconcile'
import { queryWechatVirtualPayOrder } from './virtual-pay-xpay-client'
import {
  VIRTUAL_PAY_ADMIN_SYNC_AUDIT_ACTION,
  VIRTUAL_PAY_REFUND_ERRCODE_CONSUMED,
  VIRTUAL_PAY_REFUND_ERRCODE_IN_PROGRESS,
  VIRTUAL_PAY_REFUND_INITIATED_AUDIT_ACTION,
  assertVirtualPayRefundPreconditions,
  formatFrozenRefundReason,
  isRetryableIndeterminateOrder,
  mapWechatEnvType,
  markVirtualPayRefundFailed,
  newVirtualPayRefundOrderId,
  parseFrozenRefundReasonCode,
  refundWechatVirtualPayOrder,
  resolveRefundReasonCode,
  settleVirtualPayRefundSucceeded,
} from './virtual-pay-xpay-refund'
import {
  VIRTUAL_PAY_REFUND_REQ_FROM_MERCHANT,
  WECHAT_VPAY_STATUS_CLOSED,
  WECHAT_VPAY_STATUS_REFUND_DEDUCTED,
  WECHAT_VPAY_STATUS_REFUND_FAILED,
  WECHAT_VPAY_STATUS_REFUND_SUCCEEDED,
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
    assertVirtualPayRefundPreconditions(order, now)
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
    const wxEnv = mapWechatEnvType(queried.order.env_type)
    if (wxEnv !== null && wxEnv !== order.env) {
      throw new ConflictException({
        error: { code: 'VPAY_ENV_MISMATCH', message: '微信订单环境与本地记录不一致，已拦截退款' },
      })
    }
    if (queried.order.status === WECHAT_VPAY_STATUS_REFUND_SUCCEEDED) {
      await settleVirtualPayRefundSucceeded(this.prisma, this.audit, {
        orderId: order.id,
        outTradeNo: order.outTradeNo,
        refundOrderId: order.refundOrderId,
        wxRefundId: queried.order.wx_refund_id ?? order.wxRefundId,
        source: 'precheck',
      })
      return (await getVirtualPayOrderForAdmin(this.prisma, order.id))!
    }
    if (queried.order.status === WECHAT_VPAY_STATUS_REFUND_DEDUCTED) {
      // 微信 status=5（商户侧扣款完成）属于退款进行中，即便 left_fee=0 也绝不提前判 refunded，锁定/保持 refunding 等状态 8 或通知。
      await this.prisma.$transaction(async (tx) => {
        await tx.virtualPayOrder.updateMany({
          where: { id: order.id, status: { in: ['paid', 'refunding'] } },
          data: { status: 'refunding', lastDiagnosticReason: 'refund_merchant_deducted_waiting_user_credit' },
        })
        await tx.memberServiceCredit.updateMany({
          where: { sourceOrderId: order.id, status: 'available' },
          data: { status: 'refunding' },
        })
      })
      return (await getVirtualPayOrderForAdmin(this.prisma, order.id))!
    }
    if (queried.order.status === WECHAT_VPAY_STATUS_CLOSED) {
      await this.recordIndeterminateDiagnostic(order.id, order.outTradeNo, 'refund_query_order_closed_6', fetchImpl)
      throw new ConflictException({
        error: { code: 'VPAY_ORDER_NOT_REFUNDABLE', message: '微信侧该订单处于关闭态（status=6），不可判为退款成功或发起退款' },
      })
    }
    if (queried.order.status === WECHAT_VPAY_STATUS_REFUND_FAILED) {
      if (order.status === 'refunding') {
        await markVirtualPayRefundFailed(
          this.prisma,
          this.audit,
          { redis: this.redis, logger: this.logger, fetchImpl },
          {
            orderId: order.id,
            outTradeNo: order.outTradeNo,
            reason: 'refund_query_failed_status_7',
            source: 'initiate',
            extra: { refundOrderId: order.refundOrderId },
          },
        )
        return (await getVirtualPayOrderForAdmin(this.prisma, order.id))!
      }
      throw new ConflictException({
        error: { code: 'VPAY_ORDER_NOT_REFUNDABLE', message: '微信侧显示该订单上次退款失败，请先核查后再处理' },
      })
    }
    const leftFee = queried.order.left_fee
    if (typeof leftFee !== 'number' || !Number.isInteger(leftFee) || leftFee < order.priceCents) {
      throw new ConflictException({
        error: { code: 'VPAY_LEFT_FEE_INSUFFICIENT', message: '微信侧剩余可退金额不足，无法发起全额退款' },
      })
    }

    const inputReasonText = input.reason?.trim().slice(0, 190) || '管理员原路退款'
    const inputReasonCode = resolveRefundReasonCode(input.refundReasonCode)

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
      assertVirtualPayRefundPreconditions(fresh, now)
      if (isRetryableIndeterminateOrder(fresh)) {
        const claimedRetry = await tx.virtualPayOrder.updateMany({
          where: {
            id: fresh.id,
            status: 'refunding',
            wxRefundId: null,
            lastDiagnosticReason: fresh.lastDiagnosticReason,
          },
          data: { lastDiagnosticReason: 'refund_retry_inflight' },
        })
        if (claimedRetry.count !== 1) {
          throw new ConflictException({
            error: { code: 'VPAY_REFUND_IN_PROGRESS', message: '该订单退款重试正在处理中，请稍后同步查单确认' },
          })
        }
        const frozenCode = parseFrozenRefundReasonCode(fresh.refundReason) ?? '0'
        const frozenReason = fresh.refundReason ?? formatFrozenRefundReason(frozenCode, '管理员原路退款')
        await this.audit.writeRequired(tx, {
          actorId: input.operatorId,
          actorRole: 'admin',
          action: VIRTUAL_PAY_REFUND_INITIATED_AUDIT_ACTION,
          targetType: 'virtual_pay_order',
          targetId: fresh.outTradeNo,
          payload: {
            isRetry: true,
            refundOrderId: fresh.refundOrderId!,
            priceCents: fresh.priceCents,
            leftFee,
            reason: frozenReason,
            refundReasonCode: frozenCode,
          },
        })
        return { refundOrderId: fresh.refundOrderId!, refundReasonCode: frozenCode }
      }

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
      const frozenCode = parseFrozenRefundReasonCode(fresh.refundReason) ?? inputReasonCode
      const frozenReason = fresh.refundReason ?? formatFrozenRefundReason(frozenCode, inputReasonText)
      const orderClaimed = await tx.virtualPayOrder.updateMany({
        where: { id: fresh.id, status: 'paid' },
        data: {
          status: 'refunding',
          refundOrderId,
          refundReason: frozenReason,
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
          isRetry: false,
          refundOrderId,
          priceCents: fresh.priceCents,
          leftFee,
          reason: frozenReason,
          refundReasonCode: frozenCode,
        },
      })
      return { refundOrderId, refundReasonCode: frozenCode }
    })

    try {
      const response = await refundWechatVirtualPayOrder({
        openId: order.openId!,
        orderId: order.outTradeNo,
        refundOrderId: locked.refundOrderId,
        leftFee,
        refundFee: order.priceCents,
        bizMeta: `vpay:${order.outTradeNo}`,
        refundReason: locked.refundReasonCode,
        reqFrom: VIRTUAL_PAY_REFUND_REQ_FROM_MERCHANT,
        env: order.env,
        appKey,
        token,
        fetchImpl,
        timeoutMs: deps?.timeoutMs,
      })
      if (response.errcode === 0) {
        await this.prisma.virtualPayOrder.updateMany({
          where: { id: order.id, status: 'refunding' },
          data: {
            ...(response.refund_wx_order_id ? { wxRefundId: response.refund_wx_order_id } : {}),
            lastDiagnosticReason: null,
          },
        })
      } else if (response.errcode === VIRTUAL_PAY_REFUND_ERRCODE_IN_PROGRESS) {
        await this.recordIndeterminateDiagnostic(order.id, order.outTradeNo, 'refund_in_progress_268490014', fetchImpl)
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
      // 网络异常/超时无法证明微信未受理：严禁改回 paid 或标成终态解锁权益，保持 refunding + 权益锁定 + 告警。
      await this.recordIndeterminateDiagnostic(order.id, order.outTradeNo, 'refund_request_timeout_unknown', fetchImpl)
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

  private async recordIndeterminateDiagnostic(
    orderId: string,
    outTradeNo: string,
    reason: string,
    fetchImpl: typeof fetch,
  ): Promise<void> {
    await this.prisma.virtualPayOrder.updateMany({
      where: { id: orderId, status: { in: ['paid', 'refunding'] } },
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
    await sendVirtualPayOpsAlert({
      redis: this.redis,
      fetchImpl,
      outTradeNo,
      episodeToken: reason,
      type: 'virtual_pay_refund_failed',
      severity: 'warning',
      title: `小程序虚拟支付退款结果待确认 ${outTradeNo}（${reason}）`,
      logger: this.logger,
    })
  }
}
