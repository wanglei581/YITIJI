import { defineConfig } from '@playwright/test'

// 按需并排截图，不进 CI。端口 4217：4177–4193 被本仓别的套件占用。
// 启动前若端口已被占用，直接失败，绝不 reuseExistingServer。
process.env.QX_PAIRS = '1'

const proxyBypass = new Set(
  [process.env.NO_PROXY, process.env.no_proxy, '127.0.0.1', 'localhost']
    .flatMap((value) => value?.split(',') ?? [])
    .map((value) => value.trim())
    .filter(Boolean),
)
const mergedProxyBypass = [...proxyBypass].join(',')
process.env.NO_PROXY = mergedProxyBypass
process.env.no_proxy = mergedProxyBypass

const refuseBusyPort = `node -e "const net=require('net');const s=net.createServer();s.once('error',()=>{console.error('port 4217 is already in use; refusing to attach to an existing server');process.exit(1)});s.listen(4217,'127.0.0.1',()=>s.close(()=>process.exit(0)))"`

export default defineConfig({
  testDir: './tests/visual',
  testMatch: /qingxu-pairs\.spec\.ts$/,
  outputDir: '../../test-results/qingxu-pairs-playwright',
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1,
  timeout: 4_200_000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4217',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    colorScheme: 'light',
    viewport: { width: 1080, height: 1920 },
    deviceScaleFactor: 1,
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: `${refuseBusyPort} && VITE_API_MODE=http VITE_E2E_MOCK_TERMINAL_SESSION_TOKEN=playwright-terminal-session-fixture VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true VITE_TERMINAL_ID=KSK-001 VITE_TERMINAL_AGENT_BRIDGE_TOKEN=playwright-local-bridge-token-0123456789abcdef pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 4217 --strictPort`,
    url: 'http://127.0.0.1:4217',
    reuseExistingServer: false,
    timeout: 300_000,
  },
})
