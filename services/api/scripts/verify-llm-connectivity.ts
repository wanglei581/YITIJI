/**
 * LLM upstream connectivity smoke check.
 *
 * This script is intentionally read-only:
 * - loads the existing feature-level LLM config via LlmConfigService
 * - sends a minimal OpenAI-compatible chat completion request
 * - never prints API keys, encrypted keys, prompts, response bodies, or user data
 *
 * Usage:
 *   pnpm --filter @ai-job-print/api verify:llm-connectivity
 *   pnpm --filter @ai-job-print/api verify:llm-connectivity -- --feature=resume_diagnosis
 *   pnpm --filter @ai-job-print/api verify:llm-connectivity -- --features=resume_diagnosis,resume_optimize
 *   pnpm --filter @ai-job-print/api verify:llm-connectivity -- --all
 */
import 'dotenv/config'
import 'reflect-metadata'
import {
  AI_MODEL_FEATURES,
  LlmConfigService,
  type AiModelFeatureKey,
  type LlmConfig,
} from '../src/ai/llm/llm-config.service'

const DEFAULT_FEATURES: AiModelFeatureKey[] = ['resume_diagnosis', 'resume_optimize']
const DEFAULT_TIMEOUT_MS = 10_000
const MAX_TIMEOUT_MS = 60_000

type CheckStatus = 'PASS' | 'FAIL'

interface ConnectivityResult {
  feature: string
  vendor: string
  model: string
  origin: string
  status: CheckStatus
  error?: string
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>
}

function timeoutMs(): number {
  const raw = Number(process.env['LLM_CONNECTIVITY_TIMEOUT_MS'])
  if (!Number.isFinite(raw) || raw < 1_000) return DEFAULT_TIMEOUT_MS
  return Math.min(Math.floor(raw), MAX_TIMEOUT_MS)
}

function activeFeatureKeys(): AiModelFeatureKey[] {
  return AI_MODEL_FEATURES
    .filter((feature) => feature.status === 'active')
    .map((feature) => feature.key)
}

function parseArgs(argv: string[]): string[] {
  const targets: string[] = []
  for (const arg of argv) {
    if (arg === '--') continue
    if (arg === '--all') return activeFeatureKeys()
    if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exitCode = 0
      return []
    }
    if (arg.startsWith('--feature=')) {
      targets.push(arg.slice('--feature='.length))
      continue
    }
    if (arg.startsWith('--features=')) {
      targets.push(...arg.slice('--features='.length).split(','))
      continue
    }
    if (!arg.startsWith('-')) targets.push(arg)
    else {
      console.error('  FAIL feature=args vendor=unknown model=unknown origin=unknown error=UNKNOWN_ARGUMENT')
      process.exitCode = 1
      return []
    }
  }

  const normalized = targets
    .map((target) => target.trim())
    .filter((target) => target.length > 0)
  return normalized.length > 0 ? [...new Set(normalized)] : DEFAULT_FEATURES
}

function printUsage(): void {
  console.log([
    'Usage:',
    '  pnpm --filter @ai-job-print/api verify:llm-connectivity',
    '  pnpm --filter @ai-job-print/api verify:llm-connectivity -- --feature=resume_diagnosis',
    '  pnpm --filter @ai-job-print/api verify:llm-connectivity -- --features=resume_diagnosis,resume_optimize',
    '  pnpm --filter @ai-job-print/api verify:llm-connectivity -- --all',
    '',
    `Default features: ${DEFAULT_FEATURES.join(', ')}`,
    `Timeout: LLM_CONNECTIVITY_TIMEOUT_MS, default ${DEFAULT_TIMEOUT_MS}ms, max ${MAX_TIMEOUT_MS}ms`,
  ].join('\n'))
}

function safeOrigin(baseURL: string): string {
  try {
    return new URL(baseURL).origin
  } catch {
    return 'invalid-url'
  }
}

function completionUrl(cfg: LlmConfig): string | null {
  try {
    const url = new URL(cfg.baseURL)
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/chat/completions`
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function baseResult(feature: string, cfg?: LlmConfig): ConnectivityResult {
  return {
    feature,
    vendor: cfg?.vendor ?? 'unknown',
    model: cfg?.model ?? 'unknown',
    origin: cfg ? safeOrigin(cfg.baseURL) : 'unknown',
    status: 'FAIL',
  }
}

function maskSensitive(message: string, apiKey: string): string {
  return message
    .replaceAll(apiKey, '[REDACTED]')
    .replace(/Bearer\s+[^\s,)]+/gi, 'Bearer [REDACTED]')
    .slice(0, 160)
}

function classifyError(error: unknown, apiKey: string, ms: number): string {
  if (error instanceof Error && error.name === 'AbortError') return `TIMEOUT_${ms}MS`
  if (error instanceof Error) {
    const message = maskSensitive(error.message, apiKey)
    return message ? `NETWORK_ERROR_${error.name}: ${message}` : `NETWORK_ERROR_${error.name}`
  }
  return 'NETWORK_ERROR_UNKNOWN'
}

async function checkFeature(rawFeature: string, service: LlmConfigService, ms: number): Promise<ConnectivityResult> {
  let feature: AiModelFeatureKey
  try {
    feature = service.assertValidFeatureKey(rawFeature)
  } catch {
    return { ...baseResult(rawFeature), error: 'INVALID_FEATURE_KEY' }
  }

  const cfg = service.getConfig(feature)
  const view = service.getView(feature)
  const result = baseResult(feature, cfg)

  if (!cfg.enabled) return { ...result, error: 'FEATURE_DISABLED' }
  if (!view.apiKeyConfigured) return { ...result, error: 'API_KEY_MISSING' }

  const apiKey = service.getApiKey(feature)
  if (!apiKey) return { ...result, error: 'API_KEY_UNAVAILABLE_OR_DECRYPT_FAILED' }

  const url = completionUrl(cfg)
  if (!url) return { ...result, error: 'INVALID_BASE_URL' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 5,
        temperature: 0,
        stream: false,
      }),
    })

    if (!response.ok) {
      return { ...result, error: `HTTP_ERROR_${response.status}` }
    }

    const data = (await response.json().catch(() => null)) as ChatCompletionResponse | null
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.trim().length === 0) {
      return { ...result, error: 'EMPTY_OR_INVALID_RESPONSE' }
    }
    return { ...result, status: 'PASS' }
  } catch (error) {
    return { ...result, error: classifyError(error, apiKey, ms) }
  } finally {
    clearTimeout(timer)
  }
}

function printResult(result: ConnectivityResult): void {
  const prefix = result.status === 'PASS' ? 'PASS' : 'FAIL'
  const line = [
    prefix,
    `feature=${result.feature}`,
    `vendor=${result.vendor}`,
    `model=${result.model}`,
    `origin=${result.origin}`,
    result.error ? `error=${result.error}` : '',
  ].filter(Boolean).join(' ')
  if (result.status === 'PASS') console.log(`  ${line}`)
  else console.error(`  ${line}`)
}

async function main(): Promise<void> {
  const features = parseArgs(process.argv.slice(2))
  if (features.length === 0) return

  console.log('\n=== LLM 连通性只读校验 ===')
  console.log(`  timeoutMs=${timeoutMs()}`)

  let service: LlmConfigService
  try {
    service = new LlmConfigService()
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 160) : 'unknown'
    console.error(`  FAIL feature=config vendor=unknown model=unknown origin=unknown error=CONFIG_LOAD_FAILED: ${message}`)
    process.exitCode = 1
    return
  }

  const results = await Promise.all(features.map((feature) => checkFeature(feature, service, timeoutMs())))
  for (const result of results) printResult(result)

  if (results.some((result) => result.status === 'FAIL')) {
    process.exitCode = 1
    return
  }

  console.log('\n=== ALL PASS ===')
}

main().catch(() => {
  console.error('  FAIL feature=runtime vendor=unknown model=unknown origin=unknown error=UNHANDLED_RUNTIME_ERROR')
  process.exitCode = 1
})
