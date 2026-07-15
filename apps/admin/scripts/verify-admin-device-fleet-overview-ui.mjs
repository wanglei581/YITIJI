import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const adminRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const paths = {
  component: join(adminRoot, 'src/routes/devices/TerminalFleetOverview.tsx'),
  route: join(adminRoot, 'src/routes/devices/index.tsx'),
  types: join(adminRoot, 'src/services/api/types.ts'),
  devices: join(adminRoot, 'src/services/api/devices.ts'),
  http: join(adminRoot, 'src/services/api/adminHttpAdapter.ts'),
  mock: join(adminRoot, 'src/services/api/adminMockAdapter.ts'),
}

const read = (path) => existsSync(path) ? readFileSync(path, 'utf8') : ''
const source = Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, read(path)]))
const checks = []

function verify(name, assertion) {
  try {
    assertion()
    console.log(`  PASS ${name}`)
  } catch (error) {
    checks.push({ name, error })
    console.error(`  FAIL ${name}: ${error.message}`)
  }
}

console.log('\n=== Admin device fleet overview UI verification ===')

verify('overview component exists', () => {
  assert.equal(existsSync(paths.component), true, 'TerminalFleetOverview.tsx is missing')
})

verify('devices route exposes the same-page overview tab without changing the default', () => {
  assert.match(source.route, /key:\s*['"]overview['"]/)
  assert.match(source.route, /label:\s*['"]设备总览['"]/)
  assert.match(source.route, /LayoutDashboardIcon/)
  assert.match(source.route, /<TerminalFleetOverview\s*\/>/)
  assert.match(source.route, /\?\s*raw\s*:\s*['"]terminals['"]/, 'default tab must remain terminals')
})

verify('frontend contract is a strict device-fleet whitelist', () => {
  const start = source.types.indexOf('export type DeviceFleetHealth')
  const end = source.types.indexOf('// ─── Terminals', start)
  assert.ok(start >= 0 && end > start, 'device-fleet type block is missing')
  const contract = source.types.slice(start, end)
  for (const token of [
    'generatedAt', 'onlineWindowSeconds', 'configurationConflictTerminals',
    'orphanConfigurationRecords', 'terminalCode', 'healthReason',
    'hasConfigurationConflict', 'screensaver', 'smartCampus', 'toolbox',
    'affectedTerminalCodes',
  ]) {
    assert.ok(contract.includes(token), `device-fleet contract is missing ${token}`)
  }
  assert.doesNotMatch(
    contract,
    /\b(?:id|orgId|macAddress|ipAddress|deviceFingerprint|bindCode|agentToken|codeHash|printerStatus|localTaskDatabaseAvailable|diskFreeGb|capabilities|files?|printTask|scanTask|endUser)\b/,
  )
})

verify('device service and adapters expose one read-only GET', () => {
  assert.match(source.devices, /getDeviceFleetOverview\(\):\s*Promise<DeviceFleetOverview>/)
  assert.match(source.devices, /export const getDeviceFleetOverview\s*=\s*\(\)\s*=>\s*adapter\.getDeviceFleetOverview\(\)/)
  assert.match(
    source.http,
    /getDeviceFleetOverview:\s*\(\)\s*=>\s*getData<DeviceFleetOverview>\(['"]\/admin\/device-fleet\/overview['"]\)/,
  )
  assert.match(source.mock, /async getDeviceFleetOverview\(\):\s*Promise<DeviceFleetOverview>/)
})

verify('mock overview is independent from the sensitive terminal mock', () => {
  assert.match(source.mock, /MOCK_DEVICE_FLEET_OVERVIEW/)
  const start = source.mock.indexOf('async getDeviceFleetOverview()')
  const end = source.mock.indexOf('// ── 设备管理', start)
  const method = start >= 0 && end > start ? source.mock.slice(start, end) : ''
  assert.ok(method, 'mock getDeviceFleetOverview method is missing')
  assert.doesNotMatch(method, /getTerminals|macAddress|ipAddress|bindCode|agentToken|printerStatus/)
})

verify('overview uses refresh-safe polling and accessible status semantics', () => {
  for (const token of [
    'useRefreshable',
    "'admin-device-fleet-overview'",
    '30_000',
    "failPolicy: 'keep-last'",
    '<caption',
    'scope="col"',
    'role="alert"',
    'aria-busy',
  ]) {
    assert.ok(source.component.includes(token), `component is missing ${token}`)
  }
  assert.ok(source.component.includes('initialLoadFailed'))
  assert.ok(source.component.includes('设备总览加载失败，暂无可用数据'))
  assert.ok(source.component.includes('可能为预置配置'))
  assert.ok(source.component.includes('尚未匹配已注册终端'))
})

verify('overview links back to the existing terminal and configuration pages', () => {
  assert.ok(source.component.includes('/devices?tab=terminals&search=${encodeURIComponent(row.terminalCode)}'))
  for (const path of ['/screensaver', '/smart-campus', '/toolbox']) {
    assert.ok(source.component.includes(path), `component is missing ${path} deep link`)
  }
})

verify('overview remains read-only and excludes sensitive or future-scope capabilities', () => {
  assert.ok(source.component.includes('F1/F2 CLOSED_MODE'))
  assert.doesNotMatch(
    source.component,
    /\b(?:id|orgId|macAddress|ipAddress|deviceFingerprint|bindCode|agentToken|codeHash|printerStatus|localTaskDatabaseAvailable|diskFreeGb|capabilities|files?|printTask|scanTask|endUser)\b/,
  )
  assert.doesNotMatch(
    source.component,
    /createTerminalBindCode|updateTerminalProfile|assignTerminalOrg|postData|putData|patchData|deleteData/,
  )
  assert.doesNotMatch(source.component, /<(?:button|a)[^>]*>[^<]*(?:换机|发布)[^<]*<\/(?:button|a)>/)
})

if (checks.length > 0) {
  console.error(`\n${checks.length} verification check(s) failed`)
  process.exit(1)
}

console.log('\nALL PASS')
