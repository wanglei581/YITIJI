/**
 * Device fleet F0 read-only overview verification.
 *
 * This is intentionally database-free: projection behavior is exercised with
 * in-memory fixtures, while controller and service query shape are checked
 * statically so this script never needs a generated client or database.
 *
 * Run: pnpm --filter @ai-job-print/api verify:device-fleet-overview
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildDeviceFleetOverview,
  DEVICE_FLEET_ONLINE_WINDOW_MS,
  DEVICE_FLEET_ONLINE_WINDOW_SECONDS,
} from '../src/device-fleet/device-fleet.projection'
import type { DeviceFleetProjectionInput } from '../src/device-fleet/device-fleet.types'

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function terminalByCode(
  overview: ReturnType<typeof buildDeviceFleetOverview>,
  terminalCode: string,
) {
  const terminal = overview.terminals.find((item) => item.terminalCode === terminalCode)
  assert.ok(terminal, `missing terminal ${terminalCode}`)
  return terminal
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys)
    return keys
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      keys.add(key.toLowerCase())
      collectKeys(nested, keys)
    }
  }
  return keys
}

async function verifyProjection(): Promise<void> {
  const now = new Date('2026-07-15T06:00:00.000Z')
  const input: DeviceFleetProjectionInput = {
    terminals: [
      {
        id: 'internal-a', terminalCode: 'KSK-001', displayName: '一号机', locationLabel: '大厅',
        enabled: true, org: { name: '示例机构' },
        heartbeats: [{ status: 'online', agentVersion: '0.3.0', createdAt: new Date('2026-07-15T05:59:00.000Z') }],
      },
      {
        id: 'internal-b', terminalCode: 'KSK-002', displayName: null, locationLabel: null,
        enabled: true, org: null,
        heartbeats: [{ status: 'agent_degraded', agentVersion: '0.2.9', createdAt: new Date('2026-07-15T05:59:00.000Z') }],
      },
      {
        id: 'KSK-004', terminalCode: 'KSK-003', displayName: null, locationLabel: null,
        enabled: false, org: null,
        heartbeats: [{ status: 'online', agentVersion: null, createdAt: new Date('2026-07-15T05:50:00.000Z') }],
      },
      {
        id: 'internal-d', terminalCode: 'KSK-004', displayName: null, locationLabel: null,
        enabled: true, org: null, heartbeats: [],
      },
      {
        id: 'internal-e', terminalCode: 'KSK-005', displayName: null, locationLabel: null,
        enabled: true, org: null,
        heartbeats: [{ status: 'offline', agentVersion: '0.2.7', createdAt: new Date('2026-07-15T05:59:00.000Z') }],
      },
      {
        id: 'internal-f', terminalCode: 'KSK-006', displayName: null, locationLabel: null,
        enabled: true, org: null,
        heartbeats: [{ status: 'error', agentVersion: '0.2.6', createdAt: new Date('2026-07-15T05:59:00.000Z') }],
      },
      {
        id: 'internal-g', terminalCode: 'KSK-007', displayName: null, locationLabel: null,
        enabled: true, org: null,
        heartbeats: [{ status: null, agentVersion: null, createdAt: new Date('2026-07-15T05:59:00.000Z') }],
      },
      {
        id: 'internal-h', terminalCode: 'KSK-008', displayName: null, locationLabel: null,
        enabled: true, org: null,
        heartbeats: [{ status: 'unexpected_status', agentVersion: '0.1.0', createdAt: new Date('2026-07-15T05:59:00.000Z') }],
      },
    ],
    screensaverConfigs: [
      { terminalId: 'KSK-001', enabled: true, playlistId: 'playlist-safe', updatedAt: new Date('2026-07-15T05:30:00.000Z') },
      { terminalId: 'internal-b', enabled: false, playlistId: null, updatedAt: new Date('2026-07-15T05:31:00.000Z') },
      { terminalId: 'orphan-secret-ref', enabled: true, playlistId: 'playlist-orphan', updatedAt: new Date('2026-07-15T05:32:00.000Z') },
    ],
    smartCampusConfigs: [
      { terminalId: 'KSK-001', enabled: true, modulesJson: '{broken json', updatedAt: new Date('2026-07-15T05:33:00.000Z') },
      { terminalId: 'internal-b', enabled: true, modulesJson: '{"welcome":true,"luggage":true,"panorama":false}', updatedAt: new Date('2026-07-15T05:34:00.000Z') },
      { terminalId: 'KSK-004', enabled: true, modulesJson: '{"welcome":true}', updatedAt: new Date('2026-07-15T05:35:00.000Z') },
    ],
    toolboxConfigs: [
      { terminalId: 'KSK-001', enabled: true, itemsJson: '[{"key":"canonical"}]', updatedAt: new Date('2026-07-15T05:36:00.000Z') },
      { terminalId: 'internal-a', enabled: false, itemsJson: '[{"key":"legacy"}]', updatedAt: new Date('2026-07-15T05:37:00.000Z') },
      { terminalId: 'KSK-002', enabled: true, itemsJson: '{malformed', updatedAt: new Date('2026-07-15T05:38:00.000Z') },
    ],
  }

  const overview = buildDeviceFleetOverview(input, now)
  assert.equal(terminalByCode(overview, 'KSK-001').health, 'healthy')
  assert.equal(terminalByCode(overview, 'KSK-002').health, 'degraded')
  assert.equal(terminalByCode(overview, 'KSK-003').health, 'offline')
  assert.equal(terminalByCode(overview, 'KSK-004').health, 'unknown')
  assert.deepEqual(
    [terminalByCode(overview, 'KSK-005').health, terminalByCode(overview, 'KSK-005').healthReason],
    ['offline', 'agent_reported_offline'],
  )
  assert.deepEqual(
    [terminalByCode(overview, 'KSK-006').health, terminalByCode(overview, 'KSK-006').healthReason],
    ['degraded', 'agent_reported_error'],
  )
  assert.deepEqual(
    [terminalByCode(overview, 'KSK-007').health, terminalByCode(overview, 'KSK-007').healthReason],
    ['healthy', 'heartbeat_fresh'],
  )
  assert.deepEqual(
    [terminalByCode(overview, 'KSK-008').health, terminalByCode(overview, 'KSK-008').healthReason],
    ['degraded', 'agent_reported_error'],
  )
  assert.equal(terminalByCode(overview, 'KSK-003').enabled, false)
  pass('fresh, degraded, stale, historical offline/error/null, unknown, and enabled states are correct')

  assert.deepEqual(overview.summary, {
    total: 8, healthy: 2, degraded: 3, offline: 2, unknown: 1, disabled: 1,
    configurationConflictTerminals: 3, orphanConfigurationRecords: 1,
  })
  assert.equal(overview.generatedAt, now.toISOString())
  assert.equal(overview.onlineWindowSeconds, DEVICE_FLEET_ONLINE_WINDOW_SECONDS)
  assert.equal(DEVICE_FLEET_ONLINE_WINDOW_MS, DEVICE_FLEET_ONLINE_WINDOW_SECONDS * 1000)
  pass('overview summary and generation metadata are stable')

  const first = terminalByCode(overview, 'KSK-001')
  const second = terminalByCode(overview, 'KSK-002')
  assert.deepEqual(first.config.screensaver, {
    state: 'configured', enabled: true, playlistConfigured: true,
    updatedAt: '2026-07-15T05:30:00.000Z',
  })
  assert.equal(second.config.screensaver.state, 'legacy_reference')
  assert.equal(first.config.smartCampus.enabledModuleCount, 0)
  assert.equal(second.config.smartCampus.enabledModuleCount, 2)
  assert.equal(second.config.toolbox.itemCount, 0)
  assert.deepEqual(first.config.toolbox, {
    state: 'conflict', enabled: null, itemCount: null, updatedAt: null,
  })
  pass('config summaries, legacy references, malformed JSON, and dual-reference fail-closed behavior are correct')

  assert.deepEqual(overview.issues, [
    { area: 'screensaver', kind: 'orphan_config', affectedTerminalCodes: [] },
    { area: 'smart_campus', kind: 'cross_terminal_reference_collision', affectedTerminalCodes: ['KSK-003', 'KSK-004'] },
    { area: 'toolbox', kind: 'dual_reference_config', affectedTerminalCodes: ['KSK-001'] },
  ])
  assert.equal(terminalByCode(overview, 'KSK-003').config.smartCampus.state, 'conflict')
  assert.equal(terminalByCode(overview, 'KSK-004').config.smartCampus.state, 'conflict')
  pass('dual, cross-terminal namespace collision, and orphan issues are explicit without raw references')

  const bannedKeys = new Set([
    'id', 'orgid', 'macaddress', 'ipaddress', 'devicefingerprint', 'agenttoken', 'bindcode', 'codehash',
    'printerstatus', 'localtaskdatabaseavailable', 'diskfreegb', 'capabilities', 'file', 'files',
    'printtask', 'printtasks', 'scantask', 'scantasks', 'enduser', 'endusers',
  ])
  const leakedKeys = [...collectKeys(overview)].filter((key) => bannedKeys.has(key))
  assert.deepEqual(leakedKeys, [])
  const serialized = JSON.stringify(overview)
  for (const internalValue of [
    'internal-a', 'internal-b', 'internal-d', 'internal-e', 'internal-f', 'internal-g', 'internal-h',
    'orphan-secret-ref', '{broken json', '{malformed',
  ]) {
    assert.equal(serialized.includes(internalValue), false, `leaked internal value ${internalValue}`)
  }
  pass('recursive response scan excludes sensitive keys, internal IDs, raw refs, and raw JSON')
}

function verifyStaticGuards(): void {
  const controllerSource = readFileSync(join(process.cwd(), 'src/device-fleet/device-fleet.controller.ts'), 'utf8')
  const serviceSource = readFileSync(join(process.cwd(), 'src/device-fleet/device-fleet.service.ts'), 'utf8')
  assert.match(controllerSource, /@Controller\('admin\/device-fleet'\)/)
  assert.match(controllerSource, /@UseGuards\(JwtAuthGuard, RolesGuard\)/)
  assert.match(controllerSource, /@Roles\('admin'\)/)
  assert.match(controllerSource, /ApiResponse\.ok/)
  assert.equal((controllerSource.match(/@Get\(/g) ?? []).length, 1)
  assert.doesNotMatch(controllerSource, /@(Post|Put|Patch|Delete)\(/)
  assert.equal((serviceSource.match(/Promise\.all\(/g) ?? []).length, 1)
  assert.equal((serviceSource.match(/\.findMany\(/g) ?? []).length, 4)
  assert.doesNotMatch(serviceSource, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/)
  for (const forbidden of ['macAddress', 'ipAddress', 'deviceFingerprint', 'agentToken', 'bindCode', 'codeHash', 'printerStatus', 'localTaskDatabaseAvailable', 'diskFreeGb', 'capabilities']) {
    assert.equal(serviceSource.includes(forbidden), false, `service references forbidden field ${forbidden}`)
  }
  assert.equal(serviceSource.includes('registeredAt'), false, 'service selects unused registeredAt')
  const compactService = serviceSource.replace(/\s+/g, ' ')
  assert.match(compactService, /this\.prisma\.terminal\.findMany\(\{ orderBy: \{ terminalCode: 'asc' \}, select: \{ id: true, terminalCode: true, displayName: true, locationLabel: true, enabled: true, org: \{ select: \{ name: true \} \}, heartbeats: \{ orderBy: \{ createdAt: 'desc' \}, take: 1, select: \{ status: true, agentVersion: true, createdAt: true \}, \}, \}, \}\)/)
  assert.match(compactService, /terminalScreensaverConfig\.findMany\(\{ select: \{ terminalId: true, enabled: true, playlistId: true, updatedAt: true \}, \}\)/)
  assert.match(compactService, /terminalSmartCampusConfig\.findMany\(\{ select: \{ terminalId: true, enabled: true, modulesJson: true, updatedAt: true \}, \}\)/)
  assert.match(compactService, /terminalToolboxConfig\.findMany\(\{ select: \{ terminalId: true, enabled: true, itemsJson: true, updatedAt: true \}, \}\)/)
  pass('controller is admin-guarded GET-only and service uses one read-only Promise.all with strict selects')
}

async function main(): Promise<void> {
  console.log('\n=== Device fleet F0 read-only overview verification ===')
  await verifyProjection()
  verifyStaticGuards()
  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', error instanceof Error ? error.message : String(error))
  if (error instanceof Error) console.error(error.stack)
  process.exit(1)
})
