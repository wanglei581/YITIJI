/**
 * Gate 0 batch 1 — migrate legacy plaintext Terminal.agentToken values into
 * hash-only TerminalCredential rows, then replace the legacy column with a
 * non-secret cred$<credentialId> sentinel.
 *
 * This command is deliberately not automatic. Operators must provide one
 * fixed expiry for the entire run so retries and multiple API nodes cannot
 * invent different credential lifetimes.
 */

import crypto from 'node:crypto'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'

const CONFIRM_VALUE = 'BACKFILL_HASH_AND_ERASE_LEGACY_TOKENS'
const SENTINEL_PREFIX = 'cred$'

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex')
}

function makeCredentialId(): string {
  return `tc_${crypto.randomBytes(16).toString('hex')}`
}

async function main(): Promise<void> {
  if (required('TERMINAL_CREDENTIAL_BACKFILL_CONFIRM') !== CONFIRM_VALUE) {
    throw new Error(`TERMINAL_CREDENTIAL_BACKFILL_CONFIRM must equal ${CONFIRM_VALUE}`)
  }
  if (required('TERMINAL_CREDENTIAL_READERS_READY') !== 'true') {
    throw new Error('TERMINAL_CREDENTIAL_READERS_READY must equal true after every API instance is reader-aware')
  }
  const expiresAt = new Date(required('TERMINAL_LEGACY_CREDENTIAL_EXPIRES_AT'))
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) {
    throw new Error('TERMINAL_LEGACY_CREDENTIAL_EXPIRES_AT must be a valid future ISO-8601 timestamp')
  }

  const prisma = new PrismaService()
  const audit = new AuditService(prisma)
  await prisma.onModuleInit()
  let migrated = 0
  let skipped = 0
  try {
    const terminals = await prisma.terminal.findMany({
      select: { id: true, terminalCode: true, agentToken: true, credentialGeneration: true, lifecycleStatus: true },
      orderBy: { id: 'asc' },
    })
    for (const candidate of terminals) {
      if (candidate.lifecycleStatus === 'planned') {
        if (!candidate.agentToken.startsWith('planned$') || candidate.credentialGeneration !== 0) {
          throw new Error(`planned terminal ${candidate.terminalCode} has an inconsistent credential placeholder`)
        }
        skipped += 1
        continue
      }
      if (candidate.agentToken.startsWith(SENTINEL_PREFIX)) {
        await assertSentinelConsistent(prisma, candidate)
        skipped += 1
        continue
      }
      const result = await prisma.$transaction(async (tx) => {
        const terminal = await tx.terminal.findUnique({
          where: { id: candidate.id },
          select: { id: true, terminalCode: true, agentToken: true, credentialGeneration: true },
        })
        if (!terminal || terminal.agentToken.startsWith(SENTINEL_PREFIX)) return null
        if (terminal.agentToken !== candidate.agentToken) {
          throw new Error(`terminal ${terminal.terminalCode} changed during backfill; retry the command`)
        }

        const tokenHash = hashToken(terminal.agentToken)
        const existingCredential = await tx.terminalCredential.findUnique({
          where: { tokenHash },
          select: { id: true, terminalId: true, generation: true, expiresAt: true, revokedAt: true },
        })
        if (existingCredential) {
          if (
            existingCredential.terminalId !== terminal.id ||
            existingCredential.generation !== terminal.credentialGeneration ||
            existingCredential.revokedAt !== null ||
            existingCredential.expiresAt <= new Date()
          ) {
            throw new Error(`terminal ${terminal.terminalCode} has an inconsistent existing credential`)
          }
          await tx.terminalCredential.update({
            where: { id: existingCredential.id },
            data: { expiresAt },
          })
          const updated = await tx.terminal.updateMany({
            where: { id: terminal.id, agentToken: terminal.agentToken },
            data: { agentToken: `${SENTINEL_PREFIX}${existingCredential.id}` },
          })
          if (updated.count !== 1) throw new Error(`terminal ${terminal.terminalCode} CAS update failed`)
          return {
            terminalCode: terminal.terminalCode,
            credentialId: existingCredential.id,
            generation: existingCredential.generation,
            reused: true,
            previousExpiresAt: existingCredential.expiresAt.toISOString(),
            persistedExpiresAt: expiresAt.toISOString(),
          }
        }

        const credentialId = makeCredentialId()
        const generation = terminal.credentialGeneration + 1
        await tx.terminalCredential.updateMany({
          where: { terminalId: terminal.id, revokedAt: null },
          data: { revokedAt: new Date() },
        })
        await tx.terminalCredential.create({
          data: {
            id: credentialId,
            terminalId: terminal.id,
            tokenHash,
            generation,
            issueSource: 'legacy_migration',
            expiresAt,
          },
        })
        const updated = await tx.terminal.updateMany({
          where: { id: terminal.id, agentToken: terminal.agentToken },
          data: { agentToken: `${SENTINEL_PREFIX}${credentialId}`, credentialGeneration: generation },
        })
        if (updated.count !== 1) throw new Error(`terminal ${terminal.terminalCode} CAS update failed`)
        return {
          terminalCode: terminal.terminalCode,
          credentialId,
          generation,
          reused: false,
          previousExpiresAt: null,
          persistedExpiresAt: expiresAt.toISOString(),
        }
      })
      if (!result) {
        skipped += 1
        continue
      }
      migrated += 1
      await audit.write({
        actorId: null,
        actorRole: 'system-maintenance',
        action: 'terminal.credential.legacy_backfill',
        targetType: 'terminal',
        targetId: result.terminalCode,
        payload: {
          credentialId: result.credentialId,
          generation: result.generation,
          reusedExistingCredential: result.reused,
          previousCredentialExpiresAt: result.previousExpiresAt,
          credentialExpiresAt: result.persistedExpiresAt,
        },
      })
    }

    const all = await prisma.terminal.findMany({
      select: { id: true, terminalCode: true, agentToken: true, credentialGeneration: true, lifecycleStatus: true },
    })
    const persistedExpiryTimes: number[] = []
    for (const terminal of all) {
      if (terminal.agentToken.startsWith(SENTINEL_PREFIX)) {
        const persistedExpiry = await assertSentinelConsistent(prisma, terminal)
        persistedExpiryTimes.push(persistedExpiry.getTime())
      }
    }
    const remainingLegacy = all.filter(
      (terminal) => terminal.lifecycleStatus !== 'planned' && !terminal.agentToken.startsWith(SENTINEL_PREFIX),
    ).length
    const distinctExpiryTimes = [...new Set(persistedExpiryTimes)].sort((a, b) => a - b)
    console.log(JSON.stringify({
      total: all.length,
      migrated,
      skipped,
      inconsistent: 0,
      remainingLegacy,
      requestedExpiresAt: expiresAt.toISOString(),
      persistedCredentialExpiry: {
        distinctCount: distinctExpiryTimes.length,
        earliest: distinctExpiryTimes.length > 0 ? new Date(distinctExpiryTimes[0]!).toISOString() : null,
        latest: distinctExpiryTimes.length > 0 ? new Date(distinctExpiryTimes.at(-1)!).toISOString() : null,
      },
    }))
    if (remainingLegacy !== 0) throw new Error(`backfill incomplete: ${remainingLegacy} legacy plaintext rows remain`)
  } finally {
    await prisma.onModuleDestroy()
  }
}

async function assertSentinelConsistent(
  prisma: PrismaService,
  terminal: { id: string; terminalCode: string; agentToken: string; credentialGeneration: number },
): Promise<Date> {
  const credentialId = terminal.agentToken.slice(SENTINEL_PREFIX.length)
  if (!credentialId) throw new Error(`terminal ${terminal.terminalCode} has an empty credential sentinel`)
  const credential = await prisma.terminalCredential.findUnique({
    where: { id: credentialId },
    select: { terminalId: true, generation: true, expiresAt: true },
  })
  if (
    !credential ||
    credential.terminalId !== terminal.id ||
    credential.generation !== terminal.credentialGeneration
  ) {
    throw new Error(`terminal ${terminal.terminalCode} has an inconsistent credential sentinel`)
  }
  return credential.expiresAt
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
