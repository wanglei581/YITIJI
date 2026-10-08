import { useCallback, useEffect, useState } from 'react'
import { API_BASE_URL } from '../../services/api/client'
import { terminalAttributedFetch } from '../../services/terminalAuth'
import {
  platformAiUnavailable,
  type HubAiFeatureStatus,
} from './serviceHubModel'

/**
 * 后端已经可达时，再读现有的 GET /kiosk/ai/capabilities。
 * 探测在服务中心经现有终端身份封装发出，不新造接口。
 *
 * `enabled === false`（/health 还在确认或已经断开）时不发这条请求：
 * 整站不通仍走原来的 apiDown，不把「读不到能力清单」误当成「只有 AI 挂了」。
 */

const AI_CAPABILITY_TIMEOUT_MS = 4_000

export interface HubAiProbe {
  aiDown: boolean
  aiChecking: boolean
  features: ReadonlyMap<string, HubAiFeatureStatus>
  retry: () => void
}

interface ProbeState {
  phase: 'idle' | 'checking' | 'ready' | 'down'
  features: ReadonlyMap<string, HubAiFeatureStatus>
}

const IDLE: ProbeState = { phase: 'idle', features: new Map() }

function readItems(body: unknown): Array<{ key: string; status: string }> | null {
  if (!body || typeof body !== 'object') return null
  const record = body as { data?: { items?: unknown }; items?: unknown }
  const items = record.data?.items ?? record.items
  if (!Array.isArray(items)) return null
  const parsed: Array<{ key: string; status: string }> = []
  for (const item of items) {
    if (!item || typeof item !== 'object') return null
    const row = item as { key?: unknown; status?: unknown }
    if (typeof row.key !== 'string' || typeof row.status !== 'string') return null
    parsed.push({ key: row.key, status: row.status })
  }
  return parsed
}

function toFeatures(items: Array<{ key: string; status: string }>): Map<string, HubAiFeatureStatus> {
  const features = new Map<string, HubAiFeatureStatus>()
  for (const item of items) {
    if (item.status === 'available' || item.status === 'degraded' || item.status === 'off') {
      features.set(item.key, item.status)
    }
  }
  return features
}

export function useHubAiAvailability(enabled: boolean): HubAiProbe {
  const [attempt, setAttempt] = useState(0)
  const [probe, setProbe] = useState<ProbeState>(IDLE)

  useEffect(() => {
    if (!enabled) {
      setProbe(IDLE)
      return
    }

    let active = true
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), AI_CAPABILITY_TIMEOUT_MS)
    setProbe({ phase: 'checking', features: new Map() })

    void terminalAttributedFetch(`${API_BASE_URL}/kiosk/ai/capabilities`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!active) return
        if (!response.ok) {
          setProbe({ phase: 'down', features: new Map() })
          return
        }
        const items = readItems(await response.json())
        if (!items) {
          setProbe({ phase: 'down', features: new Map() })
          return
        }
        setProbe({
          phase: platformAiUnavailable(items) ? 'down' : 'ready',
          features: toFeatures(items),
        })
      })
      .catch(() => {
        if (active) setProbe({ phase: 'down', features: new Map() })
      })
      .finally(() => window.clearTimeout(timeoutId))

    return () => {
      active = false
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [enabled, attempt])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])
  // enabled 刚变成 true、effect 还没把 phase 改成 checking 的那一帧，也按「正在确认」处理。
  // 否则 AI 卡片会先闪成可点，再变成置灰。
  const aiChecking = enabled && (probe.phase === 'idle' || probe.phase === 'checking')
  const aiDown = enabled && probe.phase === 'down'

  return {
    aiDown,
    aiChecking,
    features: probe.features,
    retry,
  }
}
