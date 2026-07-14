import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

let failed = 0

function pass(message) {
  console.log(`PASS ${message}`)
}

function fail(message) {
  console.error(`FAIL ${message}`)
  failed += 1
}

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function expectIncludes(source, token, message) {
  if (source.includes(token)) pass(message)
  else fail(`${message} — missing ${token}`)
}

function expectMatches(source, pattern, message) {
  if (pattern.test(source)) pass(message)
  else fail(`${message} — missing ${pattern}`)
}

function expectNotMatches(source, pattern, message) {
  if (!pattern.test(source)) pass(message)
  else fail(`${message} — unexpected ${pattern}`)
}

const viteConfig = read('vite.config.ts')
const assistantPage = read('src/pages/assistant/AssistantPage.tsx')
const callPanel = read('src/pages/assistant/AssistantCallPanel.tsx')
const callHook = read('src/hooks/useAiAdvisorCallSession.ts')
const callStyles = [
  'src/pages/assistant/assistant-lightflow-call.css',
  'src/pages/assistant/assistant-lightflow-call-shell.css',
  'src/pages/assistant/assistant-lightflow-call-gate.css',
  'src/pages/assistant/assistant-lightflow-call-live.css',
  'src/pages/assistant/assistant-lightflow-call-responsive.css',
].map(read).join('\n')
const envTypes = read('src/vite-env.d.ts')
const envExample = read('.env.example')
const kioskPkg = JSON.parse(read('package.json'))

expectIncludes(viteConfig, 'assertProdAssistantTrtcMode', 'production build has assistant TRTC guard')
expectIncludes(viteConfig, 'VITE_USE_TRTC_CALL', 'guard checks the TRTC build flag')
expectMatches(
  viteConfig,
  /VITE_USE_TRTC_CALL[^`'"]+必须为 "true"|必须为 "true"[^`'"]+VITE_USE_TRTC_CALL/s,
  'guard rejects production builds without VITE_USE_TRTC_CALL=true',
)
expectIncludes(
  viteConfig,
  'VITE_ALLOW_TEXT_ONLY_ASSISTANT',
  'guard requires an explicit escape hatch for text-only builds',
)
expectIncludes(
  viteConfig,
  'pnpm --filter @ai-job-print/kiosk dev:trtc',
  'dev server warns with the TRTC startup command when voice mode is disabled',
)
expectIncludes(
  envTypes,
  'VITE_ALLOW_TEXT_ONLY_ASSISTANT',
  'ImportMetaEnv declares the text-only escape hatch',
)
expectIncludes(
  envExample,
  'VITE_ALLOW_TEXT_ONLY_ASSISTANT',
  '.env.example documents the text-only escape hatch',
)
expectIncludes(
  assistantPage,
  '数字人未启用',
  'assistant page warns in dev when voice mode is not enabled',
)
expectIncludes(
  assistantPage,
  'const LazyCallPanel = USE_VOICE_CALL',
  'assistant page keeps the feature-gated lazy call panel',
)
expectIncludes(
  assistantPage,
  "import('./AssistantCallPanel')",
  'assistant page lazy-loads the call panel instead of eagerly importing TRTC UI',
)
expectMatches(
  assistantPage,
  /voiceAvailable\s*&&[\s\S]*?className="assistant-tool-button assistant-voice-trigger"/,
  'assistant composer only exposes the voice trigger when the feature gate is enabled',
)
expectMatches(
  assistantPage,
  /voiceAvailable\s*&&\s*callActive\s*&&\s*LazyCallPanel/,
  'assistant only mounts the real call panel after the gated voice action is selected',
)
expectIncludes(callPanel, 'role="dialog"', 'voice consultation uses dialog semantics')
expectIncludes(callPanel, 'aria-modal="true"', 'voice consultation is modal')
expectIncludes(callPanel, '和小青语音咨询', 'voice consultation keeps the 4188 dialog title')
expectMatches(
  callPanel,
  /onClick=\{\(\) => void call\.startCall\(\)\}[\s\S]*?直接语音通话/,
  'real TRTC starts only from the explicit direct-call action',
)
expectNotMatches(
  callPanel,
  /useEffect\(\(\) => \{\s*void call\.startCall\(\)/,
  'opening the choice dialog does not start or bill a TRTC session',
)
expectMatches(
  callPanel,
  /<button[^>]*disabled[\s\S]*?按住说话[\s\S]*?尚未开放/,
  'hold-to-talk remains honestly disabled',
)
expectIncludes(callPanel, 'call.endCall()', 'voice exits use the explicit idempotent end action')
expectIncludes(callHook, 'const endCall = useCallback', 'TRTC hook exposes an explicit end-and-reset action')
expectIncludes(callHook, 'startedRef.current = false', 'ending a call allows a deliberate retry')
expectIncludes(callHook, 'sessionEpochRef', 'in-flight TRTC starts are guarded by a session epoch')
expectIncludes(
  callHook,
  'stopBackendTask(activeTaskId)',
  'stale connecting sessions are stopped when they return late',
)
expectIncludes(
  callHook,
  'taskIdRef.current === activeTaskId',
  'stale sessions do not clear a newer TRTC task id',
)
expectMatches(callHook, /else setAiState\('idle'\)/, 'quiet volume updates return the advisor state to idle')
expectIncludes(callPanel, 'hangupRef.current?.focus()', 'call phase moves focus to the hangup action')
expectIncludes(callStyles, '.assistant-voice-backdrop', 'voice dialog has an isolated overlay')
expectIncludes(callStyles, '@media (max-width: 600px)', 'voice dialog has phone layout rules')
expectIncludes(callStyles, '@media (max-height: 740px)', 'voice dialog has short-screen rules')
expectIncludes(
  callStyles,
  '@media (prefers-reduced-motion: reduce)',
  'voice dialog respects reduced motion',
)

const scripts = kioskPkg.scripts ?? {}
if (scripts['dev:trtc']?.includes('VITE_USE_TRTC_CALL=true')) {
  pass('kiosk package exposes a TRTC dev script')
} else {
  fail('kiosk package exposes a TRTC dev script — missing VITE_USE_TRTC_CALL=true')
}

if (failed > 0) {
  console.error(`\n${failed} assistant TRTC guard check(s) failed`)
  process.exit(1)
}

console.log('\nALL PASS assistant TRTC guard checks')
