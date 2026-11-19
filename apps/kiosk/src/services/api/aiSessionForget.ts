// 清场时让服务器忘掉这一人次的小青对话和作业内存。
//
// 会话号只留在本模块的内存里：整页重载自然清空，不写 localStorage / sessionStorage。
// 发送用 keepalive 的裸 fetch。失败会退避重试，仍失败只记一条诊断，不抛错、不把原话写进日志。
// 终端封装发出前会先等声明桥和在飞的续期，可能晚于清场末尾的整页重载；
// 这两个接口本身也不要求终端会话票。

import { parseId } from '../../pages/ai-plan/advisorArtifactModel'
import { API_BASE_URL, API_MODE } from './client'

/** 小青会话号：16 字节小写十六进制。旧的 session-…、演示的 mock-… 不收。 */
const ASSISTANT_SESSION_ID_RE = /^[0-9a-f]{32}$/
const MAX_REMEMBERED = 10

export interface AdvisorSessionAccess {
  token?: string | null
  accessToken?: string | null
}

interface AdvisorMemory {
  id: string
  accessToken?: string
}

const assistantIds: string[] = []
const advisorSessions: AdvisorMemory[] = []

function rememberLimited<T>(list: T[], item: T, same: (entry: T) => boolean): void {
  const next = list.filter((entry) => !same(entry))
  next.push(item)
  list.splice(0, list.length, ...next.slice(-MAX_REMEMBERED))
}

export function rememberAssistantSession(id: string): void {
  if (typeof id !== 'string' || !ASSISTANT_SESSION_ID_RE.test(id)) return
  rememberLimited(assistantIds, id, (entry) => entry === id)
}

/** 作业号沿用作业面 parseId。匿名令牌有的话记下；没有则沿用这个号上一次记下的。 */
export function rememberAdvisorSession(id: string, access?: AdvisorSessionAccess): void {
  if (typeof id !== 'string') return
  const parsed = parseId(id)
  if (!parsed) return
  const fresh = typeof access?.accessToken === 'string' ? access.accessToken.trim() : ''
  const previous = advisorSessions.find((entry) => entry.id === parsed)
  const accessToken = fresh || previous?.accessToken
  rememberLimited(
    advisorSessions,
    accessToken ? { id: parsed, accessToken } : { id: parsed },
    (entry) => entry.id === parsed,
  )
}

/**
 * 离场最多等清场请求这么久，再重载。
 *
 * 三次尝试的间隔是 0、200、800 毫秒，请求正常时一两秒内就有结果。
 * 上限取 8 秒，和扫描「创建还在飞」的收尾上限相同：公共一体机不能为了清对话，
 * 把下一位挡得比等一次扫描创建更久。到点仍没有服务端确认，就记一条诊断、照常离场。
 * 服务端还有每分钟空闲清扫，对话本身 30 分钟过期。
 * 这里不产生「已清」：成功与否只留在请求结果里，诊断里也不写原话和会话号。
 */
export const AI_FORGET_DEADLINE_MS = 8_000

const FORGET_RETRY_DELAYS_MS = [0, 200, 800]

let generation = 0
let pendingCount = 0
const waiters: Array<() => void> = []
const inflight = new Set<AbortController>()

interface Sleeper {
  timer: ReturnType<typeof setTimeout>
  resolve: (stillHere: boolean) => void
}
const sleepers: Sleeper[] = []

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === 'object' && timer !== null && 'unref' in timer && typeof timer.unref === 'function') {
    timer.unref()
  }
}

function sleep(ms: number, gen: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const index = sleepers.findIndex((item) => item.timer === timer)
      if (index >= 0) sleepers.splice(index, 1)
      resolve(generation === gen)
    }, ms)
    unrefTimer(timer)
    sleepers.push({ timer, resolve })
  })
}

function wakeSleepers(): void {
  for (const sleeper of sleepers.splice(0, sleepers.length)) {
    clearTimeout(sleeper.timer)
    sleeper.resolve(false)
  }
}

/** 有人在等结果时占住事件循环。重试本身的定时器不占，免得没人等也把进程留住。 */
let waiterKeepAlive: ReturnType<typeof setTimeout> | undefined

function armWaiterKeepAlive(): void {
  if (waiterKeepAlive !== undefined) return
  waiterKeepAlive = setTimeout(() => undefined, AI_FORGET_DEADLINE_MS + 1_000)
}

function clearWaiterKeepAlive(): void {
  if (waiterKeepAlive === undefined) return
  clearTimeout(waiterKeepAlive)
  waiterKeepAlive = undefined
}

function settleWaiters(): void {
  const queued = waiters.splice(0, waiters.length)
  for (const resolve of queued) resolve()
  if (waiters.length === 0) clearWaiterKeepAlive()
}

/** 还有清场请求（含退避重试）没出结果。 */
export function aiSessionForgetPending(): boolean {
  return pendingCount > 0
}

/** 没有在途清场时已经解决。有的话，等到成功、失败诊断、到点或页面拆掉。 */
export function whenAiSessionsForgotten(): Promise<void> {
  if (pendingCount === 0) return Promise.resolve()
  armWaiterKeepAlive()
  return new Promise((resolve) => { waiters.push(resolve) })
}

/**
 * 页面要拆掉了（重载或硬跳转）。还在睡的重试和还在飞的请求都停。
 * 已经没有在途请求时不记诊断，避免每次正常离场都报成「被截断」。
 */
export function noteAiForgetPageGone(): void {
  generation += 1
  wakeSleepers()
  for (const controller of inflight) controller.abort()
  inflight.clear()
  if (pendingCount === 0) return
  pendingCount = 0
  console.warn('[kiosk-clear] forget_aborted reason=page_gone')
  settleWaiters()
}

function track(work: Promise<void>, gen: number): void {
  pendingCount += 1
  void work.finally(() => {
    if (generation !== gen) return
    pendingCount -= 1
    if (pendingCount <= 0) {
      pendingCount = 0
      settleWaiters()
    }
  })
}

function fireForget(path: string, headers: Record<string, string>, body?: string): void {
  const gen = generation
  try {
    track(sendWithRetry(path, headers, body, gen).catch(() => undefined), gen)
  } catch {
    // 同步抛错也吞掉。清场不能停在这一步。
  }
}

async function sendWithRetry(
  path: string,
  headers: Record<string, string>,
  body: string | undefined,
  gen: number,
): Promise<void> {
  const doFetch = fetch
  const kind = path.startsWith('/assistant/') ? 'assistant' : 'advisor'
  const started = Date.now()
  let status = 0
  for (let attempt = 0; attempt < FORGET_RETRY_DELAYS_MS.length; attempt += 1) {
    if (generation !== gen) return
    if (Date.now() - started >= AI_FORGET_DEADLINE_MS) {
      console.warn(`[kiosk-clear] forget_deadline kind=${kind} attempts=${attempt}`)
      return
    }
    const wait = FORGET_RETRY_DELAYS_MS[attempt] ?? 0
    if (wait > 0) {
      const remaining = AI_FORGET_DEADLINE_MS - (Date.now() - started)
      const stillHere = await sleep(Math.min(wait, remaining), gen)
      if (!stillHere || generation !== gen) return
    }
    if (generation !== gen) return
    const left = AI_FORGET_DEADLINE_MS - (Date.now() - started)
    if (left <= 0) {
      console.warn(`[kiosk-clear] forget_deadline kind=${kind} attempts=${attempt}`)
      return
    }
    const controller = new AbortController()
    inflight.add(controller)
    const timer = setTimeout(() => controller.abort(), left)
    try {
      const aborted = new Promise<never>((_resolve, reject) => {
        if (controller.signal.aborted) {
          reject(new Error('aborted'))
          return
        }
        controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
      void aborted.catch(() => undefined)
      const res = await Promise.race([
        doFetch(`${API_BASE_URL}${path}`, {
          method: 'POST',
          headers,
          credentials: 'include',
          keepalive: true,
          signal: controller.signal,
          ...(body !== undefined ? { body } : {}),
        }),
        aborted,
      ])
      if (generation !== gen) return
      if (res.ok) return
      status = typeof res.status === 'number' ? res.status : 0
    } catch {
      if (generation !== gen) return
      status = 0
    } finally {
      clearTimeout(timer)
      inflight.delete(controller)
    }
  }
  if (generation !== gen) return
  console.warn(`[kiosk-clear] forget_failed kind=${kind} status=${status} attempts=${FORGET_RETRY_DELAYS_MS.length}`)
}

/**
 * 先取走登记再清空：同一次清场里再进来就是空操作。
 * 只在 http 模式发。失败会重试，仍失败不许抛到清场外面。
 */
export function forgetAiSessions(memberToken: string | null): void {
  try {
    const assistants = assistantIds.splice(0, assistantIds.length)
    const advisors = advisorSessions.splice(0, advisorSessions.length)
    if (API_MODE !== 'http') return
    const token = typeof memberToken === 'string' && memberToken.trim() ? memberToken.trim() : null

    if (assistants.length > 0) {
      const body = JSON.stringify({ sessionIds: assistants })
      const headers = { Accept: 'application/json', 'Content-Type': 'application/json' }
      // 登录前开的对话归来源地址。先按会员发，再匿名发一次；不是自己的，服务端回 0。
      if (token) {
        fireForget('/assistant/sessions/forget', { ...headers, Authorization: `Bearer ${token}` }, body)
      }
      fireForget('/assistant/sessions/forget', headers, body)
    }

    for (const advisor of advisors) {
      if (!token && !advisor.accessToken) continue
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (token) headers.Authorization = `Bearer ${token}`
      if (advisor.accessToken) headers['x-advisor-access-token'] = advisor.accessToken
      fireForget(`/advisor/sessions/${encodeURIComponent(advisor.id)}/forget`, headers)
    }
  } catch {
    assistantIds.splice(0, assistantIds.length)
    advisorSessions.splice(0, advisorSessions.length)
  }
}
