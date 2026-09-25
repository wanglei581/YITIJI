import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { encryptSecret } from '../common/crypto/secret-cipher'
import { hashPickupCode, randomPickupCode } from '../common/pickup-code'
import { PrismaService } from '../prisma/prisma.service'
import { MemberPrintOrderCreateService } from './member-print-order-create.service'
import { PackageOrderService } from './package-order.service'

const REISSUE_ATTEMPTS = 6

function isUniqueConflict(error: unknown): boolean {
  let current: unknown = error
  for (let i = 0; i < 6 && current && typeof current === 'object'; i += 1) {
    if ((current as { code?: unknown }).code === 'P2002') return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

/**
 * 作废当前到机码并重发一枚新的 8 位码。沿用同一订单、同一截止（付款起 7 天，不顺延）。
 * 旧码的哈希被替换，立即无法认领。已核销、已过期、已退款或已开始出纸的单不能重发。
 *
 * 材料包主单的文件在 OrderItem，`sourceFileId` 为空。能否重发只看有没有到机码。
 */
@Injectable()
export class PickupCodeReissueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly orders: MemberPrintOrderCreateService,
    private readonly packages: PackageOrderService,
  ) {}

  async reissue(endUserId: string, orderId: string) {
    const now = new Date()
    const existing = await this.prisma.order.findFirst({
      where: { id: orderId, endUserId, pickupCodeHash: { not: null } },
    })
    if (!existing?.pickupCodeHash) {
      throw new NotFoundException({ error: { code: 'PRINT_ORDER_NOT_FOUND', message: '打印订单不存在' } })
    }

    for (let attempt = 0; attempt < REISSUE_ATTEMPTS; attempt += 1) {
      const code = randomPickupCode()
      const hash = hashPickupCode(code)
      try {
        const updated = await this.prisma.order.updateMany({
          where: {
            id: existing.id,
            endUserId,
            printTaskId: null,
            pickupCodeHash: { not: null },
            pickupStatus: { in: ['pending', 'claimed'] },
            payStatus: { in: ['unpaid', 'paying', 'paid'] },
            pickupCodeExpiresAt: { gt: now },
          },
          data: {
            pickupCodeHash: hash,
            pickupCodeEnc: encryptSecret(code),
            pickupCodeCreatedAt: now,
            pickupStatus: 'pending',
            pickupClaimedAt: null,
            taskStatus: 'pending_release',
          },
        })
        if (updated.count !== 1) {
          throw new BadRequestException({
            error: { code: 'PICKUP_CODE_NOT_REISSUABLE', message: '当前不能作废重发到机码' },
          })
        }
        await this.audit.write({
          actorId: null,
          actorRole: 'system',
          action: 'print_order.pickup_code_reissued',
          targetType: 'order',
          targetId: existing.id,
          payload: { terminalId: existing.terminalId, previousHashPrefix: existing.pickupCodeHash.slice(0, 12) },
        })
        if (!existing.sourceFileId) return this.packages.detail(endUserId, existing.id)
        return this.orders.detail(endUserId, existing.id)
      } catch (error) {
        if (isUniqueConflict(error)) continue
        throw error
      }
    }
    throw new BadRequestException({ error: { code: 'PICKUP_CODE_UNAVAILABLE', message: '暂时无法签发新的到机码' } })
  }
}
