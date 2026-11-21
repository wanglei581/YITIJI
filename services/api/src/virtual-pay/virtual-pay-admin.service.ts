import { Injectable, NotFoundException, Optional } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import {
  evaluateMiniappVirtualPayRuntime,
  type MiniappVirtualPayBlock,
} from '../config/production-runtime-gates'
import { PrismaService } from '../prisma/prisma.service'
import { MINIAPP_VIRTUAL_PAY_ENABLED_KEY } from './virtual-pay.contract'
import {
  getVirtualPayOrderForAdmin,
  listVirtualPayOrdersForAdmin,
  type VirtualPayAdminOrderListQuery,
  type VirtualPayAdminOrderListResponse,
  type VirtualPayAdminOrderView,
} from './virtual-pay-admin-orders'
import { VirtualPayRefundService, type VirtualPaySyncResult } from './virtual-pay-refund.service'
import {
  MINIAPP_VIRTUAL_PAY_DISABLE_AUDIT_ACTION,
  MINIAPP_VIRTUAL_PAY_ENABLE_AUDIT_ACTION,
  MINIAPP_VIRTUAL_PAY_GOODS_AUDIT_ACTION,
  readVirtualPaySettings,
  writeMiniappVirtualPayEnabled,
  writeVirtualPayGoods,
  type VirtualPaySettingsView,
} from './virtual-pay-settings'

export interface VirtualPayAdminSettingsView extends VirtualPaySettingsView {
  runtime: {
    ready: boolean
    block: MiniappVirtualPayBlock | null
    env: 0 | 1 | null
  }
}

@Injectable()
export class VirtualPayAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly refunds?: VirtualPayRefundService,
  ) {}

  async getSettings(): Promise<VirtualPayAdminSettingsView> {
    const base = await readVirtualPaySettings(this.prisma)
    const runtime = evaluateMiniappVirtualPayRuntime()
    return {
      ...base,
      runtime: {
        ready: runtime.ready,
        block: runtime.block,
        env: runtime.env,
      },
    }
  }

  async setEnabled(
    enabled: boolean,
    confirm: boolean | undefined,
    operatorId: string,
  ): Promise<VirtualPayAdminSettingsView> {
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
    return this.getSettings()
  }

  async setGoods(
    serviceKind: string,
    productId: string,
    priceCents: number,
    confirm: boolean | undefined,
    operatorId: string,
  ): Promise<VirtualPayAdminSettingsView> {
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
    return this.getSettings()
  }

  listOrders(query: VirtualPayAdminOrderListQuery): Promise<VirtualPayAdminOrderListResponse> {
    return listVirtualPayOrdersForAdmin(this.prisma, query)
  }

  async getOrder(id: string): Promise<VirtualPayAdminOrderView> {
    const item = await getVirtualPayOrderForAdmin(this.prisma, id)
    if (!item) {
      throw new NotFoundException({
        error: { code: 'VPAY_ORDER_NOT_FOUND', message: '没有找到这笔虚拟支付订单' },
      })
    }
    return item
  }

  refundOrder(
    id: string,
    input: { confirm?: boolean; reason?: string; operatorId: string },
  ): Promise<VirtualPayAdminOrderView> {
    if (!this.refunds) throw new Error('VPAY_REFUND_SERVICE_UNAVAILABLE')
    return this.refunds.initiateRefund(id, input)
  }

  syncOrder(id: string, operatorId: string): Promise<VirtualPaySyncResult> {
    if (!this.refunds) throw new Error('VPAY_REFUND_SERVICE_UNAVAILABLE')
    return this.refunds.syncOrder(id, operatorId)
  }
}
