/**
 * agent/scan-device/wia-probe.ts — 扫描仪健康探测
 *
 * 即时连一次扫描仪：不设属性、不扫描、不写文件，回 ready / busy / not_found / error。
 * 起进程、超时、强杀复用 wia-runner.ts 的 runJob（探测没有取消标记，超时直接强杀）。
 * 调用方负责先拿设备锁（A2）。本批（A1）没有调用方。
 */

import { log } from '../../logger'
import { WIA_HRESULT, buildWiaPowerShellArgs, buildWiaProbeScript, encodeWiaCommand, parseWiaLine, type WiaLine } from './wia-script'
import { createDefaultWiaRunnerDeps, runJob, type WiaRunnerDeps } from './wia-runner'

export const WIA_PROBE_TIMEOUT_MS = 20_000

export interface WiaProbeResult {
  state: 'ready' | 'busy' | 'not_found' | 'error'
  hresult?: string
  forceKilled: boolean
  /** 强杀没确认进程退出。调用方交给健康管理器，不在这里另作处理。 */
  stopUnconfirmed: boolean
  processId?: number
  elapsedMs: number
}

/** 即时连一次扫描仪：不设属性、不扫描、不写文件。调用方负责先拿设备锁。 */
export async function runWiaProbe(
  options: { deviceName?: string; timeoutMs?: number } = {},
  overrides: Partial<WiaRunnerDeps> = {},
): Promise<WiaProbeResult> {
  const deps: WiaRunnerDeps = { ...createDefaultWiaRunnerDeps(), ...overrides }
  const args = buildWiaPowerShellArgs(encodeWiaCommand(buildWiaProbeScript(options.deviceName ?? '')))
  const startedAt = deps.clock.now()
  let final: Extract<WiaLine, { kind: 'done' | 'failed' }> | undefined
  const timeoutMs = options.timeoutMs ?? WIA_PROBE_TIMEOUT_MS
  const job = runJob(
    {
      args,
      idleTimeoutMs: timeoutMs,
      totalTimeoutMs: timeoutMs,
      graceMs: 0,
      onLine: (line) => {
        const parsed = parseWiaLine(line)
        if (parsed && parsed.kind !== 'page') final ??= parsed
      },
    },
    deps,
  )
  const exit = await job.done
  const base = {
    forceKilled: exit.forceKilled,
    stopUnconfirmed: exit.stopUnconfirmed,
    elapsedMs: deps.clock.now() - startedAt,
    ...(exit.processId !== undefined ? { processId: exit.processId } : {}),
  }
  let probe: WiaProbeResult
  if (exit.timedOut || exit.spawnFailed || !final) {
    probe = { state: 'error', ...base }
  } else if (final.kind === 'done') {
    probe = { state: final.probe ? 'ready' : 'error', ...base }
  } else if (final.stage === 'device_not_found') {
    probe = { state: 'not_found', ...base }
  } else {
    probe = { state: final.hresult === WIA_HRESULT.BUSY ? 'busy' : 'error', hresult: final.hresult, ...base }
  }
  log(`wia-runner: probe state=${probe.state}${probe.hresult ? ` hresult=${probe.hresult}` : ''} forceKilled=${probe.forceKilled} elapsedMs=${probe.elapsedMs}`)
  return probe
}
