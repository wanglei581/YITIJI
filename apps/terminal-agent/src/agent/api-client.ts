/**
 * agent/api-client.ts — Phase 8.1B
 *
 * Creates an Axios instance pre-configured for backend API calls:
 *   - Base URL from agent config
 *   - Authorization: Bearer <agentToken>
 *   - X-Terminal-Id header
 *   - 30s timeout
 *   - 5xx / network errors retried up to 3 times (2s / 4s / 6s back-off)
 *   - 4xx are NOT retried (auth / validation errors need operator attention)
 *
 * Security contract:
 *   - agentToken must NEVER appear in logs. This module only passes it in headers.
 *   - Callers must not log full request/response objects.
 */

import http from 'http'
import https from 'https'
import axios, { AxiosInstance, AxiosError, AxiosRequestConfig } from 'axios'
import { warn } from '../logger'

export function createDirectHttpAgents(): Pick<AxiosRequestConfig, 'httpAgent' | 'httpsAgent'> {
  return {
    httpAgent: new http.Agent({ keepAlive: false }),
    httpsAgent: new https.Agent({ keepAlive: false }),
  }
}

/**
 * Create an authenticated Axios instance.
 *
 * @param baseURL    e.g. "http://localhost:3000/api/v1"
 * @param agentToken Bearer token. May be undefined before registration.
 * @param terminalId Terminal ID for X-Terminal-Id header. May be undefined before registration.
 */
export function createApiClient(
  baseURL: string,
  agentToken?: string,
  terminalId?: string,
): AxiosInstance {
  const headers: Record<string, string> = {}
  if (agentToken) headers['Authorization'] = `Bearer ${agentToken}`
  if (terminalId) headers['X-Terminal-Id'] = terminalId

  const instance = axios.create({
    baseURL,
    timeout: 30_000,
    // Disable axios proxy auto-detection: agent always connects directly to the
    // backend (LAN or localhost). Without this, axios on Windows picks up the
    // system http_proxy env variable (e.g. Clash / v2ray local proxy at
    // 127.0.0.1:xxxx) and routes all API requests through it, causing timeouts.
    proxy: false,
    // Do not keep sockets alive across requests. This prevents the agent from
    // reusing a stale connection after the local proxy / network route changes.
    ...createDirectHttpAgents(),
    headers: {
      'Content-Type': 'application/json',
      'Connection': 'close',
      ...headers,
    },
  })

  // Response interceptor: retry on 5xx / network errors up to 3 times
  instance.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const config = error.config as (typeof error.config & { _retryCount?: number }) | undefined
      if (!config) return Promise.reject(error)

      const status = error.response?.status
      const isRetryable = !error.response || (typeof status === 'number' && status >= 500)

      config._retryCount = config._retryCount ?? 0
      if (isRetryable && config._retryCount < 3) {
        config._retryCount += 1
        const delayMs = config._retryCount * 2_000
        warn(
          `api-client: retry ${config._retryCount}/3 after ${delayMs}ms` +
            ` (${config.method?.toUpperCase()} ${config.url})`,
        )
        await new Promise((r) => setTimeout(r, delayMs))
        return instance.request(config)
      }

      return Promise.reject(error)
    },
  )

  return instance
}

/**
 * Extract a human-readable error message from an Axios error.
 * Never includes the full response body (may contain sensitive data).
 */
export function axiosErrorMessage(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const status = e.response?.status
    const code = (e.response?.data as { error?: { code?: string } } | undefined)?.error?.code
    const parts = ['HTTP', status ?? 'ERR']
    if (code) parts.push(`[${code}]`)
    parts.push('—', e.message)
    return parts.join(' ')
  }
  return e instanceof Error ? e.message : String(e)
}
