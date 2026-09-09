import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(join(ROOT, relativePath), 'utf8')

const identity = read('src/services/api/screensaver.ts')
const main = read('src/main.tsx')
const terminalAuth = read('src/services/terminalAuth.ts')
const advisorCall = read('src/hooks/useAiAdvisorCallSession.ts')
const shell = read('src/layouts/KioskRoot.tsx')
const topbar = read('src/components/kiosk-shell/KioskAppTopbar.tsx')

// 拍板②：只有网络抖动 / 503 TERMINAL_SESSION_RETRYABLE 自动重试；401 TERMINAL_SESSION_INVALID 立即 fail-closed。
const transientBody = terminalAuth.match(/function transient\(error: unknown\): boolean \{([\s\S]*?)\n\}/)?.[1] ?? ''
assert.ok(transientBody, 'terminalAuth must classify retryable errors in transient()')
assert.match(transientBody, /503/, 'transient() must treat 503 TERMINAL_SESSION_RETRYABLE as retryable')
assert.doesNotMatch(transientBody, /401/, 'transient() must not retry 401 TERMINAL_SESSION_INVALID (revoked / used ticket cannot recover by retrying)')
assert.match(terminalAuth, /if \(!sessionInvalid\(error\)\) return response/, 'a business 401 must trigger exactly one session refresh, other errors go back to the caller')
assert.match(terminalAuth, /refreshInflight/, 'concurrent 401s must share one refresh (no thundering herd on /session-token/refresh)')
assert.match(terminalAuth, /initInflight/, 'identity recovery must not re-enter initializeTerminalSession while a boot ticket exchange is in flight')

assert.match(terminalAuth, /import\.meta\.env\['VITE_E2E_MOCK_TERMINAL_SESSION_TOKEN'\]/, 'the E2E mock token must be read from a VITE_-prefixed variable (Vite exposes nothing else to the bundle)')
assert.doesNotMatch(terminalAuth, /import\.meta\.env\['E2E_MOCK_TERMINAL_SESSION_TOKEN'\]/, 'an unprefixed E2E_MOCK_TERMINAL_SESSION_TOKEN is never exposed by Vite, so the mock short-circuit silently never applies')
const deployWorkflow = readFileSync(join(ROOT, '..', '..', '.github', 'workflows', 'deploy.yml'), 'utf8')
assert.doesNotMatch(deployWorkflow, /E2E_MOCK_TERMINAL_SESSION_TOKEN/, 'production deploy builds must never set the E2E mock terminal session token')

assert.match(identity, /export const isTerminalKiosk = \(\): boolean => getTerminalId\(\) !== '' && !IS_E2E_BUILD/, 'kiosk-only UI gating must be off in E2E builds and on whenever a real terminal identity exists')

const terminalScopedConsumers = [
  'src/services/print/printJobsApi.ts',
  'src/services/api/printScanCapabilities.ts',
  'src/hooks/useAiAdvisorCallSession.ts',
  // 首页设备 hook useHomeDeviceStatus 已下线（首页改读 KioskRoot 共享快照）。
  // 仍要守「首页终端相关请求不得读构建期 VITE_TERMINAL_ID」：改钉活着的招聘会高亮 hook。
  'src/pages/home/hooks/useHomeJobFairHighlight.ts',
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
assert.match(main, /initializeTerminalSession/, 'terminal session must initialize before Kiosk render')
assert.match(main, /initializeTerminalIdentity\(\)\.then\(initializeTerminalSession\)\.finally\(renderKiosk\)/, 'Kiosk render must wait for identity and terminal session resolution')
assert.match(main, /subscribeTerminalIdentity/, 'rendered Kiosk must subscribe to recovered identity')
assert.match(main, /subscribeTerminalIdentity\(\(\) => \{[\s\S]{0,160}initializeTerminalSession\(\)/, 'a recovered local Agent identity must retry terminal session initialization')
assert.match(main, /key=\{identityRevision\}/, 'identity recovery must remount terminal-scoped consumers')
assert.doesNotMatch(shell, /\|\|\s*'01号机'/, 'shell must not display a fake terminal code when identity is unavailable')
assert.doesNotMatch(topbar, /\|\|\s*'01号机'/, 'topbar must not display a fake terminal code when identity is unavailable')
assert.match(advisorCall, /taskTerminalIdRef/, 'TRTC cleanup must retain the identity that created the task')
assert.match(advisorCall, /stopBackendTask\(taskIdRef\.current, taskTerminalIdRef\.current\)/)

assert.match(terminalAuth, /sessionStorage\.getItem\(STORAGE_KEY\)/, 'terminal session token must stay in sessionStorage')
assert.match(terminalAuth, /history\.replaceState/, 'boot ticket must be removed from the browser URL')
assert.match(terminalAuth, /const bootTicket = cleanBootTicketFromUrl\(\)/, 'boot ticket must be copied into memory and removed from the URL before retrying exchange')
assert.match(terminalAuth, /RETRY_DELAYS_MS = \[2_000, 5_000, 10_000, 20_000\]/, 'session recovery must use the approved backoff')
assert.match(terminalAuth, /RETRY_WINDOW_MS = 60_000/, 'session recovery must remain within one minute')
assert.match(terminalAuth, /10 \* 60_000/, 'healthy kiosk must refresh its terminal session every ten minutes')
assert.match(terminalAuth, /API_MODE !== 'http'/, 'mock mode must not request terminal tickets')
assert.match(terminalAuth, /x-terminal-session-token/, 'protected Kiosk requests must carry the terminal session token')

for (const [path, source] of terminalScopedConsumers) {
  assert.match(source, /getTerminalId/, `${path} must use the runtime terminal identity getter`)
  assert.doesNotMatch(source, /VITE_TERMINAL_ID/, `${path} must not read a build-time terminal ID directly`)
}

console.log('verify-runtime-terminal-identity: ok')
