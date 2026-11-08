// 本机扫描仪。只打终端程序的 127.0.0.1，不把云端控制凭据带过去。
// 探测、开始、翻页、结束、中止都走这一份。云端会话状态才决定屏，本机回包只是提示。

const configuredLocalAgentBaseUrl = (import.meta.env['VITE_TERMINAL_AGENT_LOCAL_URL'] ?? '').trim()
const LOCAL_AGENT_BASE_URL = configuredLocalAgentBaseUrl || 'http://127.0.0.1:9527'
const BRIDGE_TOKEN = (import.meta.env['VITE_TERMINAL_AGENT_BRIDGE_TOKEN'] ?? '').trim()
const PROBE_TIMEOUT_MS = 8_000
const COMMAND_TIMEOUT_MS = 8_000

export type LocalScanCommandName = 'start' | 'next-page' | 'finish' | 'abort'

export type LocalScanCommandFailure = 'unreachable' | 'unknown' | 'not-active' | 'unconfirmed'

/** 成功只表示本机回了确定信封。页数不拿来上屏，上屏只数云端的整页。 */
export type LocalScanCommandResult =
  | {
      ok: true
      state: string
      pageCount: number | null
      errorCode: string | null
      /** 只有回包明确给了布尔才有值。没有这一位，不许说页已经删掉。 */
      purged: boolean | null
    }
  | { ok: false; kind: LocalScanCommandFailure; code: string | null }

/** 与终端程序当场探测的健康态一致。不认识的值一律当成 unknown。 */
export const LOCAL_SCAN_HEALTHS = ['ready', 'busy', 'not_found', 'error', 'unknown'] as const
export type LocalScanHealth = (typeof LOCAL_SCAN_HEALTHS)[number]

export type LocalScanProbeFailure = 'unreachable' | 'unknown'

export type LocalScanProbeResult =
  | { ok: true; health: LocalScanHealth }
  | { ok: false; failure: LocalScanProbeFailure }

function isHealth(value: unknown): value is LocalScanHealth {
  return typeof value === 'string' && (LOCAL_SCAN_HEALTHS as readonly string[]).includes(value)
}

/**
 * GET /local/scan/probe。
 * 没有桥接令牌、网络失败、超时：unreachable（本机程序连不上）。
 * HTTP 错误、信封对不上、健康态不认识：unknown（状态未知）。这两种都不是就绪。
 */
export async function probeLocalScanner(signal?: AbortSignal): Promise<LocalScanProbeResult> {
  if (!BRIDGE_TOKEN) return { ok: false, failure: 'unreachable' }

  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  const onAbort = (): void => controller.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    const response = await fetch(`${LOCAL_AGENT_BASE_URL}/local/scan/probe`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'X-Local-Bridge-Token': BRIDGE_TOKEN,
      },
      signal: controller.signal,
    })
    if (!response.ok) return { ok: false, failure: 'unknown' }
    const body = (await response.json()) as { success?: unknown; data?: { state?: unknown } }
    if (body.success !== true || !isHealth(body.data?.state)) return { ok: false, failure: 'unknown' }
    return { ok: true, health: body.data.state }
  } catch {
    return { ok: false, failure: 'unreachable' }
  } finally {
    window.clearTimeout(timeout)
    signal?.removeEventListener('abort', onAbort)
  }
}

type LocalScanCommandEnvelope = {
  success?: unknown
  data?: { state?: unknown; pageCount?: unknown; errorCode?: unknown; purged?: unknown }
  error?: { code?: unknown }
}

function commandFailure(code: string | null, httpError: boolean): LocalScanCommandResult {
  if (code === 'LOCAL_SCAN_TASK_NOT_ACTIVE') return { ok: false, kind: 'not-active', code }
  if (code === 'LOCAL_SCAN_DELIVERY_UNCONFIRMED') return { ok: false, kind: 'unconfirmed', code }
  if (code?.startsWith('LOCAL_SCAN_') || httpError) return { ok: false, kind: 'unknown', code }
  return { ok: false, kind: 'unknown', code }
}

/**
 * POST /local/scan/{start|next-page|finish|abort}。
 * 请求体只有 `{ scanTaskId }`，不带查询串，不带云端控制凭据。
 * 没有桥接令牌或网络失败：unreachable。超时、坏信封、不认识的 LOCAL_SCAN_*：unknown。
 * 不自动重发。调用方拿到不确定就停在「状态未知」，再去读云端。
 */
export async function postLocalScanCommand(
  command: LocalScanCommandName,
  scanTaskId: string,
  signal?: AbortSignal,
): Promise<LocalScanCommandResult> {
  const taskId = scanTaskId.trim()
  if (!taskId) return { ok: false, kind: 'unknown', code: null }
  if (!BRIDGE_TOKEN) return { ok: false, kind: 'unreachable', code: null }

  const controller = new AbortController()
  let timedOut = false
  const timeout = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, COMMAND_TIMEOUT_MS)
  const onAbort = (): void => controller.abort()
  signal?.addEventListener('abort', onAbort)
  try {
    const response = await fetch(`${LOCAL_AGENT_BASE_URL}/local/scan/${command}`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Local-Bridge-Token': BRIDGE_TOKEN,
      },
      body: JSON.stringify({ scanTaskId: taskId }),
      signal: controller.signal,
    })
    let payload: LocalScanCommandEnvelope | null = null
    try {
      payload = (await response.json()) as LocalScanCommandEnvelope
    } catch {
      payload = null
    }
    if (!response.ok || payload?.success !== true) {
      const code = typeof payload?.error?.code === 'string' ? payload.error.code : null
      return commandFailure(code, true)
    }
    const state = payload.data?.state
    if (typeof state !== 'string' || state.trim().length === 0) {
      return { ok: false, kind: 'unknown', code: null }
    }
    const pageCount = typeof payload.data?.pageCount === 'number' ? payload.data.pageCount : null
    const errorCode = typeof payload.data?.errorCode === 'string' ? payload.data.errorCode : null
    const purged = typeof payload.data?.purged === 'boolean' ? payload.data.purged : null
    return { ok: true, state, pageCount, errorCode, purged }
  } catch {
    if (timedOut) return { ok: false, kind: 'unknown', code: null }
    return { ok: false, kind: 'unreachable', code: null }
  } finally {
    window.clearTimeout(timeout)
    signal?.removeEventListener('abort', onAbort)
  }
}
