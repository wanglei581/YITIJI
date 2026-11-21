/**
 * 出站遮盖门禁的共用夹具。不是单独的门禁入口。
 * 跨服务截断在 verify-mask-before-truncate.ts，排版截断在 verify-layout-mask-truncate.ts。
 */
import type { LlmConfigService } from '../src/ai/llm/llm-config.service'

export const ID = '110101199003077777'
export const PREFIX = '1101011990'
const PLACEHOLDER = '[身份证_'

let passCount = 0
export function pass(message: string): void {
  passCount += 1
  console.log(`  PASS ${message}`)
}
export function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  throw new Error(message)
}
export function passed(): number {
  return passCount
}

export const captured: string[] = []
export const realFetch = global.fetch

export function installFakeLlm(): void {
  captured.length = 0
  global.fetch = (async (_url: string, init?: { body?: string }) => {
    captured.push(init?.body ?? '')
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '{}' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    }
  }) as unknown as typeof fetch
}

export function cross(limit: number): string {
  return `${'乙'.repeat(limit - 10)}${ID}`
}

export function assertClean(label: string, text: string): void {
  if (text.includes(ID)) fail(`${label} 出站或落库含整号`)
  if (text.includes(PREFIX)) fail(`${label} 出站或落库含证件号前 10 位`)
  if (!text.includes(PLACEHOLDER)) fail(`${label} 没有遮盖占位符，跨边界号可能没进窗口`)
  pass(label)
}

export const llmConfig = {
  getApiKey: () => 'test-key',
  getConfig: () => ({
    enabled: true,
    baseURL: 'https://llm.invalid/v1',
    model: 'stub-model',
    vendor: 'openai',
    temperature: 0.2,
    forbiddenWords: [] as string[],
  }),
  isReady: () => true,
} as unknown as LlmConfigService

export async function outbound(label: string, run: () => Promise<unknown>): Promise<void> {
  installFakeLlm()
  try {
    await run()
  } catch {
    // 假模型回的是空 JSON。断言只看已经发出去的正文。
  }
  if (captured.length === 0) fail(`${label} 没有出站`)
  for (const body of captured) assertClean(`${label}#${captured.indexOf(body) + 1}`, body)
}

export function statusOf(error: unknown): number {
  if (!error || typeof error !== 'object' || !('getStatus' in error)) return 0
  const getStatus = (error as { getStatus?: () => number }).getStatus
  return typeof getStatus === 'function' ? getStatus.call(error) : 0
}

export function codeOf(error: unknown): string {
  if (!error || typeof error !== 'object' || !('getResponse' in error)) return ''
  const getResponse = (error as { getResponse?: () => unknown }).getResponse
  if (typeof getResponse !== 'function') return ''
  const body = getResponse.call(error) as { error?: { code?: string } }
  return typeof body?.error?.code === 'string' ? body.error.code : ''
}
