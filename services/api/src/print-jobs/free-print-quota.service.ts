import { Injectable } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import { readFreePrintQuotaConfig, updateFreePrintQuotaConfig } from './free-print-quota.config'
import { freePrintQuotaView, type FreePrintQuotaView } from './free-print-quota.decide'
import type { FreePrintQuotaConfig } from './free-print-quota.policy'

@Injectable()
export class FreePrintQuotaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  getAdmin(): Promise<FreePrintQuotaConfig> {
    return readFreePrintQuotaConfig(this.prisma)
  }

  updateAdmin(
    next: FreePrintQuotaConfig,
    actor: { userId: string; role: string },
  ): Promise<FreePrintQuotaConfig> {
    return updateFreePrintQuotaConfig(this.prisma, this.audit, next, actor)
  }

  kioskView(terminalId: string, endUserId: string | null): Promise<FreePrintQuotaView> {
    return freePrintQuotaView(this.prisma, terminalId, endUserId)
  }
}
