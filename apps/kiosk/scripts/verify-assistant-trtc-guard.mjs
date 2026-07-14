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

const viteConfig = read('vite.config.ts')
const assistantPage = read('src/pages/assistant/AssistantPage.tsx')
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
