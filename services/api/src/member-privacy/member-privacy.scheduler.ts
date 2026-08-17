import { InjectQueue } from '@nestjs/bullmq'
import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common'
import type { Queue } from 'bullmq'
import {
  BOOT_DEGRADED_LOG_MARKER,
  BOOT_RECOVERED_LOG_MARKER,
  MEMBER_PRIVACY_SCHEDULER_SUBSYSTEM,
  bootReadiness,
  readTimeoutMs,
  withBootTimeout,
} from '../common/boot/boot-readiness'
import {
  MEMBER_EXPORT_RECONCILE_JOB,
  MEMBER_PRIVACY_QUEUE,
  type MemberExportReconcileJobData,
  type MemberPrivacyJobData,
} from './member-privacy.queue'

const RECONCILE_SCHEDULER_ID = 'member-export-reconcile-sweep-v1'
/** 注册调度器的有界等待。默认 8s：本机/同机房 Redis 远快于此，够宽松也够短。 */
const DEFAULT_REGISTRATION_TIMEOUT_MS = 8_000

/**
 * 会员数据导出对账扫描的 BullMQ 调度器注册。
 *
 * ⚠ 这里曾是整个 API 的启动挂起点：`upsertJobScheduler()` 在 Redis 不可达时
 * **永不 settle**（BullMQ 给自建连接强制 `maxRetriesPerRequest: null`，
 * ioredis 把命令无限排进 offline queue，既不报错也不超时），
 * 于是 `onModuleInit` 永远不返回，`app.listen()` 永远到不了，
 * 进程活着、端口是死的、日志里没有任何启动失败线索。
 * 原来的 `try/catch` 是死代码 —— promise 从不 reject，catch 永远命中不了。
 *
 * 现在：有界等待 + 显式降级（不抛错、不静默）。
 * 超时后原始命令仍留在 ioredis 的 offline queue 里，Redis 恢复连接时会被自动发出，
 * 届时 `onSettleAfterTimeout` 把子系统标回 ok —— 不需要额外的重试轮询。
 */
@Injectable()
export class MemberPrivacyScheduler implements OnModuleInit {
  private readonly logger = new Logger(MemberPrivacyScheduler.name)

  constructor(
    @Optional() @InjectQueue(MEMBER_PRIVACY_QUEUE)
    private readonly queue?: Queue<MemberPrivacyJobData>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.queue) {
      // 未配置 REDIS_URL 时队列本就不注册（见 member-privacy.module.ts）。
      // 这不是故障，但也不能假装调度在跑 —— 如实登记为降级。
      bootReadiness.markDegraded(
        MEMBER_PRIVACY_SCHEDULER_SUBSYSTEM,
        'EXPORT_SCHEDULER_QUEUE_ABSENT',
        '未配置 REDIS_URL，会员数据导出对账扫描调度未注册（不影响用户主动发起的导出请求）。',
      )
      return
    }

    const timeoutMs = readTimeoutMs('MEMBER_PRIVACY_SCHEDULER_TIMEOUT_MS', DEFAULT_REGISTRATION_TIMEOUT_MS)
    const data: MemberExportReconcileJobData = { reason: 'periodic_sweep' }

    try {
      await withBootTimeout(() => this.register(data), {
        subsystem: MEMBER_PRIVACY_SCHEDULER_SUBSYSTEM,
        operation: 'upsertJobScheduler',
        timeoutMs,
        onSettleAfterTimeout: (result) => this.onLateSettle(result),
      })
      bootReadiness.markOk(
        MEMBER_PRIVACY_SCHEDULER_SUBSYSTEM,
        'EXPORT_SCHEDULER_REGISTERED',
        '会员数据导出对账扫描调度已注册（每 60s 一次）。',
      )
    } catch (error) {
      const message =
        `会员数据导出对账扫描调度未注册（${timeoutMs}ms 内 Redis 未响应或注册失败）。` +
        // 「不受影响」必须限定到本子系统自身的因果范围内：本调度缺席不阻断导出请求，
        // 但同一次 Redis 故障会让 C 端会员登录本身不可用（见 redis 子系统），
        // 不加这句限定就会被读成「会员导出照常可用」。
        '已过期的导出文件不会被周期性回收，需人工关注；' +
        '本调度缺席本身不阻断用户主动发起的导出请求（Redis 故障对 C 端会员登录的影响见 redis 子系统）。' +
        'Redis 恢复连接后本调度会自动补注册，无需重启。'
      bootReadiness.markDegraded(MEMBER_PRIVACY_SCHEDULER_SUBSYSTEM, 'EXPORT_SCHEDULER_UNAVAILABLE', message)
      this.logger.error(
        `${BOOT_DEGRADED_LOG_MARKER} subsystem=${MEMBER_PRIVACY_SCHEDULER_SUBSYSTEM} ` +
          `code=EXPORT_SCHEDULER_UNAVAILABLE timeoutMs=${timeoutMs} errorType=${safeErrorType(error)}`,
      )
      this.logger.error(message)
    }
  }

  /** 迟到结果：Redis 恢复后 offline queue 里的注册命令终于执行完了。 */
  private onLateSettle(result: { ok: true; value: unknown } | { ok: false; error: unknown }): void {
    if (result.ok) {
      bootReadiness.markOk(
        MEMBER_PRIVACY_SCHEDULER_SUBSYSTEM,
        'EXPORT_SCHEDULER_REGISTERED',
        '会员数据导出对账扫描调度已在 Redis 恢复后补注册。',
      )
      this.logger.log(
        `${BOOT_RECOVERED_LOG_MARKER} subsystem=${MEMBER_PRIVACY_SCHEDULER_SUBSYSTEM} code=EXPORT_SCHEDULER_REGISTERED`,
      )
      return
    }
    this.logger.error(
      `${BOOT_DEGRADED_LOG_MARKER} subsystem=${MEMBER_PRIVACY_SCHEDULER_SUBSYSTEM} ` +
        `code=EXPORT_SCHEDULER_UNAVAILABLE phase=late errorType=${safeErrorType(result.error)}`,
    )
  }

  private register(data: MemberExportReconcileJobData): Promise<unknown> {
    // queue 的存在性已在 onModuleInit 入口判过；这里只做调用。
    return this.queue!.upsertJobScheduler(
      RECONCILE_SCHEDULER_ID,
      { every: 60_000 },
      {
        name: MEMBER_EXPORT_RECONCILE_JOB,
        data,
        opts: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: { age: 86_400 },
          removeOnFail: { age: 7 * 86_400 },
        },
      },
    )
  }
}

function safeErrorType(error: unknown): string {
  const value = error instanceof Error ? error.name : typeof error
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(value) ? value : 'UnknownError'
}
