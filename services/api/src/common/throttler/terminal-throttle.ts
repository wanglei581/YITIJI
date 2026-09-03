// ============================================================================
// 限流计数维度：终端 / 会话感知
//
// 背景（为什么必须有这个文件）
// ---------------------------------------------------------------------------
// 全局 ThrottlerGuard 默认按 `req.ip` 计数，而 @nestjs/throttler 的
// storage key = sha256(`${ControllerName}-${handlerName}-${throttlerName}-${tracker}`)
// （见 node_modules/@nestjs/throttler/dist/throttler.guard.js `generateKey`）。
// 也就是说桶是「每路由 × 每 tracker」的——路由之间不串桶，但**同一路由下
// 所有共用出口 IP 的客户端串在同一个桶里**。
//
// 线下一体机的部署形态正好踩中这一点：一个人才市场大厅里的 N 台一体机走同一条
// 宽带、同一个 NAT 出口 IP。于是「按 IP 计数」实际等于「按大厅计数」：
//
//   GET /print/jobs/:taskId 由 PrintProgressPage 每 3 秒轮询一次
//   → 单台机器 20 次/分钟 → 3 台机器同时打印 = 60 次/分钟 = 打满默认桶
//   → 第 4 次轮询 429 → 前端 catch 分支显示「无法连接打印服务」
//
//   GET /materials/tasks/:id 由 PrintMaterialCheckPage 每 1 秒轮询、最多 30 次
//   → 单台机器 30 秒吃掉半个桶 → 2 台机器同时做材料检查就撞线
//
// 症状会伪装成「后端挂了」，而且**加机器只会让它更早发生**。
//
// 为什么不是「把 limit 调大」
// ---------------------------------------------------------------------------
// 调大只是把爆炸点从第 3 台推到第 10 台。错的是计数维度，不是阈值：
// 大厅里 10 台机器本来就应该有 10 份配额，而不是分一份。
//
// 为什么不是「全局把 tracker 换成终端」
// ---------------------------------------------------------------------------
// `x-terminal-id` 是客户端可伪造的请求头（这些端点本就匿名，没有设备鉴权）。
// 如果全局改成按终端计数，攻击者只要每次请求换一个终端 ID，就能绕过
// /auth/login 的 5 次/分钟字典爆破防线——那是把可用性问题换成了安全问题。
//
// 所以本文件的口径是：
//
//   1. `default` 桶维持纯 IP 计数不变 → 所有现有路由（含 /auth/login）安全姿态零变化；
//   2. 需要「按台计数」的路由**显式**打 `@TerminalScopedThrottle()`，
//      只有这些路由的 default 桶换成 (IP + 终端/会话) 复合维度；
//   3. 新增一条全局 `ip-wide` 纯 IP 兜底桶，限额宽松但存在——
//      伪造终端 ID 可以换到更多**请求数**，但换不到无限请求。
//
// 复合 key 里保留 IP 是刻意的：伪造终端头只能在**自己这个 IP 名下**开新桶，
// 既偷不到别的 IP 的额度，也逃不出 ip-wide 的天花板。
//
// 终端标识从哪来（取证结论）
// ---------------------------------------------------------------------------
// `x-terminal-id` 是本仓已成型的约定，不是本次发明的：
//   - 服务端已有 8 处读取（job-ai / job-fit 的配额维度、trtc、member-auth、
//     member-privacy、terminals、print-jobs claim-pickup 等）；
//   - Kiosk 侧 `getTerminalId()`（apps/kiosk/src/services/api/screensaver.ts）
//     的值来自本机 Terminal Agent 的回环接口，不是构建期写死的
//     `VITE_TERMINAL_ID`（那个只在 `import.meta.env.DEV` 下兜底）；
//     生产上取不到身份时返回空串，属于 fail-closed。
//
// 取不到终端标识时的退化顺序：终端 → 会话（Authorization 摘要）→ 纯 IP。
// 退化到纯 IP 就是今天的行为，不会比现状更差。
// ============================================================================

import { createHash } from 'node:crypto'
import { Throttle } from '@nestjs/throttler'
import type { ThrottlerOptions } from '@nestjs/throttler'
import { resolveClientIpOrUnknown } from '../client-ip'

/** 计数窗口：1 分钟。与仓库内既有 @Throttle 写法保持一致。 */
export const THROTTLE_WINDOW_MS = 60_000

/** `default` 桶限额（纯 IP）。维持改动前的数值，不放宽。 */
export const THROTTLE_DEFAULT_LIMIT = 60

/**
 * 全局纯 IP 兜底桶限额（次/分钟/路由）。
 *
 * 它的职责不是精细限流，而是给「终端维度可被伪造」兜底：无论请求头怎么换，
 * 单个出口 IP 在单个路由上的总量仍有天花板。
 *
 * 默认 1200 的来历（按最凶的轮询端点算）：
 *   - GET /materials/tasks/:id 每 1 秒轮询 = 60 次/分钟/台
 *   - 1200 ÷ 60 = 同一大厅可有 20 台机器同时处于材料检查窗口
 *   - GET /print/jobs/:taskId 每 3 秒轮询 = 20 次/分钟/台 → 可支撑 60 台同时打印
 *
 * 超大厅（>20 台且轮询高度重叠）请上调 `THROTTLE_IP_WIDE_PER_MINUTE`。
 * 注意：改动前所有路由的每 IP 上限都 ≤ 60，因此这条兜底桶对既有路由永不生效，
 * 只对下面显式声明了终端维度的路由起作用。
 */
export function resolveIpWideLimit(): number {
  const raw = Number(process.env['THROTTLE_IP_WIDE_PER_MINUTE'])
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1200
}

/** 兜底桶名。@Throttle({ default: ... }) 不会覆盖它，因此天花板始终在。 */
export const IP_WIDE_THROTTLER_NAME = 'ip-wide'

/**
 * 会花钱的 AI 路由专用的「每 IP 每小时」花费天花板桶。
 *
 * 为什么需要第三个桶：把 default 从纯 IP 换成按客户端之后，**单个大厅的总量
 * 被放大了 N 倍**（10 台机器各 6 次/分钟 = 60 次/分钟，而不是原来的 6）。
 * 对只读轮询端点这没关系，对按次计费的模型调用则等于成本上限放大 10 倍。
 *
 * 所以调 LLM 的路由额外挂一层**纯 IP、按小时**的桶：
 *   - default（按客户端 / 分钟）→ 保证同一大厅的机器之间不互相抢额度；
 *   - ai-ip（纯 IP / 小时）    → 不可伪造的花费天花板，换请求头也逃不掉。
 * 这正是 #698 里 assistant/chat 的分层思路（member/terminal 做细粒度，
 * ip 做不可伪造的花费封顶），只是从「日配额服务」下沉成了限流桶。
 */
export const AI_IP_THROTTLER_NAME = 'ai-ip'

const AI_IP_WINDOW_MS = 60 * 60 * 1000

/**
 * `@Throttle({ 'ai-ip': ... })` 会写下的元数据键（`THROTTLER_LIMIT + 名字`）。
 *
 * 这个字符串是和 @nestjs/throttler 内部常量的约定。约定一旦失效，skipIf 会
 * 「永远跳过」，天花板静默失灵 —— 属于最难发现的那类故障，所以
 * verify:ai-throttle-dimension 有一条断言专门证明这个键真的被写下了。
 */
export const AI_IP_LIMIT_METADATA_KEY = 'THROTTLER:LIMITai-ip'

/** 默认每 IP 每小时的付费 AI 调用上限。 */
export function resolveAiIpHourlyCeiling(): number {
  const raw = Number(process.env['AI_IP_HOURLY_CEILING'])
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 300
}

/**
 * ai-ip 桶只对显式声明了它的路由生效，其余 400+ 条路由直接跳过，
 * 不做无谓的计数。判据就是「这条路由有没有写下 ai-ip 的 limit 元数据」。
 */
function skipUnlessPaidAiRoute(context: {
  getHandler: () => object
  getClass: () => object
}): boolean {
  const reflectApi = Reflect as unknown as {
    getMetadata?: (key: string, target: object) => unknown
  }
  if (typeof reflectApi.getMetadata !== 'function') return true
  const onHandler = reflectApi.getMetadata(AI_IP_LIMIT_METADATA_KEY, context.getHandler())
  if (onHandler !== undefined) return false
  const onClass = reflectApi.getMetadata(AI_IP_LIMIT_METADATA_KEY, context.getClass())
  return onClass === undefined
}

type HeaderBag = Record<string, string | string[] | undefined>

function headerOf(req: unknown, name: string): string | null {
  if (!req || typeof req !== 'object') return null
  const headers = (req as { headers?: HeaderBag }).headers
  if (!headers) return null
  const raw = headers[name]
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/**
 * 摘要化后再进 key。
 *
 * 两个理由：
 *   1. Authorization 是凭证，不能以明文形态进入任何存储 key；
 *   2. 终端 ID 长度不可控，摘要后 key 长度恒定。
 * 与 job-ai-quota.service.ts 的 sha256 维度摘要口径一致。
 */
function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 32)
}

/** 与 job-ai / job-fit 的 terminalIdOf 保持同一口径（含 64 字符截断）。 */
export function throttleTerminalIdOf(req: unknown): string | null {
  return headerOf(req, 'x-terminal-id')?.slice(0, 64) ?? null
}

/**
 * 终端 / 会话感知的 tracker。
 *
 * 同一 IP 下：
 *   - 不同 `x-terminal-id` → 不同 tracker → **不共享配额**（本次要修的核心）
 *   - 无终端但有不同 Authorization → 不同 tracker（小程序走运营商 NAT 时同样受益）
 *   - 都没有 → 退化成纯 IP，即改动前的行为
 */
export function resolveTerminalScopedTracker(req: unknown): string {
  const ip = resolveClientIpOrUnknown(req)

  const terminal = throttleTerminalIdOf(req)
  if (terminal) return `${ip}|t:${digest(terminal)}`

  const authorization = headerOf(req, 'authorization')
  if (authorization) return `${ip}|s:${digest(authorization)}`

  return `${ip}|-`
}

/** 纯 IP tracker（`default` 与 `ip-wide` 共用），等价于 throttler 的内置默认实现。 */
export function resolveIpTracker(req: unknown): string {
  return resolveClientIpOrUnknown(req)
}

/**
 * 全局 ThrottlerModule 配置。
 *
 * `default` 的 ttl / limit / tracker 与改动前完全一致；新增的只有 `ip-wide`。
 */
export function buildThrottlerConfig(): ThrottlerOptions[] {
  return [
    {
      name: 'default',
      ttl: THROTTLE_WINDOW_MS,
      limit: THROTTLE_DEFAULT_LIMIT,
      getTracker: resolveIpTracker,
    },
    {
      name: IP_WIDE_THROTTLER_NAME,
      ttl: THROTTLE_WINDOW_MS,
      limit: resolveIpWideLimit(),
      getTracker: resolveIpTracker,
    },
    {
      // 只对 @PaidAiThrottle 声明过的路由生效（见 skipUnlessPaidAiRoute）。
      name: AI_IP_THROTTLER_NAME,
      ttl: AI_IP_WINDOW_MS,
      limit: resolveAiIpHourlyCeiling(),
      getTracker: resolveIpTracker,
      skipIf: skipUnlessPaidAiRoute,
    },
  ]
}

/**
 * 把某条路由的 `default` 桶换成「每个客户端」计数。
 *
 * 名字里的 Terminal 是历史包袱（首次落地时只服务一体机轮询）。实际维度是
 * `resolveTerminalScopedTracker` 的退化链：
 *
 *     IP + 终端(x-terminal-id) → IP + 会话(Authorization 摘要) → 纯 IP
 *
 * 所以它同时覆盖两类调用方：
 *   - 一体机：大厅共用 NAT 出口 IP，靠终端维度拆开；
 *   - 小程序 / 会员 Web：无终端标识，但有会员 token，靠会话维度拆开
 *     （运营商 CGNAT 同样会让大量手机共用出口 IP）。
 *
 * 完全匿名且无终端的调用方退化成纯 IP，即未声明维度时的行为，不会更差。
 * `ip-wide` 兜底桶不受影响，因此单 IP 总量始终有天花板。
 *
 * @param limit 每客户端每分钟允许的次数
 */
export function TerminalScopedThrottle(limit: number): MethodDecorator & ClassDecorator {
  return Throttle({
    default: {
      ttl: THROTTLE_WINDOW_MS,
      limit,
      getTracker: resolveTerminalScopedTracker,
    },
  })
}

/**
 * 会花钱的 AI 路由：按客户端计分钟额度 + 按 IP 计小时花费天花板。
 *
 * 只改维度而不加天花板是不够的：一个大厅 10 台机器各 6 次/分钟，
 * 相对改动前的「整个大厅共用 6 次/分钟」，成本上限被放大了 10 倍。
 *
 * @param perClientPerMinute 每客户端（终端/会话）每分钟的调用次数
 * @param perIpPerHour       每出口 IP 每小时的调用次数；缺省用 AI_IP_HOURLY_CEILING
 */
export function PaidAiThrottle(
  perClientPerMinute: number,
  perIpPerHour?: number,
): MethodDecorator & ClassDecorator {
  return Throttle({
    default: {
      ttl: THROTTLE_WINDOW_MS,
      limit: perClientPerMinute,
      getTracker: resolveTerminalScopedTracker,
    },
    [AI_IP_THROTTLER_NAME]: {
      ttl: AI_IP_WINDOW_MS,
      limit: perIpPerHour ?? resolveAiIpHourlyCeiling(),
      getTracker: resolveIpTracker,
    },
  })
}

/**
 * 显式声明「这条路由**就该**按纯 IP 计数」。
 *
 * 行为上等价于不写任何 tracker（`default` 本来就是纯 IP），存在的意义是**把沉默
 * 变成表态**：`verify:ai-throttle-dimension` 要求每条会花钱的 AI 路由都必须在
 * 两个维度里显式选一个，漏写即 CI 红。没有这个装饰器的话，「忘了想」和
 * 「想过了，IP 是对的」在代码里长得一模一样。
 *
 * 什么时候该用它：**被计数的主体正是攻击者能任意更换的那个东西**。
 * 典型是凭证爆破 —— 按会话计数等于「每换一个 token 就重置一次额度」，
 * 那正是攻击者免费拥有的能力。这种路由必须锚在 IP 上。
 *
 * @param limit  每 IP 每分钟允许的次数
 * @param reason 为什么这条路由不能按客户端计数（写给下一个读代码的人，门禁要求非空）
 */
export function IpScopedThrottle(limit: number, reason: string): MethodDecorator & ClassDecorator {
  if (!reason.trim()) {
    throw new Error('IpScopedThrottle 必须写明为什么这条路由只能按 IP 计数')
  }
  return Throttle({
    default: {
      ttl: THROTTLE_WINDOW_MS,
      limit,
      getTracker: resolveIpTracker,
    },
  })
}

/**
 * 已认证写操作：按 Authorization 摘要计数，**不含 IP**。
 *
 * 与 {@link IpScopedThrottle} 相反的场景：被计数的主体是「这个登录会话」，
 * 攻击者换出口 IP 不该换到一份新配额。典型是被盗 partner JWT 对轮换密钥
 * 发空 body——按 IP 计时换一个 NAT 就重置 10 次/分钟。
 *
 * 无 Authorization 时退化成纯 IP，避免这条路由在登录前被匿名打穿。
 * ThrottlerGuard 是 APP_GUARD、跑在 JwtAuthGuard 之前，但请求头里的
 * Bearer 此时已经在，不需要等 req.user。
 *
 * 这挡不住「攻击者还能登录、每次换新 JWT」——那是密码失窃，不是会话失窃。
 *
 * @param limit  每会话每分钟允许的次数
 * @param reason 为什么这条路由不能按 IP 计数（写给下一个读代码的人）
 */
export function resolveAuthScopedTracker(req: unknown): string {
  const authorization = headerOf(req, 'authorization')
  if (authorization) return `s:${digest(authorization)}`
  return `ip:${resolveClientIpOrUnknown(req)}`
}

export function AuthScopedThrottle(limit: number, reason: string): MethodDecorator & ClassDecorator {
  if (!reason.trim()) {
    throw new Error('AuthScopedThrottle 必须写明为什么这条路由按会话而不是按 IP 计数')
  }
  return Throttle({
    default: {
      ttl: THROTTLE_WINDOW_MS,
      limit,
      getTracker: resolveAuthScopedTracker,
    },
  })
}
