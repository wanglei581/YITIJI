/**
 * 屏上扫描后端 B9：扫描仪告警只算仍在运营的终端。
 *
 * 覆盖：
 *   1. enabled 且 lifecycleStatus 为 active、scan_device 为 available、心跳在在线窗口内、
 *      健康值为 not_found 时，收集与正向查证都有一条扫描仪告警
 *   2. 停用（enabled: false）但其余条件相同，不出告警，正向查证为空
 *   3. 非 active（这里用 maintenance）但其余条件相同，不出告警，正向查证为空
 *   4. terminalSubjectKeysInScope 仍只有离线与打印机，不收扫描仪
 *
 * 写库：本脚本在库里造终端 / 能力 / 心跳，结束时清理，所以必须在隔离库上跑
 * （VERIFICATION_DATABASE_TARGET=isolated，库名带 ci/dev/test/verify）。
 *
 * 运行：VERIFICATION_DATABASE_TARGET=isolated pnpm --filter @ai-job-print/api verify:scan-device-b9
 */
import 'reflect-metadata'
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'

import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { collectDerivedAlerts, resolveDerivedAlert } from '../src/admin-ops/derived-alerts'
import { collectScanDeviceAlerts, resolveScanDeviceAlert } from '../src/admin-ops/derived-scan-device-alerts'
import { PrismaService } from '../src/prisma/prisma.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

function pass(label: string): void {
  console.log(`  PASS ${label}`)
}

async function main(): Promise<void> {
  assertIsolatedVerificationDatabase()

  const suffix = randomBytes(5).toString('hex')
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const ids: string[] = []

  async function makeTerminal(tag: string, patch: { enabled?: boolean; lifecycleStatus?: string }) {
    const id = `t_b9_${tag}_${suffix}`
    await prisma.terminal.create({
      data: {
        id,
        terminalCode: `B9-${tag}-${suffix}`.toUpperCase(),
        agentToken: `b9-token-${tag}-${randomBytes(8).toString('hex')}`,
        deviceFingerprint: `verify-scan-device-b9-${tag}-${suffix}`,
        enabled: patch.enabled ?? true,
        lifecycleStatus: patch.lifecycleStatus ?? 'active',
      },
    })
    ids.push(id)
    await prisma.terminalCapability.create({
      data: {
        terminalId: id,
        capabilityKey: 'scan_device',
        status: 'available',
        updatedBy: 'verify-scan-device-b9',
      },
    })
    await prisma.terminalHeartbeat.create({
      data: {
        terminalId: id,
        status: 'online',
        printerStatus: 'ready',
        scanDeviceHealth: 'not_found',
      },
    })
    return { id }
  }

  try {
    const active = await makeTerminal('active', {})
    const disabled = await makeTerminal('disabled', { enabled: false })
    const maintenance = await makeTerminal('maint', { lifecycleStatus: 'maintenance' })
    const now = new Date()

    const collected = await collectScanDeviceAlerts(prisma, now)
    const forTerminal = (terminalId: string) => collected.filter((alert) => alert.subjectId === terminalId)
    const activeAlerts = forTerminal(active.id)
    assert.equal(activeAlerts.length, 1, '运营中的终端应有一条扫描仪告警')
    assert.equal(activeAlerts[0]?.subjectKey, `scan_device_issue:${active.id}`)
    assert.equal(activeAlerts[0]?.severity, 'error')
    assert.match(activeAlerts[0]?.title ?? '', /扫描仪找不到/)
    assert.equal(forTerminal(disabled.id).length, 0, '停用终端不出扫描仪告警')
    assert.equal(forTerminal(maintenance.id).length, 0, '非 active 终端不出扫描仪告警')

    const resolvedActive = await resolveScanDeviceAlert(prisma, active.id, now)
    assert.equal(resolvedActive?.subjectKey, `scan_device_issue:${active.id}`, '运营中的终端正向查证找得到')
    assert.equal(await resolveScanDeviceAlert(prisma, disabled.id, now), null, '停用终端正向查证为空')
    assert.equal(await resolveScanDeviceAlert(prisma, maintenance.id, now), null, '非 active 终端正向查证为空')

    const derived = await collectDerivedAlerts(prisma, now)
    const derivedScan = derived.alerts.filter((alert) => alert.type === 'scan_device_issue')
    assert.deepEqual(derivedScan.map((alert) => alert.subjectId).sort(), [active.id].sort(), '列表里的扫描仪告警只有运营中的那一台')
    assert.equal(
      (await resolveDerivedAlert(prisma, 'scan_device_issue', active.id, now))?.subjectKey,
      `scan_device_issue:${active.id}`,
    )
    assert.equal(await resolveDerivedAlert(prisma, 'scan_device_issue', disabled.id, now), null)
    assert.equal(await resolveDerivedAlert(prisma, 'scan_device_issue', maintenance.id, now), null)

    const scope = new Set(derived.terminalSubjectKeysInScope)
    assert.equal(scope.has(`terminal_offline:${active.id}`), true, '运营中的终端仍在离线考察范围内')
    assert.equal(scope.has(`printer_issue:${active.id}`), true, '运营中的终端仍在打印机考察范围内')
    assert.equal(scope.has(`scan_device_issue:${active.id}`), false, '扫描仪不放进已恢复推送范围')
    assert.equal(scope.has(`scan_device_issue:${disabled.id}`), false)
    assert.equal(scope.has(`scan_device_issue:${maintenance.id}`), false)
    assert.equal(scope.has(`terminal_offline:${disabled.id}`), false, '停用终端本来就不在离线考察范围内')
    assert.equal(scope.has(`terminal_offline:${maintenance.id}`), false, '非 active 终端本来就不在离线考察范围内')

    pass('扫描仪告警只算 enabled 且 active 的终端；已恢复推送范围仍只有离线和打印机')
    console.log('\nPASS verify-scan-device-b9')
  } finally {
    await prisma.terminalHeartbeat.deleteMany({ where: { terminalId: { in: ids } } }).catch(() => undefined)
    await prisma.terminalCapability.deleteMany({ where: { terminalId: { in: ids } } }).catch(() => undefined)
    await prisma.terminal.deleteMany({ where: { id: { in: ids } } }).catch(() => undefined)
    await prisma.onModuleDestroy().catch(() => undefined)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
