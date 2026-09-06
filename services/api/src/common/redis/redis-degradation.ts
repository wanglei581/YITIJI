import { Logger } from '@nestjs/common'
import {
  BOOT_DEGRADED_LOG_MARKER,
  BOOT_RECOVERED_LOG_MARKER,
  REDIS_SUBSYSTEM,
  bootReadiness,
  readTimeoutMs,
  withDeadline,
  type BootImpactDeclaration,
} from '../boot/boot-readiness'

/**
 * Redis 故障时「请求期」的统一处置口径。
 *
 * 背景（实测复现，见 PR 正文）：Redis 不可达时 `JwtAuthGuard` 里那句
 * 无兜底的 `await this.redis.get()` 会以 MaxRetriesPerRequestError 冒泡成 500，
 * 每一个带守卫的管理端 / 合作机构端端点全挂，单请求实测耗时 **37.9s**
 * （不是 ioredis 名义上的 ~10.5s —— 守卫在一次请求里可能发多条命令）。
 * 与此同时 `/health` 明确宣称「管理端、合作机构端不受影响」。
 *
 * 本模块提供两件事：
 * 1. `tryRedis()` —— 有界、绝不抛出的 Redis 调用包装。等不到就放弃，
 *    由调用方决定「回源真源」还是「按缺失处理」，不把外部依赖故障变成 500。
 * 2. `REDIS_DEGRADED_IMPACT` —— 降级影响面的**机器可读**声明，
 *    启动期与请求期共用同一份，保证 `/health` 两条路径说的是同一句真话。
 */

/** 请求热路径上等 Redis 的上限。默认 500ms：本机/同机房正常往返远小于此值。 */
const DEFAULT_REDIS_REQUEST_TIMEOUT_MS = 500

/**
 * 已知不可用后的静默期。窗口内直接跳过 Redis，不再逐请求交超时学费
 * （实测：不跳过时一次管理端请求要为 get + set 各等 500ms）。
 * 窗口结束后**必须真的再试一次**，否则「不可用」会变成粘住的结论 ——
 * 这正是本仓启动韧性门禁 D 组要防的东西。
 */
const DEFAULT_REDIS_UNAVAILABLE_COOLDOWN_MS = 5_000

export const REDIS_REQUEST_TIMEOUT_ENV = 'REDIS_REQUEST_TIMEOUT_MS'
export const REDIS_UNAVAILABLE_COOLDOWN_ENV = 'REDIS_UNAVAILABLE_COOLDOWN_MS'

/** 请求期 Redis 等待超时。刻意区别于启动期的 BootDependencyTimeoutError。 */
export class RedisRequestTimeoutError extends Error {
  constructor(readonly operation: string, readonly timeoutMs: number) {
    super(`Redis 请求期等待超时：operation=${operation} timeoutMs=${timeoutMs}`)
    this.name = 'RedisRequestTimeoutError'
  }
}

export const REDIS_RUNTIME_DEGRADED_CODE = 'REDIS_UNAVAILABLE_AT_RUNTIME'

/**
 * Redis 不可用时各对外可观察面的真实处境。
 *
 * ⚠️ 这份声明会被 `verify:redis-degradation-truth` 门禁逐条**实际发请求**核对：
 * 声明 `unaffected` 的面必须真的 2xx，声明 `unavailable` 的面必须真的失败，
 * 声明 `degraded` 的面必须仍然成功。新增键而没有对应判据时门禁直接失败。
 * 因此改这里之前先想清楚：你有没有办法证明它。
 */
export const REDIS_DEGRADED_IMPACT: BootImpactDeclaration = {
  /** 管理端 / 合作机构端 / 一体机内部账号的 Bearer 鉴权：会话状态缓存失效，每请求回源数据库。 */
  'internal-auth': 'degraded',
  /** 管理端里直接对 Redis 写状态、且没有数据库真源可回退的动作（如退出时清理近期高风险验证）。 */
  'internal-console-redis-actions': 'unavailable',
  /** C 端会员登录会话 / 短信验证码 / 频控：Redis 就是真源，没有后备。 */
  'member-auth': 'unavailable',
  /** 终端 Agent 心跳 / 打印任务领取：整条链路不经过 Redis。 */
  'terminal-agent-print': 'unaffected',
}

/** 人读文案。与 REDIS_DEGRADED_IMPACT 同源，避免散文和结构化声明各说各话。 */
export function redisDegradedImpactSentence(): string {
  return (
    'C 端会员登录会话 / 短信验证码 / 频控与会员隐私清理调度不可用；'
    + '管理端、合作机构端、一体机内部账号的鉴权仍可用但已降级 —— '
    + '会话状态缓存失效，每个请求回源数据库校验（数据库是唯一真源，鉴权结论不变，代价是延迟与数据库负载上升）；'
    + '管理端中直接依赖 Redis 且无数据库真源的动作（如退出登录时清理近期高风险验证）仍会失败；'
    + '打印任务领取与终端 Agent 链路不经过 Redis，不受影响。'
  )
}

export type RedisAttempt<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'timeout' | 'error' | 'rejected' | 'skipped_cooldown'; errorName: string }

/**
 * 这次失败能否证明「连接不可用」。
 *
 * ioredis 的 `ReplyError` 是 **Redis 活着并回了一条错误**（WRONGTYPE、未知命令、
 * 参数个数不对、Lua 脚本报错……）。把它当成连通性故障会造成一次误伤扩散：
 * 任意一条命令被拒 → 全局静默期 → 期间所有 `tryRedis` 一律跳过，
 * 连本来会成功的调用也被跳过。实测代价是内部账号回写缓存失败（本身无害，
 * 数据库才是真源）把 **C 端会员会话** 一起打掉 5 秒，而会员会话没有数据库后备，
 * 直接表现为用户被登出（verify:content-pipeline-e2e 抓到过这条）。
 *
 * 所以只有超时与连接层错误才算不可用；命令被拒仍返回 ok:false，
 * 但不标降级、不进静默期。
 */
function isConnectivityFailure(error: unknown): boolean {
  if (error instanceof RedisRequestTimeoutError) return true
  const name = error instanceof Error ? error.name : ''
  return name !== 'ReplyError'
}

/** 静默期截止时间戳；0 表示当前不在静默期。进程内状态，多实例各自独立。 */
let cooldownUntil = 0

/** 仅供门禁/测试重置，业务代码不要调用。 */
export function resetRedisCooldownForTests(): void {
  cooldownUntil = 0
}

/**
 * 有界执行一次 Redis 调用，**绝不抛出**。
 *
 * 三种失败都以 `ok:false` 返回，由调用方决定是回源真源还是按缺失处理 ——
 * 本模块刻意不替调用方做「放行/拒绝」的决定，那是鉴权语义，必须写在守卫里。
 *
 * 首次观察到不可用时把 redis 子系统标为降级，让 `/health` 在「启动时好好的、
 * 跑着跑着挂了」这种情况下也说真话；日志只在状态翻转时打一条，
 * 避免每个请求刷一行把日志淹掉。
 */
export async function tryRedis<T>(
  operation: string,
  op: () => Promise<T>,
  logger?: Logger,
): Promise<RedisAttempt<T>> {
  const timeoutMs = readTimeoutMs(REDIS_REQUEST_TIMEOUT_ENV, DEFAULT_REDIS_REQUEST_TIMEOUT_MS)
  if (cooldownUntil > Date.now()) {
    return { ok: false, reason: 'skipped_cooldown', errorName: 'RedisUnavailableCooldown' }
  }
  try {
    const value = await withDeadline(op, {
      timeoutMs,
      makeTimeoutError: () => new RedisRequestTimeoutError(operation, timeoutMs),
    })
    noteRedisAvailable(logger)
    return { ok: true, value }
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError'
    if (!isConnectivityFailure(error)) {
      // Redis 回话了，只是拒了这条命令。调用方按取不到值处理，
      // 但不能据此判定整个 Redis 不可用，更不能连累其他调用方。
      return { ok: false, reason: 'rejected', errorName }
    }
    const reason = error instanceof RedisRequestTimeoutError ? 'timeout' : 'error'
    cooldownUntil = Date.now() + readTimeoutMs(
      REDIS_UNAVAILABLE_COOLDOWN_ENV,
      DEFAULT_REDIS_UNAVAILABLE_COOLDOWN_MS,
    )
    noteRedisUnavailable(operation, errorName, timeoutMs, logger)
    return { ok: false, reason, errorName }
  }
}

/**
 * 一次真实成功的调用即可证明 Redis 回来了 —— 清静默期。
 *
 * 也顺手把降级结论标回 ok：`RedisConnectivityService` 的 `client.on('ready')`
 * 只在连接**重新建立**时触发，而单条命令超时并不一定伴随断连，
 * 只靠它会让降级结论粘住（门禁 D 组防的正是这类粘住的假结论）。
 */
function noteRedisAvailable(logger?: Logger): void {
  cooldownUntil = 0
  if (!bootReadiness.isDegraded(REDIS_SUBSYSTEM)) return
  bootReadiness.markOk(REDIS_SUBSYSTEM, 'REDIS_REACHABLE', 'Redis 已恢复（请求期调用成功）。')
  logger?.log(`${BOOT_RECOVERED_LOG_MARKER} subsystem=${REDIS_SUBSYSTEM} source=request`)
}

function noteRedisUnavailable(
  operation: string,
  errorName: string,
  timeoutMs: number,
  logger?: Logger,
): void {
  // 启动期已经登记过降级（含同一份 impact）时不重复登记，否则 since 会被每个请求刷新。
  if (bootReadiness.isDegraded(REDIS_SUBSYSTEM)) return
  bootReadiness.markDegraded(
    REDIS_SUBSYSTEM,
    REDIS_RUNTIME_DEGRADED_CODE,
    `Redis 在运行期不可用（${timeoutMs}ms 内未完成 ${operation}，${errorName}）。`
      + redisDegradedImpactSentence()
      + '请检查 Redis 进程、网络与 REDIS_URL。',
    REDIS_DEGRADED_IMPACT,
  )
  logger?.error(
    `${BOOT_DEGRADED_LOG_MARKER} subsystem=${REDIS_SUBSYSTEM} code=${REDIS_RUNTIME_DEGRADED_CODE} `
      + `operation=${operation} timeoutMs=${timeoutMs} errorType=${errorName}`,
  )
}
