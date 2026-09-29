// ============================================================
// 服务人次上报（KioskSession 契约 v1）—— 纯逻辑核心
//
// 一次「有人使用」= 一个周期：从屏保被唤醒 / 清场之后的第一次触摸开始计时（wokeAt），
// 周期内第一次进入服务页（或开始登录）才 start —— 误触首页不计；换到新的服务大类时
// heartbeat（同一大类 5 分钟内不重复），持续有操作时每 5 分钟最多补一次 heartbeat；
// 任何一次清场都 end 当前周期，并立刻换一个新的周期编号。
//
// 只报：随机周期编号、开始时间、结束时间与原因、服务大类（白名单）。
// 不报：手机号、会员号、文件名、页面路径、输入内容。路径只在本机用来归大类，不出本机。
//
// 失败绝不影响使用：不抛错、不弹提示；网络失败或 5xx 最多再试 1 次，其余直接丢；不在本机缓存。
// 本文件不 import 任何模块，发请求、取时间、生成编号都由调用方注入 —— 单测直接跑它。
// 契约来源：services/api/src/kiosk-session/（dto 与 kiosk-session.types.ts）。
// ============================================================

/** 服务大类白名单，与服务端 KIOSK_SERVICE_CATEGORIES 逐字一致（门禁对照）。 */
export const KIOSK_VISIT_CATEGORIES = [
  'print',
  'scan',
  'resume',
  'interview',
  'assistant',
  'career',
  'policy',
  'official_channel',
  'member',
  'help',
  'other',
] as const
export type KioskVisitCategory = (typeof KIOSK_VISIT_CATEGORIES)[number]

/** 结束原因白名单，与服务端 KIOSK_SESSION_END_REASONS 逐字一致。 */
export const KIOSK_VISIT_END_REASONS = ['idle_timeout', 'user_exit', 'privacy_clear', 'handover', 'other'] as const
export type KioskVisitEndReason = (typeof KIOSK_VISIT_END_REASONS)[number]

export type KioskVisitEndpoint = 'start' | 'heartbeat' | 'end'

/** 同一大类两次 heartbeat 的最小间隔；有操作时的补报也按这个间隔节流。 */
export const KIOSK_VISIT_HEARTBEAT_MS = 5 * 60 * 1000
/** 失败重试前的等待。 */
export const KIOSK_VISIT_RETRY_DELAY_MS = 1_000

/** 不算「有效操作」的路径：首页、待机屏、超时提醒、离线页、法律文本。 */
const IDLE_PATHS = new Set(['/', '/screensaver', '/session-timeout', '/error-offline'])

function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

/**
 * 路径 → 服务大类。返回 null 表示「这一步不算有效操作」。
 * 顺序有讲究：更具体的前缀排在前面（/resume/career-plan 属职业规划，不属简历；/me/feedback 属帮助）。
 */
export function categoryForPath(pathname: string): KioskVisitCategory | null {
  const path = pathname.replace(/\/+$/, '') || '/'
  if (IDLE_PATHS.has(path) || under(path, '/legal')) return null
  if (under(path, '/resume/career-plan') || under(path, '/resume/self-assessment') || under(path, '/ai/plan')) return 'career'
  if (under(path, '/me/feedback') || under(path, '/help')) return 'help'
  if (under(path, '/print') || under(path, '/print-scan') || under(path, '/upload/phone')) return 'print'
  if (under(path, '/scan')) return 'scan'
  if (under(path, '/resume') || under(path, '/resume-service') || under(path, '/session-resume')) return 'resume'
  if (under(path, '/interview') || under(path, '/interview-service')) return 'interview'
  if (under(path, '/assistant')) return 'assistant'
  if (under(path, '/policy-service') || under(path, '/renshi')) return 'policy'
  if (under(path, '/official-channels')) return 'official_channel'
  if (under(path, '/login') || under(path, '/member') || under(path, '/profile') || under(path, '/me') || under(path, '/notifications')) {
    return 'member'
  }
  return 'other'
}

export interface KioskVisitDeps {
  /** 发一次请求，回 HTTP 状态码；连不上时抛错或回 0。 */
  send: (endpoint: KioskVisitEndpoint, body: Record<string, string>) => Promise<number>
  now: () => number
  uuid: () => string
  sleep: (ms: number) => Promise<void>
}

export interface KioskVisitSnapshot {
  clientSessionId: string
  wokeAt: number
  started: boolean
  dormant: boolean
}

export interface KioskVisitReporter {
  /** 路由变化时调用（含首次渲染）。 */
  enterPath: (pathname: string) => void
  /** 触摸 / 按键时调用：记下「第一次触摸」作为周期开始，已开始的周期按间隔补 heartbeat。 */
  noteActivity: () => void
  /** 清场时调用：结束当前周期（开始过才发），并立即换新周期。 */
  end: (reason: KioskVisitEndReason) => void
  /** 等在飞的请求都结束（测试用）。 */
  settle: () => Promise<void>
  snapshot: () => KioskVisitSnapshot
}

type Outcome = 'ok' | 'not_found' | 'failed'

const iso = (ms: number): string => new Date(ms).toISOString()

/**
 * enabled=false 时返回的上报器什么都不发（演示模式、浏览器测试构建、本机没有终端编号）。
 */
export function createKioskVisitReporter(deps: KioskVisitDeps, enabled = true): KioskVisitReporter {
  let clientSessionId = deps.uuid()
  let wokeAt = deps.now()
  let touched = false
  let started = false
  let dormant = false
  let lastCategory: KioskVisitCategory = 'other'
  let lastBeatAt = 0
  const categoryBeatAt = new Map<KioskVisitCategory, number>()
  const inflight = new Set<Promise<void>>()

  const track = (work: Promise<void>): void => {
    const guarded = work.catch(() => undefined)
    inflight.add(guarded)
    void guarded.finally(() => inflight.delete(guarded))
  }

  async function deliver(endpoint: KioskVisitEndpoint, body: Record<string, string>): Promise<Outcome> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let status = 0
      try {
        status = await deps.send(endpoint, body)
      } catch {
        status = 0
      }
      if (status >= 200 && status < 300) return 'ok'
      if (status === 404 && endpoint !== 'start') return 'not_found'
      const transient = status === 0 || status >= 500
      if (!transient || attempt === 1) return 'failed'
      await deps.sleep(KIOSK_VISIT_RETRY_DELAY_MS)
    }
    return 'failed'
  }

  const startBody = (id: string, at: number, category: KioskVisitCategory) => ({
    clientSessionId: id,
    wokeAt: iso(at),
    category,
  })

  function heartbeat(category?: KioskVisitCategory): void {
    const id = clientSessionId
    const at = wokeAt
    const fallbackCategory = category ?? lastCategory
    track((async () => {
      const outcome = await deliver('heartbeat', category ? { clientSessionId: id, category } : { clientSessionId: id })
      // 服务端没有这个周期（start 丢了或还没到）：按原编号补 start，start 幂等。
      if (outcome === 'not_found') await deliver('start', startBody(id, at, fallbackCategory))
    })())
  }

  function resetCycle(at: number): void {
    clientSessionId = deps.uuid()
    wokeAt = at
    touched = false
    started = false
    lastCategory = 'other'
    lastBeatAt = 0
    categoryBeatAt.clear()
  }

  return {
    enterPath(pathname) {
      if (!enabled) return
      const now = deps.now()
      if (pathname === '/screensaver') {
        dormant = true
        return
      }
      if (dormant) {
        // 屏保被唤醒：没开始过的周期从这一刻算起。
        dormant = false
        if (!started) {
          wokeAt = now
          touched = true
        }
      }
      const category = categoryForPath(pathname)
      if (!category) return
      lastCategory = category
      if (!started) {
        started = true
        lastBeatAt = now
        categoryBeatAt.set(category, now)
        const id = clientSessionId
        const at = wokeAt
        track(deliver('start', startBody(id, at, category)).then(() => undefined))
        return
      }
      const sentAt = categoryBeatAt.get(category)
      if (sentAt !== undefined && now - sentAt < KIOSK_VISIT_HEARTBEAT_MS) return
      categoryBeatAt.set(category, now)
      lastBeatAt = now
      heartbeat(category)
    },

    noteActivity() {
      if (!enabled || dormant) return
      const now = deps.now()
      if (!started) {
        // 清场后第一次触摸：周期从这里算起（否则空等的那段也会算进使用时长）。
        if (!touched) {
          touched = true
          wokeAt = now
        }
        return
      }
      if (now - lastBeatAt < KIOSK_VISIT_HEARTBEAT_MS) return
      lastBeatAt = now
      heartbeat()
    },

    end(reason) {
      if (!enabled) return
      const now = deps.now()
      if (started) {
        const id = clientSessionId
        const at = wokeAt
        const category = lastCategory
        const body = { clientSessionId: id, endedAt: iso(now), endReason: reason }
        track((async () => {
          const outcome = await deliver('end', body)
          if (outcome !== 'not_found') return
          // start 丢了但这次使用是真的：补 start 再 end，两者都幂等。
          if ((await deliver('start', startBody(id, at, category))) === 'ok') await deliver('end', body)
        })())
      }
      resetCycle(now)
    },

    async settle() {
      while (inflight.size > 0) await Promise.all([...inflight])
    },

    snapshot: () => ({ clientSessionId, wokeAt, started, dormant }),
  }
}
