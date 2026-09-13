import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { SCAN_RETRY_AUTHORITY_TTL_MS } from './scan-tasks.service'

/**
 * `deliverScanFile()` 上传期间会通过 `startMatchedHeartbeat()`
 * （`scan-tasks.service.ts`，每 `SCAN_MATCHED_HEARTBEAT_INTERVAL_MS`=60 秒一次）
 * 持续刷新任务的 `updatedAt`，只要进程存活、上传仍在真实进行中，该任务就不会变
 * "stale"。这里的 3 分钟本质是"3 次心跳未到"的收敛窗口，不是"上传应在几秒内完成"
 * 的假设——真实上传可能因网络抖动合法地超过几秒，心跳机制正是为了防止 reaper
 * 把这类合法慢上传误判为卡死并删除已成功上传的文件。只有进程真崩溃（心跳随之停止）
 * 才会让任务在这 3 分钟窗口内变 stale，此时收敛为 'failed' 是正确行为——B1-2 的唯一
 * 约束意味着真正卡死的 'matched' 任务会挡住同终端后续所有扫描请求，收敛的紧迫性比
 * 'waiting' 过期更高。修改此常量前必须同步评估 `SCAN_MATCHED_HEARTBEAT_INTERVAL_MS`
 * 的间隔是否仍留有足够余量（当前为 3 倍心跳间隔）。
 */
const MATCHED_STUCK_TIMEOUT_MS = 3 * 60 * 1000

/**
 * 每分钟收敛卡在 'matched' 状态太久的扫描任务（B1-5）。
 *
 * 背景：服务器可能在 Agent 投递文件建档成功（CAS 到 matched）之后、
 * 最终 CAS 到 completed/failed 完成之前重启或崩溃，导致任务永久卡在 'matched'。
 * 叠加 B1-2 的 partial unique index（同一终端同时只能有一条 status IN
 * ('waiting','matched') 的活跃记录），一个永久卡死的 'matched' 任务会永久
 * 挡住该终端创建新的扫描会话，因此这个状态收敛的紧迫性高于 'waiting' 过期。
 *
 * 本任务只负责状态收敛，不负责文件孤儿处理：如果 'matched' 期间
 * `FilesService.upload()` 其实已经成功、只是后续 CAS-to-completed 没跑完就崩了，
 * reaper 会把任务标记 failed，但已经建好的 FileObject 不会被自动关联或删除，
 * 会变成孤儿文件，等它自己的 TTL 到期被 `FilesCleanupTask` 处理掉——这是可接受的，
 * 孤儿文件仍然受 id_scan/resume_scan/print_doc 短留存策略约束。
 *
 * 另见 reapExpiredWaiting：expiresAt 已到的 'waiting' 行若无人查询，getStatus() 的
 * 惰性过期不会落盘，同一条 partial unique index 会继续把该终端锁死。那条路径只匹配
 * waiting + expiresAt<=now，不得改写 matched 或其他终态。
 */
@Injectable()
export class ScanTaskReaperTask {
  private readonly logger = new Logger(ScanTaskReaperTask.name)

  constructor(private readonly prisma: PrismaService) {}

  // 返回值（{ count }）供测试直接断言一次 reap 命中的行数（例如同一 tick 内多个不同终端的
  // 卡死任务应该一次性全部收敛）；@Cron 调度器本身会丢弃返回值，不影响生产路径。
  @Cron(CronExpression.EVERY_MINUTE)
  async reapStuckMatched(): Promise<{ count: number }> {
    const staleThreshold = new Date(Date.now() - MATCHED_STUCK_TIMEOUT_MS)
    const retryAuthorityExpiresAt = new Date(Date.now() + SCAN_RETRY_AUTHORITY_TTL_MS)
    try {
      const retryable = await this.prisma.scanTask.updateMany({
        where: {
          status: 'matched',
          updatedAt: { lt: staleThreshold },
          lastAttemptHash: { not: null },
        },
        data: {
          status: 'failed',
          errorCode: 'SCAN_MATCHED_TIMEOUT',
          errorMessage: '扫描处理超时未完成',
          retryAuthorityExpiresAt,
        },
      })
      const nonRetryable = await this.prisma.scanTask.updateMany({
        where: {
          status: 'matched',
          updatedAt: { lt: staleThreshold },
          lastAttemptHash: null,
        },
        data: {
          status: 'failed',
          errorCode: 'SCAN_MATCHED_TIMEOUT',
          errorMessage: '扫描处理超时未完成',
          retryAuthorityExpiresAt: null,
        },
      })
      const count = retryable.count + nonRetryable.count
      if (count > 0) {
        this.logger.warn(`reaped ${count} scan task(s) stuck in 'matched' beyond timeout`)
      }
      return { count }
    } catch (err) {
      this.logger.error(`matched-state reaper failed: ${(err as Error).message}`)
      return { count: 0 }
    }
  }

  /**
   * 每分钟把已经过期但仍停在 'waiting' 的扫描任务条件更新为 'expired'。
   *
   * where 必须同时钉死 status='waiting' 与 expiresAt<=now：不得把 matched / completed /
   * cancelled / failed / 未到期 waiting 改写成 expired。matched 卡死仍只由
   * reapStuckMatched() 按 updatedAt 收敛为 failed。
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async reapExpiredWaiting(): Promise<{ count: number }> {
    const now = new Date()
    try {
      const result = await this.prisma.scanTask.updateMany({
        where: { status: 'waiting', expiresAt: { lte: now } },
        data: { status: 'expired', retryAuthorityExpiresAt: null },
      })
      if (result.count > 0) {
        this.logger.warn(`reaped ${result.count} waiting scan task(s) past expiresAt`)
      }
      return { count: result.count }
    } catch (err) {
      this.logger.error(`waiting-expiry reaper failed: ${(err as Error).message}`)
      return { count: 0 }
    }
  }
}
