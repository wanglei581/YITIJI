/** Gate 0 batch 1 dynamic verification (runs on the configured SQLite or PostgreSQL DB). */

import crypto from 'node:crypto'
import { UnauthorizedException } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { TerminalToolboxService } from '../src/terminals/terminal-toolbox.service'
import { TerminalAgentService } from '../src/terminals/terminals-agent.service'
import { TerminalAdminService } from '../src/terminals/terminals-admin.service'
import { TerminalsService } from '../src/terminals/terminals.service'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
  console.log(`  PASS ${message}`)
}

function responseCode(error: unknown): string | undefined {
  if (!(error instanceof UnauthorizedException)) return undefined
  const response = error.getResponse() as { error?: { code?: string } }
  return response.error?.code
}

async function expectUnauthorized(action: () => Promise<unknown>, code: string, message: string): Promise<void> {
  try {
    await action()
  } catch (error) {
    assert(responseCode(error) === code, `${message} (${code})`)
    return
  }
  throw new Error(`${message}: expected ${code}`)
}

async function main(): Promise<void> {
  console.log('\n=== terminal credential dynamic verification ===')
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const suffix = crypto.randomBytes(6).toString('hex')
  const legacyId = `t_vcred_legacy_${suffix}`
  const managedCode = `VCRED-${suffix}`
  const actorId = `u_vcred_admin_${suffix}`
  const legacyToken = `legacy-${crypto.randomBytes(20).toString('hex')}`
  const audit = new AuditService(prisma)
  const agent = new TerminalAgentService(prisma, audit)
  const admin = new TerminalAdminService(prisma, agent, new TerminalToolboxService(prisma))
  const service = new TerminalsService(agent, admin)
  const previousLegacyFlag = process.env['TERMINAL_LEGACY_REGISTER_ENABLED']
  process.env['TERMINAL_LEGACY_REGISTER_ENABLED'] = 'true'

  try {
    await prisma.user.create({
      data: {
        id: actorId,
        username: `verify-terminal-credentials-${suffix}`,
        passwordHash: 'verify-only-not-a-login-secret',
        name: 'Terminal credential verifier',
        role: 'admin',
      },
    })
    await prisma.terminal.create({
      data: {
        id: legacyId,
        terminalCode: `VCRED-LEGACY-${suffix}`,
        agentToken: legacyToken,
        deviceFingerprint: `fp-legacy-${suffix}`,
      },
    })
    await service.assertAgentAuthorized(legacyId, `Bearer ${legacyToken}`)
    console.log('  PASS legacy plaintext credential remains compatible during expand window')
    await expectUnauthorized(
      () => service.assertAgentAuthorized(legacyId, 'Bearer wrong-token'),
      'AUTH_TOKEN_INVALID',
      'wrong legacy token is rejected',
    )

    const legacyCredentialId = `tc_${crypto.randomBytes(16).toString('hex')}`
    await prisma.$transaction(async (tx) => {
      await tx.terminalCredential.create({
        data: {
          id: legacyCredentialId,
          terminalId: legacyId,
          tokenHash: crypto.createHash('sha256').update(legacyToken).digest('hex'),
          generation: 1,
          issueSource: 'legacy_migration',
          expiresAt: new Date(Date.now() + 60_000),
        },
      })
      await tx.terminal.update({
        where: { id: legacyId },
        data: { agentToken: `cred$${legacyCredentialId}`, credentialGeneration: 1 },
      })
    })
    await service.assertAgentAuthorized(legacyId, `Bearer ${legacyToken}`)
    console.log('  PASS the same legacy Agent token authenticates after hash-only backfill')
    const migratedLegacy = await prisma.terminal.findUniqueOrThrow({ where: { id: legacyId } })
    assert(!migratedLegacy.agentToken.includes(legacyToken), 'legacy plaintext is erased after backfill')

    const first = await service.register({
      adminSecret: process.env['TERMINAL_ADMIN_SECRET']!,
      terminalCode: managedCode,
      deviceFingerprint: `fp-managed-${suffix}`,
    })
    const terminal = await prisma.terminal.findUniqueOrThrow({ where: { id: first.terminalId } })
    const stored = await prisma.terminalCredential.findUniqueOrThrow({ where: { id: first.credentialId } })
    assert(terminal.agentToken === first.terminalToken, 'expand release keeps the legacy carrier for rolling-deploy compatibility')
    assert(stored.tokenHash === crypto.createHash('sha256').update(first.terminalToken).digest('hex'), 'credential row stores SHA-256 token hash')
    assert(stored.expiresAt.toISOString() === first.expiresAt, 'response expiry exactly matches persisted expiry')
    assert(stored.generation === first.generation && terminal.credentialGeneration === first.generation, 'credential generation is persisted consistently')
    assert(stored.revokedAt === null, 'newly issued credential starts active')
    await service.assertAgentAuthorized(first.terminalId, `Bearer ${first.terminalToken}`)
    console.log('  PASS current hash-only credential authenticates')

    const rotated = await service.register({
      adminSecret: process.env['TERMINAL_ADMIN_SECRET']!,
      terminalCode: managedCode,
      deviceFingerprint: `fp-managed-${suffix}`,
    })
    assert(rotated.generation === first.generation + 1, 'rotation increments generation')
    await expectUnauthorized(
      () => service.assertAgentAuthorized(first.terminalId, `Bearer ${first.terminalToken}`),
      'AUTH_TOKEN_INVALID',
      'previous generation is rejected immediately',
    )
    await service.assertAgentAuthorized(first.terminalId, `Bearer ${rotated.terminalToken}`)
    console.log('  PASS rotated credential authenticates')

    const maintenance = await service.updateTerminalLifecycle(first.terminalId, 'maintenance', {
      actorId,
      actorRole: 'admin',
      reason: 'verify replacement credential maintenance flow',
    }, {
      expectedStatus: 'active',
      expectedVersion: terminal.lifecycleVersion,
    })
    assert(maintenance.newStatus === 'maintenance', 'replacement credential flow enters maintenance before bind-code creation')

    const bindCode = await service.createBindCode(first.terminalId, actorId, 10, {
      actorId,
      actorRole: 'admin',
    })
    const exchanged = await service.exchangeBindCode({
      bindCode: bindCode.bindCode,
      deviceFingerprint: `fp-bind-${suffix}`,
      agentVersion: 'verify-terminal-credentials',
    })
    assert(exchanged.generation === rotated.generation + 1, 'bind-code exchange increments generation')
    const consumedBindCode = await prisma.terminalBindCode.findUniqueOrThrow({
      where: { codeHash: crypto.createHash('sha256').update(bindCode.bindCode).digest('hex') },
    })
    assert(consumedBindCode.usedAt !== null, 'bind-code exchange consumes the code in the credential transaction')
    await expectUnauthorized(
      () => service.assertAgentAuthorized(first.terminalId, `Bearer ${rotated.terminalToken}`),
      'AUTH_TOKEN_INVALID',
      'bind-code exchange invalidates the previous token',
    )
    await service.assertAgentAuthorized(first.terminalId, `Bearer ${exchanged.terminalToken}`)
    console.log('  PASS bind-code exchanged hash-only credential authenticates')

    const beforeEmergency = await prisma.terminal.findUniqueOrThrow({ where: { id: first.terminalId } })
    const pendingBindCode = await service.createBindCode(first.terminalId, actorId, 10, {
      actorId,
      actorRole: 'admin',
    })
    const emergency = await service.emergencyRevokeCredentials(first.terminalId, {
      actorId,
      actorRole: 'admin',
      reason: 'verify emergency credential revocation',
    }, {
      expectedStatus: 'maintenance',
      expectedVersion: beforeEmergency.lifecycleVersion,
      expectedCredentialGeneration: beforeEmergency.credentialGeneration,
      confirmationText: `吊销 ${managedCode}`,
    })
    assert(
      emergency.lifecycleVersion === beforeEmergency.lifecycleVersion + 1 &&
        emergency.credentialGeneration === beforeEmergency.credentialGeneration + 1,
      'emergency revoke atomically increments lifecycle and credential generations',
    )
    assert(
      await prisma.terminalCredential.count({ where: { terminalId: first.terminalId, revokedAt: null } }) === 0,
      'emergency revoke revokes every active credential',
    )
    const pendingBindRow = await prisma.terminalBindCode.findUniqueOrThrow({
      where: { codeHash: crypto.createHash('sha256').update(pendingBindCode.bindCode).digest('hex') },
    })
    assert(pendingBindRow.revokedAt !== null, 'emergency revoke revokes every unused bind code')
    await expectUnauthorized(
      () => service.assertAgentAuthorized(first.terminalId, `Bearer ${exchanged.terminalToken}`),
      'AUTH_TOKEN_INVALID',
      'emergency revoke invalidates the previous token immediately',
    )
    const emergencyAudit = await prisma.auditLog.findFirstOrThrow({
      where: { targetId: managedCode, action: 'terminal.credential.emergency_revoke' },
      orderBy: { createdAt: 'desc' },
    })
    assert(
      !emergencyAudit.payloadJson.includes(exchanged.terminalToken) &&
        !emergencyAudit.payloadJson.includes(pendingBindCode.bindCode),
      'emergency audit contains no raw credential or bind code',
    )

    await prisma.terminalCredential.update({
      where: { id: exchanged.credentialId },
      data: { expiresAt: new Date(0), revokedAt: null },
    })
    await prisma.terminal.update({
      where: { id: first.terminalId },
      data: { agentToken: `cred$${exchanged.credentialId}`, credentialGeneration: exchanged.generation },
    })
    await expectUnauthorized(
      () => service.assertAgentAuthorized(first.terminalId, `Bearer ${exchanged.terminalToken}`),
      'AUTH_TOKEN_EXPIRED',
      'persisted expiry is enforced',
    )
    await expectUnauthorized(
      () => service.assertAgentAuthorized(first.terminalId, `Bearer cred$${exchanged.credentialId}`),
      'AUTH_TOKEN_INVALID',
      'credential sentinel cannot be used as bearer token',
    )

    const revokedToken = crypto.randomBytes(32).toString('hex')
    const revokedHash = crypto.createHash('sha256').update(revokedToken).digest('hex')
    const revokedId = `tc_${crypto.randomBytes(16).toString('hex')}`
    const revokedGeneration = exchanged.generation + 1
    await prisma.$transaction(async (tx) => {
      await tx.terminal.update({
        where: { id: first.terminalId },
        data: { agentToken: `cred$${revokedId}`, credentialGeneration: revokedGeneration },
      })
      await tx.terminalCredential.create({
        data: {
          id: revokedId,
          terminalId: first.terminalId,
          tokenHash: revokedHash,
          generation: revokedGeneration,
          issueSource: 'verify',
          expiresAt: new Date(Date.now() + 60_000),
          revokedAt: new Date(),
        },
      })
    })
    await expectUnauthorized(
      () => service.assertAgentAuthorized(first.terminalId, `Bearer ${revokedToken}`),
      'AUTH_TOKEN_REVOKED',
      'revoked credential is rejected',
    )
    await expectUnauthorized(
      () => service.assertAgentAuthorized(legacyId, `Bearer ${revokedToken}`),
      'AUTH_TOKEN_INVALID',
      'credential cannot authenticate a different terminal',
    )

    console.log('\nALL PASS')
  } finally {
    if (previousLegacyFlag === undefined) delete process.env['TERMINAL_LEGACY_REGISTER_ENABLED']
    else process.env['TERMINAL_LEGACY_REGISTER_ENABLED'] = previousLegacyFlag
    const managed = await prisma.terminal.findUnique({ where: { terminalCode: managedCode }, select: { id: true } })
    if (managed) await prisma.terminal.delete({ where: { id: managed.id } })
    await prisma.terminal.deleteMany({ where: { id: legacyId } })
    await prisma.auditLog.deleteMany({ where: { OR: [{ targetId: managedCode }, { actorId }] } })
    await prisma.user.deleteMany({ where: { id: actorId } })
    await prisma.onModuleDestroy()
  }
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
