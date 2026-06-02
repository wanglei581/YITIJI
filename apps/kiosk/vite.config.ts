import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'

function resolveApiProxyTarget(mode: string): string {
  const env = loadEnv(mode, process.cwd(), '')
  const baseUrl = env['VITE_API_BASE_URL']
  if (env['VITE_API_PROXY_TARGET']) return env['VITE_API_PROXY_TARGET']
  if (baseUrl) return baseUrl.replace(/\/api\/v1\/?$/, '')
  return 'http://localhost:3010'
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
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
        target: resolveApiProxyTarget(mode),
        changeOrigin: true,
      },
    },
  },
}))
