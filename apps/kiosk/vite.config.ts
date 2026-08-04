import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'

/**
 * 生产构建门禁：禁止把 mock 模式打进生产产物，避免「上线即假数据」。
 * 默认 VITE_API_MODE=mock 会渲染 src/data/*.ts 等静态假数据（招聘会/岗位/补贴等），
 * 生产构建必须连真实后端。仅在 production 构建时强制；dev / 非 production 构建不受影响。
 * 详见 docs/progress/project-full-audit-and-august-launch-plan-2026-06-14.md（P0）。
 */
function assertProdApiMode(command: string, mode: string, env: Record<string, string>) {
  if (command !== 'build' || mode !== 'production') return
  const apiMode = (env['VITE_API_MODE'] ?? '').trim()
  if (apiMode !== 'http') {
    throw new Error(
      `[kiosk] 生产构建被拒绝：VITE_API_MODE 必须为 "http"（当前 "${apiMode || '未设置'}"）。` +
        `默认 mock 会把静态假数据打进产物，造成上线即假数据。` +
        `请用 VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/kiosk build。`,
    )
  }
  if (!(env['VITE_API_BASE_URL'] ?? '').trim()) {
    console.warn('[kiosk] 生产构建未设置 VITE_API_BASE_URL，将回落默认 /api/v1。如生产 API 非同源请显式配置。')
  }
}

function assertProdAssistantTrtcMode(command: string, mode: string, env: Record<string, string>) {
  if (command !== 'build' || mode !== 'production') return
  if ((env['VITE_ALLOW_TEXT_ONLY_ASSISTANT'] ?? '').trim() === 'true') {
    console.warn(
      '[kiosk] 生产构建显式允许 AI 助手纯文字模式：VITE_ALLOW_TEXT_ONLY_ASSISTANT=true。' +
        '已跳过数字人强制校验；数字人是否启用以 VITE_USE_TRTC_CALL 为准。',
    )
    return
  }
  const useTrtcCall = (env['VITE_USE_TRTC_CALL'] ?? '').trim()
  if (useTrtcCall !== 'true') {
    throw new Error(
      `[kiosk] 生产构建被拒绝：VITE_USE_TRTC_CALL 必须为 "true"（当前 "${useTrtcCall || '未设置'}"）。` +
        `缺失该变量会让 /assistant 不启用数字人通话入口，线上静默回落为文字助手。` +
        `如本次确认为纯文字助手部署，请显式设置 VITE_ALLOW_TEXT_ONLY_ASSISTANT=true。`,
    )
  }
}

/**
 * 生产构建门禁：禁止把构建机本地 VITE_TERMINAL_ID 打进产物。
 * 多主机共享 Kiosk 的终端 ID 必须由运行期向本机 Agent
 * (http://127.0.0.1:9527/local/terminal-identity) 动态获取，
 * 不允许在构建期写死。本地 .env.local 可保留 VITE_TERMINAL_ID 用于 dev 调试，
 * 生产构建时此函数会将其清空并打警告，不影响 dev server。
 */
function warnAndClearProdTerminalId(command: string, mode: string, env: Record<string, string>) {
  if (command !== 'build' || mode !== 'production') return
  if ((env['VITE_TERMINAL_ID'] ?? '').trim()) {
    console.warn(
      `[kiosk] ⚠️  生产构建检测到 VITE_TERMINAL_ID="${env['VITE_TERMINAL_ID']}"（来自 .env.local 或 CI 环境），` +
        `已强制清空，产物不会包含硬编码终端 ID。` +
        `多主机共享 Kiosk 的终端身份由运行期 Agent 动态提供。`,
    )
  }
}

function warnAssistantTrtcDevMode(command: string, env: Record<string, string>) {
  if (command !== 'serve') return
  const allowTextOnly = (env['VITE_ALLOW_TEXT_ONLY_ASSISTANT'] ?? '').trim() === 'true'
  const useTrtcCall = (env['VITE_USE_TRTC_CALL'] ?? '').trim() === 'true'
  if (!allowTextOnly && !useTrtcCall) {
    console.warn(
      '[kiosk] AI 助手数字人未启用：当前 dev 会进入文字助手。' +
        '联调数字人请使用 pnpm --filter @ai-job-print/kiosk dev:trtc，' +
        '或设置 VITE_USE_TRTC_CALL=true。',
    )
  }
}

function resolveApiProxyTarget(env: Record<string, string>): string {
  const baseUrl = env['VITE_API_BASE_URL']
  if (env['VITE_API_PROXY_TARGET']) return env['VITE_API_PROXY_TARGET']
  if (baseUrl) return baseUrl.replace(/\/api\/v1\/?$/, '')
  return 'http://localhost:3010'
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  assertProdApiMode(command, mode, env)
  assertProdAssistantTrtcMode(command, mode, env)
  warnAssistantTrtcDevMode(command, env)
  warnAndClearProdTerminalId(command, mode, env)
  return {
    plugins: [react(), tailwindcss()],
    // 生产构建强制清空 VITE_TERMINAL_ID，防止构建机 .env.local 污染多主机共享 bundle。
    // 运行期终端 ID 由 Agent 127.0.0.1:9527/local/terminal-identity 动态提供。
    ...(command === 'build' && mode === 'production'
      ? { define: { 'import.meta.env.VITE_TERMINAL_ID': JSON.stringify('') } }
      : {}),
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: resolveApiProxyTarget(env),
          changeOrigin: true,
        },
      },
    },
  }
})
