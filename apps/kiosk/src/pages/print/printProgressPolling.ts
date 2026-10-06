// ============================================================
// printProgressPolling — 进度页「读没读到状态」和「打印结论」分开
//
// GET /print/jobs/:taskId 抛错（断网、超时、5xx，以及其他没有 status 的失败）
// 只说明这一下没读到。服务端明确回 failed / cancelled / abandoned 才是打印失败。
// 从最后一次读到状态起，连续读不到超过 10 分钟，进入「结果未确认」。
// 模拟模式不走这里。
// ============================================================

import type { BackendJobStatus } from '../../services/print/printJobsApi'

/** 硬件回流轮询间隔。断网期间也用它重试，不超过 POLL_INTERVAL_MAX_MS。 */
export const POLL_INTERVAL_MS = 3000
export const POLL_INTERVAL_MAX_MS = 10_000
/** 从最后一次读到状态起，连续读不到超过这段时间才是「结果未确认」。刚好 10 分钟仍算断网。 */
export const UNREADABLE_UNCONFIRMED_MS = 10 * 60 * 1000

export const STATUS_READ_ERROR_TEXT = '暂时无法读取状态'
export const OFFLINE_TITLE = '网络中断，打印可能仍在进行，请先看出纸口'
export const OFFLINE_DETAIL = '网络恢复后会自动更新这里的状态'
export const UNCONFIRMED_COPY =
  '这台机器暂时连不上网络，没法确认这单打完了没有。请先看出纸口；没出纸的，网络恢复后在『我的 → 打印订单』查看这单。'

const SERVER_PRINT_FAILURE = new Set<BackendJobStatus>(['failed', 'cancelled', 'abandoned'])

export type PollLinkPhase = 'live' | 'offline' | 'unconfirmed'

export interface PollLinkState {
  phase: PollLinkPhase
  consecutiveUnreadable: number
  /** 最近一次读到状态的时刻。还没读到过时，用本轮轮询开始时刻。 */
  lastReadableAtMs: number
}

export type PollRead =
  | { kind: 'readable'; status: BackendJobStatus }
  | { kind: 'unreadable' }

export interface PollReduction {
  state: PollLinkState
  /** 只有读到终态才非空。读不到状态永远是 null。 */
  terminal: 'success' | 'failure' | null
}

export function createPollLinkState(nowMs: number): PollLinkState {
  return { phase: 'live', consecutiveUnreadable: 0, lastReadableAtMs: nowMs }
}

function httpStatusOf(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('status' in error)) return null
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' ? status : null
}

/**
 * 进了 catch 的都还不是打印结论。
 * 没有 HTTP 状态（fetch 抛错）、网络（0）、超时（408）、5xx、4xx，都算读不到。
 * failed / cancelled / abandoned 只出现在 200 的 status 字段里，不会走到这里。
 */
export function isUnreadablePollError(error: unknown): boolean {
  const status = httpStatusOf(error)
  if (status == null) return true
  if (status === 0 || status === 408 || status >= 500) return true
  return status >= 400
}

export function reducePollLink(state: PollLinkState, event: PollRead, nowMs: number): PollReduction {
  if (event.kind === 'readable') {
    const terminal = event.status === 'completed'
      ? 'success'
      : SERVER_PRINT_FAILURE.has(event.status)
        ? 'failure'
        : null
    return {
      state: { phase: 'live', consecutiveUnreadable: 0, lastReadableAtMs: nowMs },
      terminal,
    }
  }
  const elapsed = nowMs - state.lastReadableAtMs
  const phase: PollLinkPhase = elapsed > UNREADABLE_UNCONFIRMED_MS ? 'unconfirmed' : 'offline'
  return {
    state: {
      phase,
      consecutiveUnreadable: state.consecutiveUnreadable + 1,
      lastReadableAtMs: state.lastReadableAtMs,
    },
    terminal: null,
  }
}

/**
 * 断网（offline）不算打印结束，锁保持，避免屏保和自动登出把人从出纸口赶走。
 * 结果未确认必须放锁，否则这台机器会一直锁着。
 * 失败、查询超时、模拟结束同样放锁。模拟进行中照旧持锁。
 */
export function holdsPrintBusyLock(input: {
  useRealApi: boolean
  failed: boolean
  timedOut: boolean
  resultUnconfirmed: boolean
  isSim: boolean
  simDone: boolean
}): boolean {
  const realActive = input.useRealApi && !input.failed && !input.timedOut && !input.resultUnconfirmed
  const simActive = input.isSim && !input.failed && !input.simDone
  return realActive || simActive
}
