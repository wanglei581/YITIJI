import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type { AssignTerminalOrgResult } from './terminals-admin.service'
import { isParkedTerminalOrgType, orgTypeParkedError } from './terminal-org-parking'
import { terminalOrgBindingWrite } from './terminal-org-binding'

/** Same transaction as rebinding; closes the immutable first-order ownership interval. */
export async function assignTerminalOrganization(prisma: PrismaService, terminalId: string, orgId: string | null, now?: Date): Promise<AssignTerminalOrgResult> {
  const terminal = await prisma.terminal.findFirst({
    where: { OR: [{ id: terminalId }, { terminalCode: terminalId }] },
    select: { id: true, terminalCode: true, orgId: true },
  })
  if (!terminal) {
    throw new NotFoundException({ error: { code: 'TERMINAL_NOT_FOUND', message: '终端不存在' } })
  }

  let orgName: string | null = null
  if (orgId !== null) {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, enabled: true, type: true },
    })
    if (!org) {
      throw new NotFoundException({ error: { code: 'ORG_NOT_FOUND', message: '机构不存在' } })
    }
    if (!org.enabled) {
      throw new BadRequestException({ error: { code: 'ORG_DISABLED', message: '机构已停用，不能绑定' } })
    }
    if (isParkedTerminalOrgType(org.type)) throw orgTypeParkedError()
    orgName = org.name
  }

  const oldOrgId = terminal.orgId
  await prisma.$transaction(async (tx) => {
    const changed = await tx.terminal.updateMany({
      where: { id: terminal.id, orgId: oldOrgId },
      data: { id: terminal.id },
    })
    if (changed.count !== 1) {
      throw new ConflictException({ error: { code: 'TERMINAL_ORG_CHANGED', message: '终端归属已变更，请刷新后重试' } })
    }
    const active = await tx.serviceDeployment.findFirst({ where: { terminalId: terminal.id, endedAt: null }, select: { startedAt: true } })
    const effectiveAt = new Date(Math.max((now ?? new Date()).getTime(), active?.startedAt.getTime() ?? 0))
    await tx.terminal.update({ where: { id: terminal.id }, data: terminalOrgBindingWrite(oldOrgId, orgId, effectiveAt) })
    if (oldOrgId !== orgId) {
      await tx.serviceDeployment.updateMany({
        where: { terminalId: terminal.id, endedAt: null },
        data: { endedAt: effectiveAt, activeTerminalId: null },
      })
    }
  })

  return {
    terminalId: terminal.terminalCode,
    terminalCode: terminal.terminalCode,
    oldOrgId,
    newOrgId: orgId,
    orgName,
  }
}
