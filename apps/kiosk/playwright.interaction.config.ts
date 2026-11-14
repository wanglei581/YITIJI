import { isAbsolute, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

/**
 * 交互走查专用配置。不启动 preview、不 mock API。
 *
 * 运行（在 apps/kiosk 下）：
 *   node node_modules/@playwright/test/cli.js test tests/interaction/ai-resume-journey.spec.ts --config playwright.interaction.config.ts
 *
 * 依赖主持人已起好的：
 *   - 一体机前台 http://127.0.0.1:5273
 *   - 本地 API http://127.0.0.1:3010/api/v1
 */
const proxyBypass = new Set(
  [process.env.NO_PROXY, process.env.no_proxy, '127.0.0.1', 'localhost']
    .flatMap((value) => value?.split(',') ?? [])
    .map((value) => value.trim())
    .filter(Boolean),
)
const mergedProxyBypass = [...proxyBypass].join(',')
process.env.NO_PROXY = mergedProxyBypass
process.env.no_proxy = mergedProxyBypass

const kioskOrigin = process.env.INTERACTION_KIOSK_ORIGIN ?? 'http://127.0.0.1:5273'
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const evidenceFromEnv = process.env.INTERACTION_EVIDENCE_DIR
const evidenceDir = evidenceFromEnv
  ? (isAbsolute(evidenceFromEnv) ? evidenceFromEnv : resolve(repoRoot, evidenceFromEnv))
  : join(repoRoot, 'test-results/kiosk-interaction/evidence/ai-resume')

export default defineConfig({
  globalSetup: './tests/interaction/global-setup.ts',
  testDir: './tests/interaction',
  testMatch: /.*\.spec\.ts$/,
  outputDir: '../../test-results/kiosk-interaction',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 240_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['json', { outputFile: join(evidenceDir, 'playwright-results.json') }],
  ],
  use: {
    baseURL: kioskOrigin,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    colorScheme: 'light',
    viewport: { width: 1080, height: 1920 },
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
    screenshot: 'off',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
  },
  projects: [
    { name: 'kiosk-interaction-1080x1920' },
  ],
})
