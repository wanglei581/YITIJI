import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const page = readFileSync(join(root, 'src/routes/terminals/index.tsx'), 'utf8')
const componentPath = join(root, 'src/routes/terminals/TerminalNetworkDiagnostics.tsx')
const component = existsSync(componentPath) ? readFileSync(componentPath, 'utf8') : ''
const types = readFileSync(join(root, 'src/services/api/types.ts'), 'utf8')

assert.ok(component, 'network diagnostics component is missing')
assert.match(page, /TerminalNetworkDiagnostics/)
assert.match(page, /链路诊断/)
assert.match(component, /云端已连/)
assert.match(component, /网线已连/)
assert.match(component, /打印机可达/)
assert.match(component, /aria-label="只读网络链路诊断"/)
assert.match(component, /online \? wiredStatus\(wiredNetworkStatus\) : 'unknown'/)
assert.match(component, /online \? printerStatus\(printerNetworkStatus\) : 'unknown'/)
assert.doesNotMatch(component, /(?:密码|SSID|网关|printerHostAddress|ipAddress|localApiBridgeToken|agentToken|bindCode)/)
assert.doesNotMatch(page, /(?:updateNetwork|saveWifi|configureAdapter|setNetIPAddress)/)
assert.match(types, /wiredNetworkStatus/)
assert.match(types, /printerNetworkStatus/)
console.log('ALL PASS: Admin renders enum-only, read-only terminal network diagnostics')
