import type { PrismaService } from '../src/prisma/prisma.service'
import { revokeTerminalCopyAuthorization } from '../src/copy-jobs/copy-authorization'

/** Demo seed 会覆盖既有归属，也必须遵守复印撤权事务协议。 */
export function seedKioskTerminal(prisma: Pick<PrismaService, '$transaction'>, orgId: string) {
  return prisma.$transaction(async (tx) => {
    const terminal = await tx.terminal.upsert({
      where: { terminalCode: 'KSK-001' },
      update: { orgId },
      create: { id: 't_ksk_001', terminalCode: 'KSK-001', agentToken: 'seed-terminal-token-ksk-001',
        deviceFingerprint: 'seed-terminal-fingerprint-ksk-001', orgId },
    })
    // 同机构重复 seed 多撤权一次是保守选择，不依赖事务外归属快照。
    await revokeTerminalCopyAuthorization(tx, terminal.id)
    return terminal
  })
}
