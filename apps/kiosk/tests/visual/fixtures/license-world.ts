import type { Page, Request, Route } from '@playwright/test'
import type { PublicKioskProfile } from '@ai-job-print/shared'
import { kioskProfile, kioskProfileBody, UNVERIFIED_KIOSK_PROFILE } from '../../fixtures/kiosk-profile'

/**
 * 授权闸门走查用的「假服务端 + 页面时钟」（kiosk-license-gate.spec.ts）。
 *
 * 只模拟服务端与授权闸门有关的三件事，规则照后端写（terminal-session.service.ts、kiosk-profile.service.ts）：
 *   · 换票（POST /terminals/session-token）与续期（POST /terminals/session-token/refresh）：授权不可用时
 *     拒绝签发新会话——403 TERMINAL_LICENSE_INACTIVE；续期时票本身已过期则先是 401 TERMINAL_SESSION_INVALID。
 *   · GET /public/kiosk-profile：请求带着仍有效的会话票才算验过签——给机构品牌与授权块
 *     （licenseState / acceptsNewSessions / currentSessionEndsAt = 这张票的到期时刻）；票过期或没带，
 *     只给平台默认品牌，licenseState 为 null（「不知道、不拦」）。授权失效不掐断已签发的票，只是不再签发新票。
 *   · 页面时钟：用例用 advance() 一段一段推进页面时钟（Playwright page.clock.runFor），
 *     假服务端用同一把钟判断票是否过期。Playwright 的假时钟有两个脾气，这里都照着办：
 *     ① 装上后照常按真实时间走，但 runFor 调用本身花掉的真实时间不算进页面时间（机器忙时每段多花零点几秒到几秒，
 *       累计起来页面时间就比「真实时间 + 推进量」慢一大截）；② 刷新页面时按日志重放，重放会把 runFor 花掉的时间算进去，
 *       刷新后页面时间会往前跳。所以假服务端的时间不自己估，每推进一段、每次刷新后都回页面读一遍（sync）。
 *
 * 这样用例能走完整条真实链路（页面自己的换票 / 续期 / 复查 / 取 profile），而不是替页面把结论喂进去。
 */
const MINUTE = 60_000
/** 假时钟一次最多往前跳这么久就等请求落地（页面请求的超时计时器最短 4 秒，见 advance 的说明）。 */
const REQUEST_SAFE_STEP_MS = 3_500
/** 后端会话票有效期：签发后最长 30 分钟。 */
const SESSION_TTL_MS = 30 * MINUTE
/** 屏上「暂停服务」的如实说法（契约：packages/shared/src/types/branding.ts KIOSK_PAUSED_NOTICE_LINE）。 */
export const PAUSED_NOTICE_LINE = '这台机器暂时不能用。'

function json(status: number, body: unknown): Parameters<Route['fulfill']>[0] {
  return { status, contentType: 'application/json', body: JSON.stringify(body) }
}

export class LicenseWorld {
  /** 授权是否可用（管理员在后台的状态）。 */
  active = true
  /** 把验过签的请求也当成没验过：模拟服务端暂时回不出授权块（例如缓存服务抖动）。 */
  forceUnverified = false
  /** 机构品牌覆盖：只给验过签的请求（没验过只给平台默认）。 */
  brand: Partial<PublicKioskProfile> = {}
  /** 会话票 → 到期时刻（页面时钟毫秒）。 */
  readonly sessions = new Map<string, number>()
  readonly log = {
    exchange: [] as number[],
    refresh: [] as number[],
    profile: [] as Array<{ at: number; verified: boolean; licenseState: string | null }>,
  }
  /** 最近一次从页面读到的时钟读数，以及读它时的真实时刻；两次读数之间页面时钟照真实时间走。 */
  private syncedPage = 0
  private syncedAt = 0
  /** runFor 进行中：页面时钟停在这个目标读数上（那一刻服务端看到的时间）。 */
  private runTarget: number | null = null
  private base = 0
  private bootedAt: number | null = null
  private seq = 0
  private inFlight = 0
  private nudgeFlip = false
  /** 页面发出、还没收到结果的请求（含本机程序桥接那几条）：时钟往前跳之前必须等它们落地，否则页面里 4 秒、8 秒的请求超时计时器会先于应答到点。 */
  private readonly pending = new Set<Request>()

  constructor(private readonly page: Page) {
    const settle = (request: Request) => { this.pending.delete(request) }
    page.on('request', (request) => {
      if (!request.url().startsWith('data:')) this.pending.add(request)
    })
    page.on('requestfinished', settle)
    page.on('requestfailed', settle)
  }

  /** 页面时钟此刻的毫秒数。 */
  now(): number {
    if (this.runTarget !== null) return this.runTarget
    return this.syncedPage + (Date.now() - this.syncedAt)
  }

  /** 回页面读一遍时钟。页面正在跳转读不到时沿用上一次的读数。刷新页面之后要调用。 */
  async sync(): Promise<void> {
    try {
      this.syncedPage = await this.page.evaluate(() => Date.now())
      this.syncedAt = Date.now()
    } catch {
      /* 页面正在跳转 */
    }
  }

  /** 装页面时钟和三条服务端路由。要在 page.goto 之前调用。 */
  async install(): Promise<void> {
    await this.page.clock.install()
    this.base = Date.now()
    this.syncedPage = this.base
    this.syncedAt = this.base
    const { page } = this

    await page.route('**/api/v1/terminals/session-token', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      await this.guard(async () => {
        this.log.exchange.push(this.now())
        if (!this.active) return route.fulfill(this.inactive())
        return route.fulfill(json(200, { sessionToken: this.issue(), expiresInSeconds: SESSION_TTL_MS / 1000 }))
      })
    })

    await page.route('**/api/v1/terminals/session-token/refresh', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      await this.guard(async () => {
        this.log.refresh.push(this.now())
        const presented = route.request().headers()['x-terminal-session-token'] ?? ''
        if (!this.live(presented)) {
          return route.fulfill(json(401, { error: { code: 'TERMINAL_SESSION_INVALID', message: '终端安全会话无效' } }))
        }
        if (!this.active) return route.fulfill(this.inactive())
        return route.fulfill(json(200, { sessionToken: this.issue(), expiresInSeconds: SESSION_TTL_MS / 1000 }))
      })
    })

    await page.route('**/api/v1/public/kiosk-profile', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      await this.guard(async () => {
        const presented = route.request().headers()['x-terminal-session-token'] ?? ''
        const verified = !this.forceUnverified && this.live(presented)
        const body = verified ? this.verifiedProfile(presented) : UNVERIFIED_KIOSK_PROFILE
        this.log.profile.push({ at: this.now(), verified, licenseState: body.licenseState })
        return route.fulfill(json(200, kioskProfileBody(body)))
      })
    })
  }

  /** 授权在这一刻失效：已签发的票不被掐断，但最多再用 endsInMs（后台一直是「凭证到期前都可用」）。 */
  lapse(endsInMs: number): void {
    this.active = false
    const latest = this.now() + endsInMs
    for (const [token, endsAt] of this.sessions) this.sessions.set(token, Math.min(endsAt, latest))
  }

  /** 授权恢复（续期、重新开通）。 */
  restore(): void {
    this.active = true
  }

  /** 当前最晚到期的那张有效票的到期时刻（ISO），没有则 null。 */
  currentEndsAt(): string | null {
    const live = [...this.sessions.values()].filter((endsAt) => endsAt > this.now())
    return live.length ? new Date(Math.max(...live)).toISOString() : null
  }

  /** 等到至少有一次验过签的 profile 回来（页面已用换到的票读到授权块）。 */
  async waitForVerifiedProfile(): Promise<void> {
    const deadline = Date.now() + 15_000
    while (!this.log.profile.some((entry) => entry.verified)) {
      if (Date.now() > deadline) throw new Error('页面一直没有拿到验过签的 kiosk-profile（换票没成功？）')
      await this.page.waitForTimeout(40)
    }
    await this.quiet()
    await this.sync()
    this.bootedAt ??= this.now()
  }

  /**
   * 把页面时钟推进 ms，按 step 一段一段走（定时器按先后触发，假服务端也看得到中间状态）。
   * active 为真时每段后动一下鼠标——人还在屏前，空闲清场的计时被顶回去；
   * 要模拟没人碰屏幕（待机、空闲）时传 false。
   *
   * 每一段里再切成不超过 3.5 秒的小步，每小步之后等在途请求落地：页面发请求都带 4 秒（换票、本机程序）或 8 秒（profile）的超时计时器，
   * 假时钟一口气跳 30 秒时，这些计时器可能抢在应答之前到点把请求中止（应答要走真实的进程间通信，假时钟的定时器却一个接一个飞快地跑完），
   * 页面于是读不到该读的东西，用例白白红一次。小步不超过 3.5 秒，请求在小步里发出、小步结束前一定来得及落地。
   */
  async advance(ms: number, options: { step?: number; active?: boolean } = {}): Promise<void> {
    const step = options.step ?? 30_000
    const active = options.active ?? true
    for (let left = ms; left > 0; left -= step) {
      const slice = Math.min(step, left)
      for (let rest = slice; rest > 0; rest -= REQUEST_SAFE_STEP_MS) {
        const small = Math.min(REQUEST_SAFE_STEP_MS, rest)
        // 推进期间触发的请求，假服务端看到的就是推进之后的时间。
        this.runTarget = this.now() + small
        try {
          await this.page.clock.runFor(small)
        } finally {
          this.runTarget = null
        }
        await this.sync()
        await this.landed()
      }
      if (active) await this.nudge()
      await this.quiet()
      await this.sync()
    }
  }

  /** 等在途请求落地（轻量版，每小步之后用；上限 3 秒，机器再忙也不无限等）。 */
  private async landed(): Promise<void> {
    const giveUp = Date.now() + 3_000
    while ((this.inFlight > 0 || this.pending.size > 0) && Date.now() < giveUp) await this.page.waitForTimeout(5)
  }

  /**
   * 一段一段推进页面时钟，直到 reached() 为真；推进满 limitMs 还没到就报错。返回实际推进的毫秒数。
   *
   */
  async advanceUntil(reached: () => Promise<boolean>, limitMs: number, options: { step?: number; active?: boolean } = {}): Promise<number> {
    const step = options.step ?? 30_000
    let spent = 0
    while (!(await reached())) {
      if (spent >= limitMs) throw new Error(`页面时钟推进了 ${limitMs / 60_000} 分钟，期望的状态还是没出现\n${this.describe()}`)
      await this.advance(step, { step, active: options.active })
      spent += step
    }
    return spent
  }

  /** 等在途请求都收尾，再让页面跑完排队的任务；断言「还没有 / 不会再」之前必须先过这一关。 */
  async quiet(): Promise<void> {
    const giveUp = Date.now() + 10_000
    for (let stable = 0; stable < 2 && Date.now() < giveUp; ) {
      stable = this.inFlight === 0 && this.pending.size === 0 ? stable + 1 : 0
      await this.page.waitForTimeout(60)
    }
    await this.page.evaluate(
      () => new Promise<void>((resolve) => {
        const channel = new MessageChannel()
        channel.port1.onmessage = () => resolve()
        channel.port2.postMessage(0)
      }),
    )
  }

  /** 失败时附在报错里的现场：开机后各次换票、续期、读 profile 的时刻（分钟）与在途请求。 */
  describe(): string {
    const at = this.bootedAt ?? this.base
    const min = (ms: number) => ((ms - at) / MINUTE).toFixed(2)
    const profiles = this.log.profile.slice(-8).map((entry) => `${min(entry.at)}:${entry.verified ? entry.licenseState : '未验签'}`)
    return [
      `现场（开机后分钟）：现在 ${min(this.now())}，授权${this.active ? '可用' : '失效'}`,
      `  换票 ${this.log.exchange.map(min).join(' ') || '无'}`,
      `  续期 ${this.log.refresh.map(min).join(' ') || '无'}`,
      `  最近 profile ${profiles.join(' ') || '无'}`,
      `  在途请求 ${[...this.pending].map((request) => new URL(request.url()).pathname).join(' ') || '无'}`,
    ].join('\n')
  }

  /** 屏上有人碰了一下：触发空闲计时的重置（pointer / mouse 事件）。 */
  async nudge(): Promise<void> {
    this.nudgeFlip = !this.nudgeFlip
    await this.page.mouse.move(this.nudgeFlip ? 12 : 14, 12)
  }

  private live(token: string): boolean {
    const endsAt = this.sessions.get(token)
    return endsAt !== undefined && endsAt > this.now()
  }

  private issue(): string {
    this.seq += 1
    const token = `terminal-session-${this.base.toString(36)}-${this.seq}`
    this.sessions.set(token, this.now() + SESSION_TTL_MS)
    return token
  }

  private inactive(): Parameters<Route['fulfill']>[0] {
    return json(403, { error: { code: 'TERMINAL_LICENSE_INACTIVE', message: '这台终端所在点位暂时不能提供服务' } })
  }

  private verifiedProfile(token: string): PublicKioskProfile {
    const endsAt = this.sessions.get(token) ?? this.now()
    return kioskProfile({
      ...this.brand,
      location: '青岛市人才市场一楼大厅',
      licenseState: this.active ? 'ok' : 'inactive',
      acceptsNewSessions: this.active,
      currentSessionMayContinue: true,
      currentSessionEndsAt: new Date(endsAt).toISOString(),
      noticeLine: this.active ? null : PAUSED_NOTICE_LINE,
    })
  }

  private async guard(work: () => Promise<unknown>): Promise<void> {
    this.inFlight += 1
    try {
      await work()
    } finally {
      this.inFlight -= 1
    }
  }
}
