// 扫描仪探测的唯一读数。页面只订阅这里，不自己 fetch、不自己轮询。
// 超过 1 分钟的成功探测不再算就绪。心跳不能代替这一次探测。

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { probeLocalScanner, type LocalScanHealth, type LocalScanProbeFailure } from './localScanApi'

export const LOCAL_SCAN_PROBE_FRESH_MS = 60_000

interface ProbeSnapshot {
  seq: number
  phase: 'idle' | 'checking' | 'done'
  health: LocalScanHealth | null
  failure: LocalScanProbeFailure | null
  observedAt: number | null
}

const IDLE: ProbeSnapshot = {
  seq: 0,
  phase: 'idle',
  health: null,
  failure: null,
  observedAt: null,
}

let snapshot: ProbeSnapshot = IDLE
let currentAbort: AbortController | null = null
const listeners = new Set<() => void>()

function publish(next: ProbeSnapshot): void {
  snapshot = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): ProbeSnapshot {
  return snapshot
}

export interface LocalScanProbeView {
  phase: ProbeSnapshot['phase']
  health: LocalScanHealth | null
  failure: LocalScanProbeFailure | null
  observedAt: number | null
  /** 本次探测健康态是 ready，并且检查时间还在 1 分钟内。 */
  freshReady: boolean
  ageSeconds: number | null
}

export function toLocalScanProbeView(snap: ProbeSnapshot, now: number): LocalScanProbeView {
  const ageSeconds = snap.observedAt == null ? null : Math.max(0, Math.floor((now - snap.observedAt) / 1000))
  const freshReady = snap.phase === 'done'
    && snap.failure == null
    && snap.health === 'ready'
    && snap.observedAt != null
    && now - snap.observedAt < LOCAL_SCAN_PROBE_FRESH_MS
  return {
    phase: snap.phase,
    health: snap.health,
    failure: snap.failure,
    observedAt: snap.observedAt,
    freshReady,
    ageSeconds,
  }
}

/** 再探一次。返回这一次的序号；卸载时只取消仍是这一次的请求。 */
export function requestLocalScanProbe(): number {
  currentAbort?.abort()
  const controller = new AbortController()
  currentAbort = controller
  const seq = snapshot.seq + 1
  publish({ seq, phase: 'checking', health: null, failure: null, observedAt: null })
  void probeLocalScanner(controller.signal).then((result) => {
    if (controller.signal.aborted || seq !== snapshot.seq) return
    if (result.ok) {
      publish({ seq, phase: 'done', health: result.health, failure: null, observedAt: Date.now() })
      return
    }
    publish({ seq, phase: 'done', health: null, failure: result.failure, observedAt: Date.now() })
  })
  return seq
}

export function abortLocalScanProbe(seq: number): void {
  if (seq !== snapshot.seq) return
  currentAbort?.abort()
}

/**
 * @param enabled 为真时进页立刻探测一次。为假只读上一次的结果，不发请求。
 */
export function useLocalScanProbe(enabled: boolean): LocalScanProbeView {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const now = useProbeClock(snap.observedAt, snap.health)
  useEffect(() => {
    if (!enabled) return
    const seq = requestLocalScanProbe()
    return () => abortLocalScanProbe(seq)
  }, [enabled])
  return useMemo(() => toLocalScanProbeView(snap, now), [snap, now])
}

/** 成功探测满 1 分钟时再渲染一次，让「就绪」自己失效。不是第二次网络轮询。 */
function useProbeClock(observedAt: number | null, health: LocalScanHealth | null): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (observedAt == null || health !== 'ready') return
    const remain = LOCAL_SCAN_PROBE_FRESH_MS - (Date.now() - observedAt)
    if (remain <= 0) {
      setNow(Date.now())
      return
    }
    const timer = window.setTimeout(() => setNow(Date.now()), remain)
    return () => window.clearTimeout(timer)
  }, [observedAt, health])
  return now
}
