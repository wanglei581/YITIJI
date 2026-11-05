import type { PrismaTransactionClient } from '../prisma/prisma.service'
import { COPY_ENDED } from './copy-job.policy'

/** 必须与准入/能力变更同事务提交；只撤权，不回退派发状态，不阻挡终态回报。 */
export async function revokeTerminalCopyAuthorization(tx: Pick<PrismaTransactionClient, 'copyJob'>, terminalId: string) {
  await tx.copyJob.updateMany({ where: { terminalId, state: { notIn: COPY_ENDED } },
    data: { authorizationVersion: { increment: 1 } } })
}
