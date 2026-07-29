import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(join(ROOT, relativePath), 'utf8')

const identity = read('src/services/api/screensaver.ts')
const main = read('src/main.tsx')
const advisorCall = read('src/hooks/useAiAdvisorCallSession.ts')
const shell = read('src/layouts/KioskRoot.tsx')
const topbar = read('src/components/kiosk-shell/KioskAppTopbar.tsx')
const terminalScopedConsumers = [
  'src/services/print/printJobsApi.ts',
  'src/services/api/printScanCapabilities.ts',
  'src/hooks/useAiAdvisorCallSession.ts',
  'src/pages/home/hooks/useHomeDeviceStatus.ts',
].map((path) => [path, read(path)])

assert.match(identity, /\/local\/terminal-identity/, 'Kiosk must read identity from the local Agent')
assert.match(identity, /cache:\s*'no-store'/, 'identity reads must bypass browser caches')
assert.match(identity, /IDENTITY_TIMEOUT_MS/, 'identity bootstrap must have a bounded timeout')
assert.match(identity, /startTerminalIdentityRecovery/, 'identity must recover when the Agent starts after the browser')
assert.match(identity, /IDENTITY_RETRY_DELAY_MS/, 'identity recovery must use a bounded retry delay')
assert.match(identity, /IDENTITY_MONITOR_DELAY_MS/, 'identity recovery must monitor for an explicit terminal rebind')
assert.match(identity, /subscribeTerminalIdentity/, 'identity recovery must notify the rendered Kiosk')
assert.match(identity, /envelope\.success\s*&&\s*validIdentity/, 'identity response must be shape-validated')
assert.match(identity, /if\s*\(import\.meta\.env\.DEV\)/, 'build-time fallback must be limited to Vite development')
assert.doesNotMatch(identity, /import\.meta\.env\.PROD[\s\S]*VITE_TERMINAL_ID/, 'production must not fallback to a build-time terminal ID')

assert.match(main, /initializeTerminalIdentity/, 'terminal identity must initialize before Kiosk render')
assert.match(main, /initializeTerminalIdentity\(\)\.finally\(renderKiosk\)/, 'Kiosk render must wait for identity resolution')
assert.match(main, /subscribeTerminalIdentity/, 'rendered Kiosk must subscribe to recovered identity')
assert.match(main, /key=\{identityRevision\}/, 'identity recovery must remount terminal-scoped consumers')
assert.doesNotMatch(shell, /\|\|\s*'01号机'/, 'shell must not display a fake terminal code when identity is unavailable')
assert.doesNotMatch(topbar, /\|\|\s*'01号机'/, 'topbar must not display a fake terminal code when identity is unavailable')
assert.match(advisorCall, /taskTerminalIdRef/, 'TRTC cleanup must retain the identity that created the task')
assert.match(advisorCall, /stopBackendTask\(taskIdRef\.current, taskTerminalIdRef\.current\)/)

for (const [path, source] of terminalScopedConsumers) {
  assert.match(source, /getTerminalId/, `${path} must use the runtime terminal identity getter`)
  assert.doesNotMatch(source, /VITE_TERMINAL_ID/, `${path} must not read a build-time terminal ID directly`)
}

console.log('verify-runtime-terminal-identity: ok')
