import type { PrismaTransactionClient } from '../prisma/prisma.service'
import { isPublicEmploymentOrgType } from './terminal-charge.contract'
import { readTerminalChargeResetSnapshot } from './terminal-charge-reset-snapshot'

export const TERMINAL_CHARGE_RESET_ON_PUBLIC_SITE_AUDIT_ACTION = 'terminal.charge_settings.reset_on_public_site'

interface PublicResetAudit {
  actorId: string
  actorRole: string
  action: string
  targetType: string
  targetId: string
  payload: Record<string, unknown>
}

/**
 * 机构类型从非公共改成公共就业点位时，名下每台终端在同一事务里复位。
 * 已经是公共点位，或改回非公共，什么都不做：旧价不复活，要收费得重新设。
 */
export async function resetTerminalChargesOnEnteringPublicSite(
  tx: PrismaTransactionClient,
  input: {
    orgId: string
    previousType: string
    nextType: string
    actorId: string
    actorRole: string
    writeAudit: (args: PublicResetAudit) => Promise<unknown>
  },
): Promise<void> {
  if (input.previousType === input.nextType) return
  if (!isPublicEmploymentOrgType(input.nextType) || isPublicEmploymentOrgType(input.previousType)) return
  const terminals = await tx.terminal.findMany({
    where: { orgId: input.orgId },
    select: { id: true, terminalCode: true },
    orderBy: { terminalCode: 'asc' },
  })
  for (const terminal of terminals) {
    const before = await readTerminalChargeResetSnapshot(tx, terminal.id)
    await tx.terminal.update({
      where: { id: terminal.id },
      data: { userChargeMode: 'org_pays', orgBindingGeneration: { increment: 1 } },
    })
    await tx.terminalServicePrice.deleteMany({ where: { terminalId: terminal.id } })
    const payload: Record<string, unknown> = {
      terminalCode: terminal.terminalCode,
      orgId: input.orgId,
      before,
    }
    await input.writeAudit({
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: TERMINAL_CHARGE_RESET_ON_PUBLIC_SITE_AUDIT_ACTION,
      targetType: 'terminal',
      targetId: terminal.terminalCode,
      payload,
    })
  }
}
