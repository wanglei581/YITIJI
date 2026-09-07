/**
 * GET /kiosk/ai/capabilities 守门。
 *
 * 1. 15 个 AiModelFeatureKey 全覆盖
 * 2. 响应 JSON 不含 secret / apiKey 字样
 * 3. 源码不解密密钥、不发出站请求
 * 4. 匿名 HTTP 可达，形状为 { success, data: { items } }
 *
 * 不连数据库、不调用计费 AI。
 * 运行：pnpm --filter @ai-job-print/api verify:kiosk-ai-capabilities
 */
import 'reflect-metadata'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Module, type INestApplication } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { AI_MODEL_FEATURES, LlmConfigService } from '../src/ai/llm/llm-config.service'
import {
  listKioskAiCapabilities,
  type KioskAiCapabilitiesResponse,
} from '../src/ai/kiosk-ai-capabilities'
import { KioskAiCapabilitiesController } from '../src/ai/kiosk-ai-capabilities.controller'

process.env['SECRET_ENCRYPTION_KEY'] ||= 'verify-kiosk-ai-caps-secret-encryption-key-32'
const DATA_DIR = mkdtempSync(join(tmpdir(), 'vkac-data-'))
process.env['FILE_STORAGE_DIR'] = DATA_DIR
delete process.env['AI_LLM_API_KEY']
delete process.env['TRTC_LLM_API_KEY']

const EXPECTED_KEYS = AI_MODEL_FEATURES.map((feature) => feature.key)
const SRC_DIR = join(__dirname, '../src/ai')
const LEAK_RE = /secret|apikey/i
const ALLOWED_STATUS = new Set(['available', 'degraded', 'off'])

function pass(message: string): void {
  console.log(`  PASS ${message}`)
}

function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  rmSync(DATA_DIR, { recursive: true, force: true })
  process.exit(1)
}

function assertNoLeak(label: string, value: unknown): void {
  const text = JSON.stringify(value)
  if (LEAK_RE.test(text)) fail(`${label} 响应含 secret/apiKey 字样：${text.slice(0, 240)}`)
  pass(`${label} 不含 secret/apiKey`)
}

function assertItems(label: string, items: KioskAiCapabilitiesResponse['items']): void {
  if (items.length !== EXPECTED_KEYS.length) {
    fail(`${label} items 数量 ${items.length}，期望 ${EXPECTED_KEYS.length}`)
  }
  const keys = items.map((item) => item.key)
  const missing = EXPECTED_KEYS.filter((key) => !keys.includes(key))
  const extra = keys.filter((key) => !EXPECTED_KEYS.includes(key as typeof EXPECTED_KEYS[number]))
  if (missing.length || extra.length) {
    fail(`${label} key 集合不对 missing=${missing.join(',')} extra=${extra.join(',')}`)
  }
  for (const item of items) {
    if (!ALLOWED_STATUS.has(item.status)) fail(`${label} 非法 status=${item.status} key=${item.key}`)
  }
  pass(`${label} 覆盖 ${EXPECTED_KEYS.length} 个能力 key`)
}

function sourceMustNotCallSecrets(): void {
  for (const file of ['kiosk-ai-capabilities.ts', 'kiosk-ai-capabilities.controller.ts']) {
    const src = readFileSync(join(SRC_DIR, file), 'utf8')
    if (/\bgetApiKey\b/.test(src)) fail(`${file} 调用了 getApiKey`)
    if (/\bfetch\s*\(/.test(src) || /\baxios\b/.test(src)) fail(`${file} 发出站请求`)
  }
  pass('源码不解密 apiKey、不发出站请求')
}

@Module({
  controllers: [KioskAiCapabilitiesController],
  providers: [LlmConfigService],
})
class CapabilitiesModule {}

async function withApp(run: (app: INestApplication, base: string) => Promise<void>): Promise<void> {
  const app = await NestFactory.create(CapabilitiesModule, { logger: false })
  app.setGlobalPrefix('api/v1')
  await app.listen(0, '127.0.0.1')
  const address = app.getHttpServer().address()
  if (!address || typeof address === 'string') {
    await app.close()
    fail('无法取得监听地址')
  }
  const base = `http://127.0.0.1:${address.port}`
  try {
    await run(app, base)
  } finally {
    await app.close()
  }
}

async function main(): Promise<void> {
  console.log('\n=== Kiosk AI capabilities ===')
  try {
    sourceMustNotCallSecrets()

    process.env['AI_PROVIDER'] = 'mock'
    const svc = new LlmConfigService()
    const listed = listKioskAiCapabilities(svc)
    assertItems('list()', listed.items)
    assertNoLeak('list()', listed)
    const planned = listed.items.filter((item) =>
      AI_MODEL_FEATURES.some((meta) => meta.key === item.key && meta.status === 'planned'),
    )
    if (!planned.every((item) => item.status === 'off')) {
      fail(`planned 功能必须为 off：${JSON.stringify(planned)}`)
    }
    pass('planned 功能为 off')

    const chatOff = listed.items.find((item) => item.key === 'assistant_chat')
    if (!chatOff || chatOff.status !== 'off') {
      fail(`无密钥时 assistant_chat 应为 off，实际 ${JSON.stringify(chatOff)}`)
    }
    pass('无密钥时 LLM 能力为 off')

    svc.update({ enabled: true }, 'print_param_prefill')
    const prefillOn = listKioskAiCapabilities(svc).items.find((item) => item.key === 'print_param_prefill')
    if (!prefillOn || prefillOn.status !== 'available') {
      fail(`print_param_prefill 仅 enabled 即 available，实际 ${JSON.stringify(prefillOn)}`)
    }
    pass('print_param_prefill 不依赖模型密钥')

    const testKey = 'sk-verify-kiosk-caps-not-a-real-key'
    svc.update({ enabled: true, apiKey: testKey }, 'assistant_chat')
    process.env['AI_PROVIDER'] = 'mock'
    const mockListed = listKioskAiCapabilities(svc)
    if (JSON.stringify(mockListed).includes(testKey)) {
      fail('list() 回带了 apiKey 明文')
    }
    const mockChat = mockListed.items.find((item) => item.key === 'assistant_chat')
    if (!mockChat || mockChat.status !== 'degraded' || mockChat.providerName !== 'deepseek') {
      fail(`mock + 已配置应为 degraded，实际 ${JSON.stringify(mockChat)}`)
    }
    pass('mock 提供商为 degraded')

    process.env['AI_PROVIDER'] = 'llm'
    const liveChat = listKioskAiCapabilities(svc).items.find((item) => item.key === 'assistant_chat')
    if (!liveChat || liveChat.status !== 'available' || liveChat.providerName !== 'deepseek') {
      fail(`llm + 已配置应为 available，实际 ${JSON.stringify(liveChat)}`)
    }
    pass('llm 提供商为 available')

    process.env['AI_PROVIDER'] = 'mock'

    await withApp(async (_app, base) => {
      const res = await fetch(`${base}/api/v1/kiosk/ai/capabilities`)
      if (res.status !== 200) fail(`HTTP ${res.status}，期望 200`)
      const body = await res.json() as { success?: boolean; data?: KioskAiCapabilitiesResponse }
      if (body.success !== true || !body.data?.items) {
        fail(`响应形状不对：${JSON.stringify(body).slice(0, 240)}`)
      }
      assertItems('HTTP', body.data.items)
      assertNoLeak('HTTP', body)
      pass('匿名 GET /api/v1/kiosk/ai/capabilities 200')
    })

    console.log('\n=== ALL PASS ===')
  } finally {
    rmSync(DATA_DIR, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error))
})
