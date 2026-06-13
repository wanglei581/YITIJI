import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'

/**
 * 生产构建门禁：禁止把 mock 模式打进生产产物，避免「上线即假数据」。
 * 默认 VITE_API_MODE=mock 会走内存 mock adapter，生产构建必须连真实后端。
 * 仅在 production 构建时强制；dev / 非 production 构建不受影响。
 * 详见 docs/progress/project-full-audit-and-august-launch-plan-2026-06-14.md（P0）。
 */
function assertProdApiMode(command: string, mode: string, env: Record<string, string>) {
  if (command !== 'build' || mode !== 'production') return
  const apiMode = (env['VITE_API_MODE'] ?? '').trim()
  if (apiMode !== 'http') {
    throw new Error(
      `[partner] 生产构建被拒绝：VITE_API_MODE 必须为 "http"（当前 "${apiMode || '未设置'}"）。` +
        `默认 mock 会把内存假数据打进产物，造成上线即假数据。` +
        `请用 VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/partner build。`,
    )
  }
  if (!(env['VITE_API_BASE_URL'] ?? '').trim()) {
    console.warn('[partner] 生产构建未设置 VITE_API_BASE_URL，将回落默认 /api/v1。如生产 API 非同源请显式配置。')
  }
}

export default defineConfig(({ command, mode }) => {
  assertProdApiMode(command, mode, loadEnv(mode, process.cwd(), ''))
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 5175,
      strictPort: true,
    },
  }
})
