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
  ]
}

/**
 * 把某条路由的 `default` 桶换成「每台终端」计数。
 *
 * 用在一体机会**定时轮询**或**高频匿名调用**的路由上。`ip-wide` 兜底桶不受影响，
 * 因此单 IP 总量仍有天花板。
 *
 * @param limit 每终端每分钟允许的次数
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
