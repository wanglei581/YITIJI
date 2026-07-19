import { ConflictException, NotFoundException } from '@nestjs/common'
import type { PrismaTransactionClient } from '../prisma/prisma.service'

export interface TrustedAccountActionBinding {
  adminTokenVersion: number
  partnerTokenVersion: number
}

export async function loadTrustedAccountForDeletion(
  tx: PrismaTransactionClient,
  orgId: string,
  accountId: string,
  adminId: string,
  binding: TrustedAccountActionBinding,
) {
  const [admin, org, account] = await Promise.all([
    tx.user.findFirst({
      where: {
        id: adminId,
        role: 'admin',
        enabled: true,
        deletedAt: null,
        tokenVersion: binding.adminTokenVersion,
      },
      select: { id: true },
    }),
    tx.organization.findUnique({ where: { id: orgId }, select: { id: true } }),
    tx.user.findFirst({ where: { id: accountId, orgId, role: 'partner', deletedAt: null } }),
  ])
  if (!admin || !org) {
    throw new ConflictException({
      error: { code: 'ACCOUNT_ACTION_TICKET_STALE', message: '账号状态已变化，请刷新后重新验证' },
    })
  }
  if (!account) {
    throw new NotFoundException({
      error: { code: 'ACCOUNT_NOT_FOUND', message: `Account ${accountId} not found in org ${orgId}` },
    })
  }
  if (account.tokenVersion !== binding.partnerTokenVersion) {
    throw new ConflictException({
      error: { code: 'ACCOUNT_ACTION_TICKET_STALE', message: '账号状态已变化，请刷新后重新验证' },
    })
  }
  return account
}
