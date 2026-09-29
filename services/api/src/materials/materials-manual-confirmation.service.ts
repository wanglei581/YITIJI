import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import { MaterialsService } from './materials.service'
import type { DocumentProcessTaskView, MaterialsRequester } from './materials.types'

/**
 * 隐私检查没有完整覆盖文件时的「本人确认」留痕（A-04，2026-09-29，主执行窗口采纳的提案 B）。
 *
 * 隐私扫描的结论有三种不完整：`partial`（页数截断，后面几页没看）、`degraded`（识别不可用或抽不出字）、
 * `unsupported_format`。AI 只加速不设卡：这时不能一刀切拒绝打印，而是让本人确认「文件里没有不想打印的
 * 个人信息」后继续，并在服务端记下是谁（请求方类型）、哪一次扫描、什么时候确认的。
 *
 * - 只绑定这一次扫描任务：同一原件重扫会建新任务，旧确认不继承（建单闸门只看最新一次扫描）。
 * - 幂等：重复确认返回 200，`manualConfirmedAt` 不变。
 * - 审计只记元数据：任务号、mode、请求方类型。不记文件名，也不记识别出的文字。
 *
 * 为什么单独成文件：materials.service.ts 已 744 行，且多条门禁直接 new MaterialsService(4 个参数)，
 * 这里需要审计服务，放进去就要改它的构造参数。
 */
export const PII_MANUAL_CONFIRMABLE_MODES = new Set(['partial', 'degraded', 'unsupported_format'])

@Injectable()
export class MaterialsManualConfirmationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly materials: MaterialsService,
  ) {}

  async confirm(taskId: string, requester: MaterialsRequester): Promise<DocumentProcessTaskView> {
    // getTask 负责存在、过期与归属（会员本人或匿名任务令牌）三项校验。
    const view = await this.materials.getTask(taskId, requester)
    if (view.kind !== 'pii_scan') {
      throw new BadRequestException({ error: { code: 'MATERIAL_TASK_KIND_INVALID', message: '只有隐私检查任务需要本人确认' } })
    }
    if (view.status !== 'completed') {
      throw new ConflictException({ error: { code: 'MATERIAL_TASK_NOT_READY', message: '隐私检查还没有结束，请稍后再确认' } })
    }
    const mode = typeof view.result?.['mode'] === 'string' ? view.result['mode'] : ''
    if (!PII_MANUAL_CONFIRMABLE_MODES.has(mode)) {
      throw new ConflictException({
        error: { code: 'MATERIAL_MANUAL_CONFIRM_NOT_NEEDED', message: '这份文件的隐私检查已经完整覆盖，不需要另行确认' },
      })
    }
    if (typeof view.result?.['manualConfirmedAt'] === 'string') return view

    const row = await this.prisma.documentProcessTask.findUnique({ where: { id: taskId }, select: { resultJson: true } })
    const current = parseObject(row?.resultJson ?? null)
    const confirmedAt = new Date().toISOString()
    // 以读到的原值做比较再写：两次并发确认只有一次写入，另一次读回已有的确认时间。
    const updated = await this.prisma.documentProcessTask.updateMany({
      where: { id: taskId, resultJson: row?.resultJson ?? null },
      data: { resultJson: JSON.stringify({ ...current, manualConfirmedAt: confirmedAt }) },
    })
    if (updated.count === 0) {
      const again = await this.materials.getTask(taskId, requester)
      if (typeof again.result?.['manualConfirmedAt'] === 'string') return again
      throw new ConflictException({ error: { code: 'MATERIAL_TASK_CHANGED', message: '检查结果刚刚有变化，请重新打开后再确认' } })
    }
    await this.audit.write({
      actorId: null,
      actorRole: requester.kind === 'member' ? 'member' : 'anonymous',
      action: 'material_task.pii_manual_confirmed',
      targetType: 'document_process_task',
      targetId: taskId,
      payload: { mode, requesterKind: requester.kind, confirmedAt },
    })
    return this.materials.getTask(taskId, requester)
  }
}

function parseObject(json: string | null): Record<string, unknown> {
  if (!json) return {}
  try {
    const parsed = JSON.parse(json) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}
