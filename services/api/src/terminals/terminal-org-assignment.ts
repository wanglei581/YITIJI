import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { PrismaService, type PrismaTransactionClient } from '../prisma/prisma.service'
import type { AssignTerminalOrgResult } from './terminals-admin.service'
import { isParkedTerminalOrgType, orgTypeParkedError } from './terminal-org-parking'
import { terminalOrgBindingWrite } from './terminal-org-binding'
import { assertCanBindTerminal } from '../licenses/license-gate'

export type TerminalOrgAssignmentAudit = (tx: PrismaTransactionClient, result: AssignTerminalOrgResult & {
  deploymentIds: string[]; effectiveAt: string
}) => Promise<unknown>

/** Rebinding, ownership interval closure and required audit commit or roll back together. */
export async function assignTerminalOrganization(prisma: PrismaService, terminalId: string, orgId: string | null, now: Date | undefined, writeAudit: TerminalOrgAssignmentAudit): Promise<AssignTerminalOrgResult> {
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
  const result = { terminalId: terminal.terminalCode, terminalCode: terminal.terminalCode, oldOrgId, newOrgId: orgId, orgName }
  await prisma.$transaction(async (tx) => {
    const changed = await tx.terminal.updateMany({
      where: { id: terminal.id, orgId: oldOrgId },
      data: { id: terminal.id },
    })
    if (changed.count !== 1) {
      throw new ConflictException({ error: { code: 'TERMINAL_ORG_CHANGED', message: '终端归属已变更，请刷新后重试' } })
    }
    // 软件使用授权：把终端绑到「需要授权」的机构时，超过授权台数（或授权不可用）拒绝。
    // 只管新增绑定——解绑、改绑到别的机构不受限，解绑立即释放名额；已绑终端运行期不按台数裁决。
    if (orgId !== null && orgId !== oldOrgId) await assertCanBindTerminal(tx, prisma.dbKind, orgId, terminal.id)
    const current = await tx.terminal.findUniqueOrThrow({ where: { id: terminal.id }, select: { orgBoundAt: true } })
    const active = await tx.serviceDeployment.findFirst({ where: { terminalId: terminal.id, endedAt: null }, select: { id: true, startedAt: true } })
    const latest = await tx.serviceDeployment.findFirst({ where: { terminalId: terminal.id, endedAt: { not: null } }, orderBy: { endedAt: 'desc' }, select: { endedAt: true } })
    const effectiveAt = new Date(Math.max((now ?? new Date()).getTime(), active?.startedAt.getTime() ?? 0,
      current.orgBoundAt?.getTime() ?? 0, latest?.endedAt?.getTime() ?? 0))
    await tx.terminal.update({ where: { id: terminal.id }, data: terminalOrgBindingWrite(oldOrgId, orgId, effectiveAt) })
    if (oldOrgId !== orgId) {
      await tx.serviceDeployment.updateMany({
        where: { terminalId: terminal.id, endedAt: null },
        data: { endedAt: effectiveAt, activeTerminalId: null },
      })
    }
    await writeAudit(tx, { ...result, deploymentIds: oldOrgId !== orgId && active ? [active.id] : [], effectiveAt: effectiveAt.toISOString() })
  })

  return result
}
