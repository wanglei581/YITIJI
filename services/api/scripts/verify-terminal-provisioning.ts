/** Gate 0 batch 2: Admin pre-provisioning + legacy-register closure verification. */

import crypto from 'node:crypto'
import { inspect } from 'node:util'
import { HttpException } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { TerminalToolboxService } from '../src/terminals/terminal-toolbox.service'
import { TerminalAgentService } from '../src/terminals/terminals-agent.service'
import { TerminalAdminService } from '../src/terminals/terminals-admin.service'
import { TerminalsService } from '../src/terminals/terminals.service'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
  console.log(`  PASS ${message}`)
}

function responseCode(error: unknown): string | undefined {
  if (!(error instanceof HttpException)) return undefined
  const response = error.getResponse() as { error?: { code?: string } }
  return response.error?.code
}

async function expectRejected(action: () => Promise<unknown>, code: string, message: string): Promise<void> {
  try {
    await action()
  } catch (error) {
    assert(responseCode(error) === code, `${message} (${code})`)
    return
  }
  throw new Error(`${message}: expected ${code}`)
}

async function expectDatabaseRejected(
  action: () => Promise<unknown>,
  expectedDatabaseMessage: string,
  message: string,
): Promise<void> {
  try {
    await action()
  } catch (error) {
    const details = inspect(error, { depth: 8 })
    assert(details.includes(expectedDatabaseMessage), `${message} (${expectedDatabaseMessage})`)
    return
  }
  throw new Error(`${message}: expected database rejection`)
}

async function main(): Promise<void> {
  console.log('\n=== terminal planned provisioning verification ===')
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const suffix = crypto.randomBytes(6).toString('hex')
  const terminalCode = `PLAN-${suffix}`
  const actorId = `u_terminal_provisioning_${suffix}`
  const audit = new AuditService(prisma)
  const agent = new TerminalAgentService(prisma, audit)
  const admin = new TerminalAdminService(prisma, agent, new TerminalToolboxService(prisma))
  const service = new TerminalsService(agent, admin)
  const previousLegacyFlag = process.env['TERMINAL_LEGACY_REGISTER_ENABLED']
  const previousProvisioningFlag = process.env['TERMINAL_PLANNED_PROVISIONING_ENABLED']
  const taskIds: string[] = []

  try {
    await prisma.user.create({
      data: {
        id: actorId,
        username: `verify-terminal-provisioning-${suffix}`,
        passwordHash: 'verify-only-not-a-login-secret',
        name: 'Terminal provisioning verifier',
        role: 'admin',
      },
    })
    process.env['TERMINAL_PLANNED_PROVISIONING_ENABLED'] = 'false'
    await expectRejected(
      () => service.createPlannedTerminal({ terminalCode }),
      'TERMINAL_PLANNED_PROVISIONING_DISABLED',
      'planned provisioning writer is closed unless explicitly enabled',
    )

    process.env['TERMINAL_PLANNED_PROVISIONING_ENABLED'] = 'true'
    const created = await service.createPlannedTerminal({
      terminalCode,
      displayName: 'Gate 0 planned verifier',
      locationLabel: 'isolated verification',
    })
    assert(created.lifecycleStatus === 'planned', 'Admin pre-provisioning creates planned lifecycle')
    const planned = await prisma.terminal.findUniqueOrThrow({ where: { id: created.terminalId } })
    assert(planned.agentToken.startsWith('planned$'), 'planned asset stores only an internal non-authenticating placeholder')
    assert(planned.credentialGeneration === 0, 'planned asset has no issued credential generation')
    assert(await prisma.terminalCredential.count({ where: { terminalId: planned.id } }) === 0, 'planned asset has no credential row')

    await expectDatabaseRejected(
      () => prisma.terminal.update({
        where: { id: planned.id },
        data: { agentToken: `old-api-token-${suffix}`, credentialGeneration: 1 },
      }),
      'planned terminal requires bind-code exchange',
      'database guard blocks an old API binary from overwriting a planned credential',
    )
    await expectDatabaseRejected(
      () => prisma.terminal.update({ where: { id: planned.id }, data: { lifecycleStatus: 'active' } }),
      'planned terminal requires bind-code exchange',
      'database guard blocks direct planned-to-active transition',
    )
    await expectDatabaseRejected(
      () => prisma.terminal.create({
        data: {
          id: `t_invalid_planned_${suffix}`,
          terminalCode: `INVALID-PLANNED-${suffix}`,
          agentToken: `raw-invalid-${suffix}`,
          credentialGeneration: 0,
          lifecycleStatus: 'planned',
          deviceFingerprint: `invalid-planned-${suffix}`,
        },
      }),
      'invalid planned terminal credential state',
      'database guard rejects a planned asset without the planned placeholder',
    )
    await expectDatabaseRejected(
      () => prisma.terminalCredential.create({
        data: {
          id: `tc_invalid_${suffix}`,
          terminalId: planned.id,
          tokenHash: crypto.createHash('sha256').update(`invalid-${suffix}`).digest('hex'),
          generation: 1,
          issueSource: 'bind_code',
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
      'planned terminal cannot own a credential',
      'database guard rejects credentials attached to a planned asset',
    )

    const credentialSource = await prisma.terminal.create({
      data: {
        id: `t_credential_source_${suffix}`,
        terminalCode: `CREDENTIAL-SOURCE-${suffix}`,
        agentToken: `credential-source-${suffix}`,
        credentialGeneration: 1,
        lifecycleStatus: 'active',
        deviceFingerprint: `credential-source-${suffix}`,
      },
    })
    const movableCredential = await prisma.terminalCredential.create({
      data: {
        id: `tc_movable_${suffix}`,
        terminalId: credentialSource.id,
        tokenHash: crypto.createHash('sha256').update(`movable-${suffix}`).digest('hex'),
        generation: 1,
        issueSource: 'bind_code',
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    await expectDatabaseRejected(
      () => prisma.terminalCredential.update({
        where: { id: movableCredential.id },
        data: { terminalId: planned.id },
      }),
      'planned terminal cannot own a credential',
      'database guard rejects re-parenting an existing credential to a planned asset',
    )

    await expectRejected(
      () => service.assertAgentAuthorized(planned.id, `Bearer ${planned.agentToken}`),
      'TERMINAL_NOT_ACTIVATED',
      'planned placeholder can never authenticate',
    )

    // Defense in depth: authentication must trust lifecycleStatus, not the
    // planned$ carrier prefix. A minimal read stub simulates an anomalous row
    // created during the gap before the database guard was installed.
    const anomalousReader = {
      terminal: {
        findUnique: async () => ({
          id: planned.id,
          agentToken: `legacy-gap-token-${suffix}`,
          credentialGeneration: 1,
          enabled: true,
          lifecycleStatus: 'planned',
        }),
      },
    } as unknown as PrismaService
    const anomalousAgent = new TerminalAgentService(anomalousReader, new AuditService(anomalousReader))
    const anomalousAdmin = new TerminalAdminService(
      anomalousReader,
      anomalousAgent,
      new TerminalToolboxService(anomalousReader),
    )
    const anomalousService = new TerminalsService(anomalousAgent, anomalousAdmin)
    await expectRejected(
      () => anomalousService.assertAgentAuthorized(planned.id, `Bearer legacy-gap-token-${suffix}`),
      'TERMINAL_NOT_ACTIVATED',
      'planned lifecycle rejects a legacy raw token even after a historical migration-gap overwrite',
    )

    process.env['TERMINAL_LEGACY_REGISTER_ENABLED'] = 'false'
    await expectRejected(
      () => service.register({
        adminSecret: process.env['TERMINAL_ADMIN_SECRET']!,
        terminalCode: `LEGACY-CLOSED-${suffix}`,
        deviceFingerprint: `legacy-closed-${suffix}`,
      }),
      'TERMINAL_LEGACY_REGISTER_DISABLED',
      'legacy shared-secret registration is closed unless explicitly enabled',
    )

    process.env['TERMINAL_LEGACY_REGISTER_ENABLED'] = 'true'
    await expectRejected(
      () => service.register({
        adminSecret: process.env['TERMINAL_ADMIN_SECRET']!,
        terminalCode,
        deviceFingerprint: `bypass-${suffix}`,
      }),
      'TERMINAL_BIND_CODE_REQUIRED',
      'legacy registration cannot claim a planned asset',
    )

    await expectRejected(
      () => service.createPlannedTerminal({ terminalCode }),
      'TERMINAL_CODE_ALREADY_EXISTS',
      'duplicate terminalCode is rejected',
    )

    const bind = await service.createBindCode(planned.id, actorId, 10, {
      actorId,
      actorRole: 'admin',
    })
    const exchanged = await service.exchangeBindCode({
      bindCode: bind.bindCode,
      deviceFingerprint: `activated-${suffix}`,
      agentVersion: 'verify-terminal-provisioning',
    })
    const commissioning = await prisma.terminal.findUniqueOrThrow({ where: { id: planned.id } })
    assert(commissioning.lifecycleStatus === 'commissioning', 'bind-code activation moves planned asset to commissioning')
    assert(!commissioning.agentToken.startsWith('planned$'), 'activation replaces planned placeholder')
    assert(exchanged.generation === 1 && commissioning.credentialGeneration === 1, 'first activation issues generation 1')
    await service.assertAgentAuthorized(planned.id, `Bearer ${exchanged.terminalToken}`)
    console.log('  PASS activated terminal credential authenticates')

    const adminView = await service.listTerminalsForAdmin()
    const listed = adminView.terminals.find((terminal) => terminal.id === planned.id)
    assert(listed?.lifecycleStatus === 'commissioning', 'Admin list exposes lifecycle status')
    assert(listed.online === false, 'terminal without heartbeat is never reported online')

    await service.heartbeat(
      planned.id,
      { status: 'online', agentVersion: 'verify-terminal-provisioning' },
      `Bearer ${exchanged.terminalToken}`,
    )
    const activated = await prisma.terminal.findUniqueOrThrow({ where: { id: planned.id } })
    assert(activated.lifecycleStatus === 'active', 'first authenticated heartbeat closes commissioning to active')
    const activeAdminView = await service.listTerminalsForAdmin()
    const activeListed = activeAdminView.terminals.find((terminal) => terminal.id === planned.id)
    assert(activeListed?.online === true, 'successful heartbeat reports the activated terminal online')

    const activeCode = `ACTIVE-${suffix}`
    const active = await prisma.terminal.create({
      data: {
        id: `t_active_${suffix}`,
        terminalCode: activeCode,
        agentToken: `active-placeholder-${suffix}`,
        deviceFingerprint: `active-${suffix}`,
        lifecycleStatus: 'active',
      },
    })
    await expectRejected(
      () => service.createBindCode(active.id, actorId, 10),
      'TERMINAL_MAINTENANCE_REQUIRED',
      'active terminal cannot mint a replacement bind code before maintenance',
    )

    const maintenance = await service.updateTerminalLifecycle(active.id, 'maintenance', {
      actorId, actorRole: 'admin', reason: 'verify enter maintenance',
    }, {
      expectedStatus: 'active',
      expectedVersion: active.lifecycleVersion,
    })
    assert(maintenance.newStatus === 'maintenance', 'Admin lifecycle transition enters maintenance')
    await expectRejected(
      () => service.updateTerminalLifecycle(active.id, 'active', {
        actorId, actorRole: 'admin', reason: 'verify stale lifecycle request',
      }, {
        expectedStatus: 'maintenance',
        expectedVersion: active.lifecycleVersion,
      }),
      'TERMINAL_LIFECYCLE_CONFLICT',
      'stale lifecycle version cannot reopen a newer maintenance cycle',
    )
    await service.heartbeat(
      active.id,
      { status: 'online', agentVersion: 'verify-maintenance' },
      `Bearer active-placeholder-${suffix}`,
    )
    console.log('  PASS maintenance terminal keeps heartbeat available')

    const pendingTaskId = `ptask_maintenance_pending_${suffix}`
    taskIds.push(pendingTaskId)
    await prisma.printTask.create({
      data: {
        id: pendingTaskId,
        terminalId: active.id,
        fileUrl: '/verify/maintenance.pdf',
        fileMd5: suffix,
        status: 'pending',
      },
    })
    const maintenanceClaim = await service.claimTasks(
      active.id,
      { maxTasks: 1 },
      `Bearer active-placeholder-${suffix}`,
    )
    assert(maintenanceClaim.length === 0, 'maintenance terminal cannot claim a new task')
    assert(
      (await prisma.printTask.findUniqueOrThrow({ where: { id: pendingTaskId } })).status === 'pending',
      'maintenance claim denial leaves pending task unchanged',
    )

    const inFlightTaskId = `ptask_maintenance_claimed_${suffix}`
    taskIds.push(inFlightTaskId)
    await prisma.printTask.create({
      data: {
        id: inFlightTaskId,
        terminalId: active.id,
        fileUrl: '/verify/in-flight.pdf',
        fileMd5: suffix,
        status: 'claimed',
        claimedAt: new Date(),
        claimExpiry: new Date(Date.now() + 60_000),
      },
    })
    await expectRejected(
      () => service.createBindCode(active.id, actorId, 10),
      'TERMINAL_IN_FLIGHT_TASKS',
      'maintenance terminal with claimed/printing work cannot mint a replacement bind code',
    )
    await service.patchTaskStatus(
      inFlightTaskId,
      { status: 'printing' },
      `Bearer active-placeholder-${suffix}`,
      active.id,
    )
    assert(
      (await prisma.printTask.findUniqueOrThrow({ where: { id: inFlightTaskId } })).status === 'printing',
      'maintenance terminal can report progress for already claimed work',
    )
    await service.patchTaskStatus(
      inFlightTaskId,
      { status: 'failed', errorCode: 'VERIFY_DRAINED' },
      `Bearer active-placeholder-${suffix}`,
      active.id,
    )

    const activeBind = await service.createBindCode(active.id, actorId, 10, {
      actorId,
      actorRole: 'admin',
    })
    const replacement = await service.exchangeBindCode({
      bindCode: activeBind.bindCode,
      deviceFingerprint: `active-rebind-${suffix}`,
    })
    const reboundActive = await prisma.terminal.findUniqueOrThrow({ where: { id: active.id } })
    assert(reboundActive.lifecycleStatus === 'maintenance', 'replacement bind preserves maintenance until explicit recommission')
    await expectRejected(
      () => service.assertAgentAuthorized(active.id, `Bearer active-placeholder-${suffix}`),
      'AUTH_TOKEN_INVALID',
      'replacement bind invalidates the old terminal token immediately',
    )
    await service.assertAgentAuthorized(active.id, `Bearer ${replacement.terminalToken}`)
    console.log('  PASS replacement token authenticates')
    const recommissioned = await service.updateTerminalLifecycle(active.id, 'active', {
      actorId, actorRole: 'admin', reason: 'verify resume after maintenance',
    }, {
      expectedStatus: 'maintenance',
      expectedVersion: maintenance.lifecycleVersion,
    })
    assert(recommissioned.newStatus === 'active', 'Admin lifecycle transition returns maintenance terminal to active')

    const expiredClaimedId = `ptask_expired_claimed_${suffix}`
    const expiredPrintingId = `ptask_expired_printing_${suffix}`
    taskIds.push(expiredClaimedId, expiredPrintingId)
    await prisma.printTask.createMany({
      data: [
        {
          id: expiredClaimedId,
          terminalId: active.id,
          fileUrl: '/verify/expired-claimed.pdf',
          fileMd5: suffix,
          status: 'claimed',
          claimedAt: new Date(Date.now() - 20 * 60_000),
          claimExpiry: new Date(Date.now() - 60_000),
        },
        {
          id: expiredPrintingId,
          terminalId: active.id,
          fileUrl: '/verify/expired-printing.pdf',
          fileMd5: suffix,
          status: 'printing',
          claimedAt: new Date(Date.now() - 20 * 60_000),
          updatedAt: new Date(Date.now() - 20 * 60_000),
        },
      ],
    })
    await prisma.order.createMany({
      data: [
        { orderNo: `VERIFY-CLAIMED-${suffix}`, printTaskId: expiredClaimedId, terminalId: active.id, taskStatus: 'claimed' },
        { orderNo: `VERIFY-PRINTING-${suffix}`, printTaskId: expiredPrintingId, terminalId: active.id, taskStatus: 'printing' },
      ],
    })
    await agent.resetExpiredClaims()
    const timedOut = await prisma.printTask.findMany({ where: { id: { in: [expiredClaimedId, expiredPrintingId] } } })
    assert(
      timedOut.every((task) => task.status === 'failed' && task.errorCode === 'PRINT_JOB_UNCONFIRMED'),
      'expired claimed/printing tasks fail as PRINT_JOB_UNCONFIRMED instead of returning pending',
    )
    const timeoutOrders = await prisma.order.findMany({ where: { printTaskId: { in: [expiredClaimedId, expiredPrintingId] } } })
    assert(timeoutOrders.every((order) => order.taskStatus === 'failed'), 'timeout failure mirrors into Order.taskStatus')
    assert(
      await prisma.printTaskStatusLog.count({
        where: { taskId: { in: [expiredClaimedId, expiredPrintingId] }, toStatus: 'failed', errorCode: 'PRINT_JOB_UNCONFIRMED' },
      }) === 2,
      'timeout failure writes status logs for claimed and printing tasks',
    )
    assert(
      await prisma.auditLog.count({
        where: { targetId: { in: [expiredClaimedId, expiredPrintingId] }, action: 'print_job.timeout_unconfirmed', actorId: null },
      }) === 2,
      'timeout failure writes system audit rows with null actorId',
    )

    const suspended = await service.updateTerminalLifecycle(active.id, 'suspended', {
      actorId, actorRole: 'admin', reason: 'verify suspend preserves drain access',
    }, {
      expectedStatus: 'active',
      expectedVersion: recommissioned.lifecycleVersion,
    })
    assert(suspended.newStatus === 'suspended', 'active terminal can be suspended with lifecycle CAS')
    await service.heartbeat(
      active.id,
      { status: 'online', agentVersion: 'verify-suspended' },
      `Bearer ${replacement.terminalToken}`,
    )
    console.log('  PASS suspended terminal preserves credential for heartbeat and drain reporting')
    assert(
      (await service.claimTasks(active.id, { maxTasks: 1 }, `Bearer ${replacement.terminalToken}`)).length === 0,
      'suspended terminal cannot claim a new print task',
    )
    const retirementReady = await service.updateTerminalLifecycle(active.id, 'maintenance', {
      actorId, actorRole: 'admin', reason: 'verify prepare terminal retirement',
    }, {
      expectedStatus: 'suspended',
      expectedVersion: suspended.lifecycleVersion,
    })
    await expectRejected(
      () => service.updateTerminalLifecycle(active.id, 'retired', {
        actorId, actorRole: 'admin', reason: 'verify retirement task guard', confirmationText: activeCode,
      }, {
        expectedStatus: 'maintenance',
        expectedVersion: retirementReady.lifecycleVersion,
      }),
      'TERMINAL_ACTIVE_TASKS',
      'pending print task blocks terminal retirement',
    )
    await prisma.printTask.update({ where: { id: pendingTaskId }, data: { status: 'cancelled' } })
    const retiredScanTask = await prisma.scanTask.create({
      data: {
        terminalId: active.id,
        scanType: 'document',
        status: 'failed',
        expiresAt: new Date(Date.now() + 60_000),
      },
      select: { id: true },
    })
    const retired = await service.updateTerminalLifecycle(active.id, 'retired', {
      actorId, actorRole: 'admin', reason: 'verify permanent terminal retirement', confirmationText: activeCode,
    }, {
      expectedStatus: 'maintenance',
      expectedVersion: retirementReady.lifecycleVersion,
    })
    const retiredRow = await prisma.terminal.findUniqueOrThrow({ where: { id: active.id } })
    assert(retired.newStatus === 'retired' && !retiredRow.enabled, 'retirement is persisted and disables the terminal')
    await expectRejected(
      () => service.assertAgentAuthorized(active.id, `Bearer ${replacement.terminalToken}`),
      'TERMINAL_RETIRED',
      'retired terminal rejects Agent authentication even with the prior token',
    )
    await expectRejected(
      () => service.updateTerminalLifecycle(active.id, 'maintenance', {
        actorId, actorRole: 'admin', reason: 'verify retired is irreversible',
      }, {
        expectedStatus: 'maintenance',
        expectedVersion: retired.lifecycleVersion,
      }),
      'TERMINAL_RETIRED',
      'retired lifecycle is irreversible',
    )
    await expectDatabaseRejected(
      () => prisma.terminal.update({
        where: { id: active.id },
        data: { lifecycleStatus: 'maintenance', enabled: true },
      }),
      'retired terminal is irreversible',
      'database guard rejects direct retired lifecycle restoration',
    )
    await expectDatabaseRejected(
      () => prisma.terminal.update({
        where: { id: active.id },
        data: { agentToken: `cred$retired$rewritten_${suffix}` },
      }),
      'retired terminal is irreversible',
      'database guard rejects retired carrier rewrites even with the sentinel prefix',
    )
    await expectDatabaseRejected(
      () => prisma.terminal.update({
        where: { id: active.id },
        data: {
          terminalCode: `RELEASED-${suffix}`,
          deviceFingerprint: `released-fingerprint-${suffix}`,
          macAddress: `02:00:00:${suffix.slice(0, 2)}:${suffix.slice(2, 4)}:${suffix.slice(4, 6)}`,
        },
      }),
      'retired terminal is irreversible',
      'database guard freezes retired terminal identity fields',
    )
    await expectDatabaseRejected(
      () => prisma.terminal.delete({ where: { id: active.id } }),
      'retired terminal cannot be deleted',
      'database guard preserves the retired row as a permanent identity tombstone',
    )
    await expectDatabaseRejected(
      () => prisma.terminal.create({
        data: {
          id: `malformed_retired_${suffix}`,
          terminalCode: `MALFORMED-RETIRED-${suffix}`,
          agentToken: `cred$retired$${suffix}`,
          deviceFingerprint: `malformed-retired-fp-${suffix}`,
          lifecycleStatus: 'retired',
          enabled: false,
        },
      }),
      'retired terminal identity cannot be inserted',
      'database guard rejects direct retired inserts',
    )
    await expectDatabaseRejected(
      () => prisma.terminalCredential.updateMany({
        where: { terminalId: active.id },
        data: { revokedAt: null },
      }),
      'retired terminal credential is immutable',
      'database guard rejects reviving a retired terminal credential',
    )
    await expectDatabaseRejected(
      () => prisma.terminalBindCode.updateMany({
        where: { terminalId: active.id },
        data: { revokedAt: null },
      }),
      'retired terminal bind code is immutable',
      'database guard rejects reviving a retired terminal bind code',
    )
    await expectDatabaseRejected(
      () => prisma.printTask.update({ where: { id: pendingTaskId }, data: { status: 'pending' } }),
      'retired terminal cannot receive new work',
      'database guard rejects reviving terminal print work after retirement',
    )
    await expectDatabaseRejected(
      () => prisma.scanTask.update({ where: { id: retiredScanTask.id }, data: { status: 'waiting' } }),
      'retired terminal cannot receive new work',
      'database guard rejects reviving terminal scan work after retirement',
    )

    const controllerSource = readFileSync(join(process.cwd(), 'src/terminals/admin-terminals.controller.ts'), 'utf8')
    const lifecycleSource = readFileSync(join(process.cwd(), 'src/terminals/terminals-admin.service.ts'), 'utf8')
    assert(
      controllerSource.includes("@Patch(':terminalId/lifecycle')") &&
        lifecycleSource.includes("action: 'terminal.lifecycle.update'") &&
        lifecycleSource.includes('lifecycleVersion: { increment: 1 }'),
      'Admin exposes one lifecycle endpoint and audits lifecycle changes',
    )
    console.log('\nALL PASS')
  } finally {
    if (previousLegacyFlag === undefined) delete process.env['TERMINAL_LEGACY_REGISTER_ENABLED']
    else process.env['TERMINAL_LEGACY_REGISTER_ENABLED'] = previousLegacyFlag
    if (previousProvisioningFlag === undefined) delete process.env['TERMINAL_PLANNED_PROVISIONING_ENABLED']
    else process.env['TERMINAL_PLANNED_PROVISIONING_ENABLED'] = previousProvisioningFlag
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { targetId: { in: [terminalCode, `ACTIVE-${suffix}`, `CREDENTIAL-SOURCE-${suffix}`] } },
          { actorId },
        ],
      },
    })
    const verifierTerminals = await prisma.terminal.findMany({
      where: { terminalCode: { in: [terminalCode, `ACTIVE-${suffix}`, `CREDENTIAL-SOURCE-${suffix}`] } },
      select: { id: true },
    })
    if (taskIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { targetId: { in: taskIds } } })
      await prisma.order.deleteMany({ where: { printTaskId: { in: taskIds } } })
      await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { in: taskIds } } })
      await prisma.printTask.deleteMany({ where: { id: { in: taskIds } } })
    }
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId: { in: verifierTerminals.map((terminal) => terminal.id) } } })
    await prisma.terminal.deleteMany({ where: { terminalCode } })
    // ACTIVE fixture 已永久退役，数据库 guard 将其保留为不可删除的身份 tombstone。
    await prisma.terminal.deleteMany({ where: { terminalCode: `LEGACY-CLOSED-${suffix}` } })
    await prisma.terminal.deleteMany({ where: { terminalCode: `CREDENTIAL-SOURCE-${suffix}` } })
    await prisma.user.deleteMany({ where: { id: actorId } })
    await prisma.onModuleDestroy()
  }
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
