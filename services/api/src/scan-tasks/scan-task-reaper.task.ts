import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'

/**
 * `deliverScanFile()` 从 CAS 到 'matched' 到 CAS 到 'completed'/'failed' 之间只有一次
 * `FilesService.upload()` 调用（读内存 buffer + 写存储 + 建 DB 行），正常应在几秒内完成；
 * 取 3 分钟留足够余量覆盖存储抖动，同时不让一个真正卡死的任务占着"当前活跃会话"的名额太久
 * （B1-2 的唯一约束意味着卡死的 'matched' 任务会挡住同终端后续所有扫描请求，收敛这个状态的
 * 紧迫性比 'waiting' 过期更高）。
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
    try {
      const result = await this.prisma.scanTask.updateMany({
        where: { status: 'matched', updatedAt: { lt: staleThreshold } },
        data: { status: 'failed', errorCode: 'SCAN_MATCHED_TIMEOUT', errorMessage: '扫描处理超时未完成' },
      })
      if (result.count > 0) {
        this.logger.warn(`reaped ${result.count} scan task(s) stuck in 'matched' beyond timeout`)
      }
      return { count: result.count }
    } catch (err) {
      this.logger.error(`matched-state reaper failed: ${(err as Error).message}`)
      return { count: 0 }
    }
  }
}
