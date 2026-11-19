import { Injectable } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import { MINIAPP_VIRTUAL_PAY_ENABLED_KEY } from './virtual-pay.contract'
import {
  MINIAPP_VIRTUAL_PAY_DISABLE_AUDIT_ACTION,
  MINIAPP_VIRTUAL_PAY_ENABLE_AUDIT_ACTION,
  MINIAPP_VIRTUAL_PAY_GOODS_AUDIT_ACTION,
  readVirtualPaySettings,
  writeMiniappVirtualPayEnabled,
  writeVirtualPayGoods,
  type VirtualPaySettingsView,
} from './virtual-pay-settings'

@Injectable()
export class VirtualPayAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  getSettings(): Promise<VirtualPaySettingsView> {
    return readVirtualPaySettings(this.prisma)
  }

  async setEnabled(
    enabled: boolean,
    confirm: boolean | undefined,
    operatorId: string,
  ): Promise<VirtualPaySettingsView> {
    await writeMiniappVirtualPayEnabled(
      this.prisma,
      enabled,
      confirm,
      operatorId,
      (tx, saved) => this.audit.writeRequired(tx, {
        actorId: null,
        actorRole: 'system',
        action: saved.next ? MINIAPP_VIRTUAL_PAY_ENABLE_AUDIT_ACTION : MINIAPP_VIRTUAL_PAY_DISABLE_AUDIT_ACTION,
        targetType: 'platform_setting',
        targetId: MINIAPP_VIRTUAL_PAY_ENABLED_KEY,
        payload: { operatorId, previous: saved.previous, next: saved.next },
      }),
    )
    return readVirtualPaySettings(this.prisma)
  }

  async setGoods(
    serviceKind: string,
    productId: string,
    priceCents: number,
    confirm: boolean | undefined,
    operatorId: string,
  ): Promise<VirtualPaySettingsView> {
    await writeVirtualPayGoods(
      this.prisma,
      serviceKind,
      productId,
      priceCents,
      confirm,
      operatorId,
      (tx, saved) => this.audit.writeRequired(tx, {
        actorId: null,
        actorRole: 'system',
        action: MINIAPP_VIRTUAL_PAY_GOODS_AUDIT_ACTION,
        targetType: 'platform_setting',
        targetId: `charge.miniappVirtualPay.goods.${saved.serviceKind}`,
        payload: {
          operatorId,
          serviceKind: saved.serviceKind,
          productId: saved.productId,
          priceCents: saved.priceCents,
        },
      }),
    )
    return readVirtualPaySettings(this.prisma)
  }
}
