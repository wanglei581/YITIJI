import type { PrismaService } from '../src/prisma/prisma.service'
import { revokeTerminalCopyAuthorization } from '../src/copy-jobs/copy-authorization'

/** Demo seed 写的一体机终端。 */
export const KIOSK_SEED_TERMINAL = {
  id: 't_ksk_001',
  terminalCode: 'KSK-001',
  agentToken: 'seed-terminal-token-ksk-001',
  deviceFingerprint: 'seed-terminal-fingerprint-ksk-001',
} as const

export type SeedTerminalIdentity = { id: string; terminalCode: string; agentToken: string; deviceFingerprint: string }

/**
 * Demo seed 会覆盖既有归属，也必须遵守复印撤权事务协议。
 * identity 只给门禁换一个不撞已灌种子的终端；seed 本身恒用 KSK-001。
 */
export function seedKioskTerminal(prisma: Pick<PrismaService, '$transaction'>, orgId: string,
  identity: SeedTerminalIdentity = KIOSK_SEED_TERMINAL) {
  return prisma.$transaction(async (tx) => {
    const terminal = await tx.terminal.upsert({
      where: { terminalCode: identity.terminalCode },
      update: { orgId },
      create: { id: identity.id, terminalCode: identity.terminalCode, agentToken: identity.agentToken,
        deviceFingerprint: identity.deviceFingerprint, orgId },
    })
    // 同机构重复 seed 多撤权一次是保守选择，不依赖事务外归属快照。
    await revokeTerminalCopyAuthorization(tx, terminal.id)
    return terminal
  })
}
