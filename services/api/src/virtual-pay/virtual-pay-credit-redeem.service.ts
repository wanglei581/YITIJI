import { randomBytes } from 'node:crypto'
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { assertUserPaysUnit, getEffectiveUserPrices } from '../payment/effective-user-prices'
import { SERVICE_ORDER_NAMES, SERVICE_PAY_TTL_MS, isServiceOrderKey } from '../payment/service-order.policy'
import type { ServiceOrderView } from '../payment/service-order.service'
import { PrismaService } from '../prisma/prisma.service'
import { MINIAPP_CREDIT_PROVIDER, isMiniappVirtualPayServiceKind } from './virtual-pay.contract'
import { VIRTUAL_PAY_CREDIT_REDEEMED_AUDIT_ACTION } from './virtual-pay-credit-redeem'

const MAX_CAS_ROUNDS = 4
const CANDIDATE_BATCH = 10

type ServiceOrderRow = NonNullable<Awaited<ReturnType<PrismaService['serviceOrder']['findUnique']>>>

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}

function toServiceOrderView(row: ServiceOrderRow): ServiceOrderView {
  const serviceKey = isServiceOrderKey(row.serviceKey) ? row.serviceKey : 'scan'
  return {
    id: row.id,
    serviceKey: row.serviceKey,
    serviceName: SERVICE_ORDER_NAMES[serviceKey],
    status: row.status,
    amountCents: row.amountCents,
    expiresAt: row.expiresAt.toISOString(),
    qrCodeContent: row.qrCodeContent,
    paidAt: iso(row.paidAt),
    refundReason: row.refundReason,
    refundedAt: iso(row.refundedAt),
    failureReason: row.failureReason,
    retryUntil: iso(row.retryUntil),
    attemptsUsed: row.attemptsUsed,
    settledAt: iso(row.settledAt),
    closeReason: row.closeReason,
    paymentFailed: row.paymentFailed,
    checking: false,
    consumedAt: iso(row.consumedAt),
    provider: row.provider,
  }
}

@Injectable()
export class VirtualPayCreditRedeemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * 一体机原子核销本人一条可用的小程序虚拟支付权益，并生成 provider='miniapp_credit', amountCents=0
   * 的已付 ServiceOrder（不进入现金收银/发票口径，无缝走 beginTrip / coversTrip / 失败退回）。
   */
  async redeem(
    terminalId: string,
    endUserId: string,
    input: { serviceKey: string; kioskSessionId: string },
  ): Promise<ServiceOrderView> {
    if (!isMiniappVirtualPayServiceKind(input.serviceKey)) {
      throw new BadRequestException({
        error: { code: 'VPAY_SERVICE_KIND_INVALID', message: '只能核销简历优化或模拟面试权益' },
      })
    }
    const kioskSessionId = input.kioskSessionId.trim()
    if (!kioskSessionId) {
      throw new BadRequestException({
        error: { code: 'SERVICE_SESSION_REQUIRED', message: '请先开始这一次使用' },
      })
    }

    const prices = await getEffectiveUserPrices(this.prisma, terminalId)
    const unit = prices.prices[input.serviceKey]
    try {
      assertUserPaysUnit(unit)
    } catch (error) {
      if (error instanceof Error && error.message === 'PRICE_CONFIG_INVALID') {
        throw new BadRequestException({
          error: { code: 'PRICE_CONFIG_INVALID', message: '这台机器的价目还不能向个人收费' },
        })
      }
      throw error
    }
    if (unit.effectiveCents <= 0) {
      throw new ConflictException({
        error: { code: 'SERVICE_FREE_ON_THIS_TERMINAL', message: '这台机器这一项不向个人收费' },
      })
    }

    const session = await this.prisma.kioskSession.findUnique({
      where: { terminalId_clientSessionId: { terminalId, clientSessionId: kioskSessionId } },
      select: { endedAt: true },
    })
    if (!session || session.endedAt) {
      throw new BadRequestException({
        error: { code: 'SERVICE_SESSION_REQUIRED', message: '请先开始这一次使用' },
      })
    }

    const member = await this.prisma.endUser.findUnique({
      where: { id: endUserId },
      select: { status: true, enabled: true },
    })
    if (!member || member.status !== 'active' || !member.enabled) {
      throw new ConflictException({
        error: { code: 'ACCOUNT_UNAVAILABLE', message: '账号当前不可用，暂不能使用权益' },
      })
    }

    const serviceKey = input.serviceKey
    const row = await this.prisma.$transaction(async (tx) => {
      const freshMember = await tx.endUser.findUnique({
        where: { id: endUserId },
        select: { status: true, enabled: true },
      })
      if (!freshMember || freshMember.status !== 'active' || !freshMember.enabled) {
        throw new ConflictException({
          error: { code: 'ACCOUNT_UNAVAILABLE', message: '账号当前不可用，暂不能使用权益' },
        })
      }
      const now = new Date()
      const orderId = `vpcord_${randomBytes(12).toString('hex')}`
      let claimedCreditId: string | null = null

      for (let round = 0; round < MAX_CAS_ROUNDS && !claimedCreditId; round += 1) {
        const candidates = await tx.memberServiceCredit.findMany({
          where: { endUserId, serviceKind: serviceKey, status: 'available', consumedAt: null },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: CANDIDATE_BATCH,
          select: { id: true },
        })
        if (candidates.length === 0) break
        for (const candidate of candidates) {
          const claimed = await tx.memberServiceCredit.updateMany({
            where: {
              id: candidate.id,
              endUserId,
              serviceKind: serviceKey,
              status: 'available',
              consumedAt: null,
            },
            data: {
              status: 'consumed',
              consumedAt: now,
              consumedServiceOrderId: orderId,
            },
          })
          if (claimed.count === 1) {
            claimedCreditId = candidate.id
            break
          }
        }
      }

      if (!claimedCreditId) {
        throw new ConflictException({
          error: { code: 'VPAY_CREDIT_UNAVAILABLE', message: '当前没有可用的小程序权益' },
        })
      }

      const created = await tx.serviceOrder.create({
        data: {
          id: orderId,
          terminalId,
          kioskSessionId,
          endUserId,
          serviceKey,
          provider: MINIAPP_CREDIT_PROVIDER,
          providerOrderNo: `vpc${randomBytes(12).toString('hex')}`,
          amountCents: 0,
          status: 'paid',
          paidAt: now,
          expiresAt: new Date(now.getTime() + SERVICE_PAY_TTL_MS),
        },
      })

      await this.audit.writeRequired(tx, {
        actorId: null,
        actorRole: 'member',
        action: VIRTUAL_PAY_CREDIT_REDEEMED_AUDIT_ACTION,
        targetType: 'service_order',
        targetId: created.id,
        payload: { endUserId, creditId: claimedCreditId, serviceKey, terminalId },
      })
      return created
    })

    return toServiceOrderView(row)
  }
}
