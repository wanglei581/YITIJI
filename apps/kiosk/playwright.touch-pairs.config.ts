import { defineConfig } from '@playwright/test'

// 按需并排截图，不进 CI。预览端口由 TOUCH_PAIRS_PORT 指定（不设时为 7471）。
// 触屏稿固定在 7472，不跟预览端口走。端口被占直接失败，绝不 reuseExistingServer。
process.env.TOUCH_PAIRS = '1'

function touchPairsPort(): number {
  const raw = process.env.TOUCH_PAIRS_PORT
  if (raw === undefined) return 7471
  const port = Number(raw)
  if (!/^[0-9]+$/.test(raw) || port < 1024 || port > 65534) {
    throw new Error(`TOUCH_PAIRS_PORT 必须是 1024–65534 的整数，当前是「${raw}」`)
  }
  if (port === 7472) {
    throw new Error('TOUCH_PAIRS_PORT 不能是 7472：这个端口留给触屏稿')
  }
  return port
}

const previewPort = touchPairsPort()
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
  testMatch: /touch-pairs\.spec\.ts$/,
  outputDir: '../../test-results/touch-pairs-playwright',
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1,
  timeout: 1_800_000,
  reporter: 'list',
  use: {
    baseURL: previewOrigin,
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
    // 不设 VITE_E2E_MOCK_TERMINAL_SESSION_TOKEN：那个变量让 isTerminalKiosk() 恒为假，
    // 本机选文件会画出来。一体机身份走 9527 的终端身份和引导票，由 spec 里的路由应答。
    command: `${refuseBusyPort} && VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true VITE_TERMINAL_ID=KSK-001 VITE_TERMINAL_AGENT_BRIDGE_TOKEN=playwright-local-bridge-token-0123456789abcdef npx vite build && npx vite preview --host 127.0.0.1 --port ${previewPort} --strictPort`,
    url: previewOrigin,
    reuseExistingServer: false,
    timeout: 300_000,
  },
})
