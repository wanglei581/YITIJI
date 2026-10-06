import { defineConfig } from '@playwright/test'

// C2-16 手机接力。预览端口 4549，不占用 4541 / 4545 / 4547。
const previewPort = 4549
const previewOrigin = `http://127.0.0.1:${previewPort}`

const proxyBypass = new Set(
  [process.env.NO_PROXY, process.env.no_proxy, '127.0.0.1', 'localhost']
    .flatMap((value) => value?.split(',') ?? [])
    .map((value) => value.trim())
    .filter(Boolean),
)
const mergedProxyBypass = [...proxyBypass].join(',')
process.env.NO_PROXY = mergedProxyBypass
process.env.no_proxy = mergedProxyBypass

const refuseBusyPort = `node -e "const net=require('net');const s=net.createServer();s.once('error',()=>{console.error('port ${previewPort} is already in use; refusing to attach to an existing server');process.exit(1)});s.listen(${previewPort},'127.0.0.1',()=>s.close(()=>process.exit(0)))"`

export default defineConfig({
  testDir: './tests/visual',
  testMatch: /phone-relay-c216\.spec\.ts$/,
  outputDir: '../../test-results/kiosk-phone-relay-c216',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 120_000,
  reporter: 'list',
  use: {
    baseURL: previewOrigin,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    colorScheme: 'light',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    command: `${refuseBusyPort} && VITE_API_MODE=http VITE_E2E_MOCK_TERMINAL_SESSION_TOKEN=playwright-terminal-session-fixture VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true VITE_TERMINAL_ID=KSK-001 VITE_TERMINAL_AGENT_BRIDGE_TOKEN=playwright-local-bridge-token-0123456789abcdef pnpm build && pnpm exec vite preview --host 127.0.0.1 --port ${previewPort} --strictPort`,
    url: previewOrigin,
    reuseExistingServer: false,
    timeout: 300_000,
  },
})
