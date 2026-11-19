import { BadRequestException, ConflictException, ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { evaluateMiniappVirtualPayRuntime } from '../config/production-runtime-gates'
import { exchangeMiniappJsCode } from '../member-auth/wx-jscode'
import { PrismaService } from '../prisma/prisma.service'
import { isMiniappVirtualPayServiceKind } from './virtual-pay.contract'
import { readVirtualPaySettings } from './virtual-pay-settings'
import {
  VIRTUAL_PAY_MODE,
  VIRTUAL_PAY_REQUEST_URI,
  buildSignData,
  calcPaySig,
  calcUserSignature,
  newOutTradeNo,
} from './virtual-pay-sign'

export const VIRTUAL_PAY_DIAGNOSTIC_ACTION = 'virtual_pay.diagnostic'

@Injectable()
export class VirtualPayOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createOrder(endUserId: string, serviceKind: string, code: string) {
    if (!isMiniappVirtualPayServiceKind(serviceKind)) {
      throw new BadRequestException({
        error: { code: 'VPAY_SERVICE_KIND_INVALID', message: '只能购买简历优化或模拟面试一次' },
      })
    }
    const settings = await readVirtualPaySettings(this.prisma)
    if (!settings.canSell) {
      throw new ForbiddenException({
        error: { code: 'VPAY_DISABLED', message: '小程序虚拟支付未开放' },
      })
    }
    const runtime = evaluateMiniappVirtualPayRuntime()
    if (!runtime.ready || runtime.appKey == null || runtime.env == null || runtime.offerId == null) {
      await this.diagnose(runtime.block ?? 'env_missing')
      const errorCode = runtime.block === 'sandbox_in_production' ? 'VPAY_SANDBOX_FORBIDDEN' : 'VPAY_CONFIG_MISSING'
      throw new ServiceUnavailableException({
        error: { code: errorCode, message: '小程序虚拟支付暂不可用' },
      })
    }
    const goods = settings.goods[serviceKind]
    if (!goods.configured || goods.productId == null || goods.priceCents == null) {
      throw new ConflictException({
        error: { code: 'VPAY_GOODS_UNCONFIGURED', message: '该服务还没有配置道具' },
      })
    }
    const session = await exchangeMiniappJsCode(code)
    if (!session.sessionKey) {
      throw new UnauthorizedException({
        error: { code: 'WX_CODE_INVALID', message: '微信登录凭证无效或已过期，请重试' },
      })
    }
    const member = await this.prisma.endUser.findUnique({
      where: { id: endUserId },
      select: { wxOpenId: true },
    })
    if (!member?.wxOpenId || member.wxOpenId !== session.openid) {
      throw new ConflictException({
        error: { code: 'VPAY_OPENID_MISMATCH', message: '当前微信与登录账号不一致' },
      })
    }
    const outTradeNo = newOutTradeNo()
    await this.prisma.virtualPayOrder.create({
      data: {
        endUserId,
        openId: session.openid,
        serviceKind,
        productId: goods.productId,
        priceCents: goods.priceCents,
        env: runtime.env,
        status: 'pending',
        outTradeNo,
      },
    })
    const signData = buildSignData({
      offerId: runtime.offerId,
      env: runtime.env,
      productId: goods.productId,
      goodsPrice: goods.priceCents,
      outTradeNo,
      attach: serviceKind,
    })
    const paySig = calcPaySig(VIRTUAL_PAY_REQUEST_URI, signData, runtime.appKey)
    const signature = calcUserSignature(signData, session.sessionKey)
    return { outTradeNo, signData, paySig, signature, mode: VIRTUAL_PAY_MODE }
  }

  private diagnose(reason: string): Promise<string | null> {
    return this.audit.write({
      actorId: null,
      actorRole: 'system',
      action: VIRTUAL_PAY_DIAGNOSTIC_ACTION,
      targetType: 'virtual_pay_order',
      payload: { reason },
    })
  }
}
