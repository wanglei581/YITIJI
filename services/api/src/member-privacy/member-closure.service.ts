import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { decryptPhone } from '../common/crypto/phone-identity'
import { FilesService } from '../files/files.service'
import { PrismaService, type PrismaTransactionClient } from '../prisma/prisma.service'
import { badRequest, conflict, unavailable } from './member-data-request.helpers'
import { MemberClosureRedisService } from './member-closure-redis.service'
import { discoverClosureFiles } from './member-closure-files'
import { closureActiveKey } from './member-closure-requests'
import { closureTextScrubber, newClosurePhoneIdentity, readClosureRetentionYears, retainClosureRecords } from './member-closure-retention'
import { runSerializableTransaction } from './member-privacy.service'

export interface MemberClosureInput {
  source: 'member_request' | 'offline'
  reasonText: string
  phoneLast4: string
  offlineEvidenceNo?: string
}

interface ClosureProgress {
  source: MemberClosureInput['source']
  reasonText: string
  offlineEvidenceNo?: string
  deleted: Record<string, number>
  retained: Record<string, number>
  fileIds?: string[]
  objectStorageFailures: number
}

// 删除顺序：先删依赖文件的任务，再删 FileObject；会话的派生表由 FK Cascade 清掉。
export const CLOSURE_DELETE_MODELS = ['aiResumeResult', 'mockInterviewSession', 'advisorSession',
  'jobAiSession', 'contractReviewTask', 'documentProcessTask', 'scanTask', 'browseLog',
  'externalJumpLog', 'favorite', 'jobApplication', 'memberNotification', 'broadcastReadState'] as const
const TERMINAL_PRINT_STATUSES = ['completed', 'failed', 'cancelled']
// 订单层面的终态另含过期；已关闭、已过期的订单不算在途，否则放弃过的订单会让注销永远执行不了。
const TERMINAL_ORDER_TASK_STATUSES = [...TERMINAL_PRINT_STATUSES, 'expired']
const PAID_STATUSES = ['paid', 'partial_refunded']
const DEAD_PICKUP_STATUSES = ['expired', 'cancelled']

@Injectable()
export class MemberClosureService {
  readonly retentionYears = readClosureRetentionYears()

  constructor(private readonly prisma: PrismaService, private readonly files: FilesService,
    private readonly redis: MemberClosureRedisService, private readonly audit: AuditService) {}

  async execute(endUserId: string, input: MemberClosureInput, actor: { userId: string; role: string }) {
    if (actor.role !== 'admin') throw new ForbiddenException({ error: { code: 'FORBIDDEN', message: '仅管理员可执行注销' } })
    this.validate(input)
    return this.redis.withLock(endUserId, async (assertLease) => {
      const initial = await this.prisma.endUser.findUnique({ where: { id: endUserId } })
      if (!initial) throw new NotFoundException({ error: { code: 'ADMIN_USER_NOT_FOUND', message: '用户不存在' } })
      if (initial.status === 'anonymized') return { endUserId, status: 'anonymized' as const, changed: false }
      if (decryptPhone(initial.phoneEnc).slice(-4) !== input.phoneLast4) {
        throw badRequest('CLOSURE_PHONE_MISMATCH', '手机号尾号核验不通过')
      }
      const scrub = closureTextScrubber(initial)
      const context: ClosureProgress = { source: input.source, reasonText: scrub(input.reasonText.trim()),
        ...(input.source === 'offline' ? { offlineEvidenceNo: scrub(input.offlineEvidenceNo!.trim()) } : {}),
        deleted: {}, retained: {}, objectStorageFailures: 0 }
      // 锁来源与状态并取消导出工作票，撤回与执行的竞争由 Serializable + CAS 决定。
      const request = await runSerializableTransaction(this.prisma, async (tx) => {
        const user = await tx.endUser.findUnique({ where: { id: endUserId } })
        if (!user || !['active', 'disabled', 'closing'].includes(user.status)) throw conflict('CLOSURE_STATUS_CONFLICT', '账号状态已变化')
        await this.assertNoOpenOrders(tx, endUserId)
        let row = await tx.userDataRequest.findUnique({ where: { activeKey: closureActiveKey(endUserId) } })
        if (user.status === 'closing') {
          if (!row || row.status !== 'handling') throw conflict('CLOSURE_STATE_INVALID', '注销执行记录缺失')
          const saved = this.progress(row.progressJson)
          if (saved.source !== context.source || saved.reasonText !== context.reasonText
            || saved.offlineEvidenceNo !== context.offlineEvidenceNo) throw conflict('CLOSURE_CONTEXT_MISMATCH', '重试必须使用首次执行的来源和事由')
          return row
        }
        if (input.source === 'member_request' && (!row || row.status !== 'pending' || row.requestType !== 'delete')) {
          throw conflict('CLOSURE_REQUEST_REQUIRED', '需要会员本人待处理的注销申请')
        }
        if (!row) row = await tx.userDataRequest.create({ data: {
          endUserId, requestType: 'delete', status: 'pending', activeKey: closureActiveKey(endUserId),
        } })
        const changed = await tx.endUser.updateMany({ where: { id: endUserId, status: user.status }, data: {
          status: 'closing', enabled: false, statusChangedAt: new Date(), closingRequestedAt: row.requestedAt,
        } })
        if (changed.count !== 1) throw conflict('CLOSURE_STATUS_CONFLICT', '账号状态已变化')
        await tx.userDataRequest.updateMany({ where: { endUserId, requestType: 'export', status: { in: ['pending', 'handling', 'ready', 'failed'] } },
          data: { status: 'cancelled', activeKey: null, executionVersion: { increment: 1 } } })
        return tx.userDataRequest.update({ where: { id: row.id }, data: {
          status: 'handling', executionStep: 'revoke', progressJson: JSON.stringify(context), handledBy: actor.userId,
        } })
      })
      let step = 'revoke'
      try {
        await assertLease()
        const persistFiles = async (ids: string[]) => {
          const row = await this.prisma.userDataRequest.findUniqueOrThrow({ where: { id: request.id } })
          const p = this.progress(row.progressJson)
          p.fileIds = [...new Set([...(p.fileIds ?? []), ...ids])]
          await this.prisma.userDataRequest.update({ where: { id: request.id }, data: { progressJson: JSON.stringify(p) } })
        }
        const uploadFiles = await this.redis.revoke(endUserId, initial.phoneHash, persistFiles)
        const discoveredFiles = await discoverClosureFiles(this.prisma, endUserId)
        const saved = await this.prisma.userDataRequest.findUniqueOrThrow({ where: { id: request.id } })
        const pendingProgress = this.progress(saved.progressJson)
        pendingProgress.fileIds = [...new Set([...(pendingProgress.fileIds ?? []), ...uploadFiles, ...discoveredFiles])]
        await this.prisma.userDataRequest.update({ where: { id: request.id }, data: { progressJson: JSON.stringify(pendingProgress) } })
        step = 'delete'
        await this.setStep(request.id, step)
        for (const model of CLOSURE_DELETE_MODELS) {
          await assertLease()
          await runSerializableTransaction(this.prisma, async (tx) => {
            const derived: Record<string, number> = {}
            if (model === 'mockInterviewSession') {
              derived.mockInterviewTurn = await tx.mockInterviewTurn.count({ where: { session: { endUserId } } })
              derived.mockInterviewReport = await tx.mockInterviewReport.count({ where: { session: { endUserId } } })
            }
            if (model === 'advisorSession') {
              derived.advisorPin = await tx.advisorPin.count({ where: { session: { endUserId } } })
              derived.advisorArtifact = await tx.advisorArtifact.count({ where: { session: { endUserId } } })
            }
            if (model === 'jobAiSession') derived.jobAiRecommendation = await tx.jobAiRecommendation.count({ where: { session: { endUserId } } })
            if (model === 'documentProcessTask') derived.piiFinding = await tx.piiFinding.count({ where: { task: { endUserId } } })
            const count = (await (tx[model] as unknown as { deleteMany(args: { where: { endUserId: string } }): Promise<{ count: number }> }).deleteMany({ where: { endUserId } })).count
            await this.addCounts(tx, request.id, 'deleted', { [model]: count, ...derived })
          })
        }
        await runSerializableTransaction(this.prisma, async (tx) => {
          const revoked = await tx.benefitGrant.updateMany({ where: { endUserId, status: 'active' }, data: { status: 'revoked' } })
          const legacy = await tx.userNotification.deleteMany({ where: { memberId: endUserId } })
          // AI 按人次数账本：每日计数的键是 `member:<id>`（ai-quota.service.ts 的 dailyKey），按等值删，
          // 不能用前缀匹配——否则注销 member:12 会连带删掉 member:123。预占记录存的是原始会员号。
          // 预占记录一律删除（含还在预占中的）：账号已进入注销、登录态已撤销，在途请求结算时找不到记录会如实失败；
          // 账本里没有手机号等身份信息，也没有统计读取它（后台汇总只读每日计数），所以不必匿名化保留。
          const quotaDaily = await tx.aiQuotaDaily.deleteMany({ where: { endUserId: `member:${endUserId}` } })
          const quotaReservations = await tx.aiQuotaReservation.deleteMany({ where: { endUserId } })
          await this.addCounts(tx, request.id, 'deleted', {
            benefitGrantRevoked: revoked.count, userNotification: legacy.count,
            aiQuotaDaily: quotaDaily.count, aiQuotaReservation: quotaReservations.count,
          })
        })
        // ownerId 是历史会员文件的第二条归属路径；派生文件跟随来源递归回收。
        const files = pendingProgress.fileIds
        for (const id of files) {
          await assertLease()
          await this.files.deleteForMemberClosure(id, async (tx, failures) => {
            await this.addCounts(tx, request.id, 'deleted', { fileObject: 1 }, failures)
          })
        }
        step = 'retain'
        await this.setStep(request.id, step)
        await assertLease()
        await runSerializableTransaction(this.prisma, async (tx) => {
          const saved = await tx.userDataRequest.findUniqueOrThrow({ where: { id: request.id } })
          const progress = this.progress(saved.progressJson)
          if (Object.keys(progress.retained).length) return
          const counts = await retainClosureRecords(tx, endUserId, scrub)
          await this.addCounts(tx, request.id, 'retained', counts)
        })
        // 再收口可能在撤销前已经进行中的注册/上传授权。
        await this.redis.revoke(endUserId, initial.phoneHash, async (ids) => {
          await persistFiles(ids)
          for (const id of ids) await this.files.deleteForMemberClosure(id, (tx, failures) =>
            this.addCounts(tx, request.id, 'deleted', { fileObject: 1 }, failures))
        })
        await assertLease()
        step = 'anonymize_and_audit'
        await this.setStep(request.id, step)
        return await runSerializableTransaction(this.prisma, async (tx) => {
          const changed = await tx.endUser.updateMany({ where: { id: endUserId, status: 'closing' }, data: {
            ...newClosurePhoneIdentity(), wxOpenId: null, nickname: null, enabled: false,
            lastLoginAt: null, status: 'anonymized', statusChangedAt: new Date(), anonymizedAt: new Date(),
          } })
          if (changed.count !== 1) throw conflict('CLOSURE_STATUS_CONFLICT', '账号状态已变化')
          const saved = await tx.userDataRequest.findUniqueOrThrow({ where: { id: request.id } })
          const p = this.progress(saved.progressJson)
          const auditRef = await this.audit.writeRequired(tx, {
            actorId: actor.userId, actorRole: 'admin', action: 'member.closure.executed',
            targetType: 'EndUser', targetId: endUserId,
            payload: { endUserId, source: p.source, offline: p.source === 'offline', reasonText: p.reasonText,
              ...(p.offlineEvidenceNo ? { offlineEvidenceNo: p.offlineEvidenceNo } : {}),
              deleted: p.deleted, retained: p.retained, objectStorageFailures: p.objectStorageFailures },
          })
          await tx.userDataRequest.updateMany({ where: { endUserId, requestType: 'delete' }, data: {
            progressJson: null, failureMessage: null, failureCode: null, idempotencyKey: null,
          } })
          await tx.userDataRequest.update({ where: { id: request.id }, data: {
            status: 'completed', activeKey: null, executionStep: null, handledAt: new Date(), auditRef,
          } })
          return { endUserId, status: 'anonymized' as const, changed: true }
        })
      } catch {
        // 不写原 exception.message，避免手机号/文件名进入审计。
        await this.audit.write({ actorId: actor.userId, actorRole: 'admin', action: 'member.closure.failed',
          targetType: 'EndUser', targetId: endUserId, payload: { endUserId, step } })
        throw unavailable('CLOSURE_EXECUTION_FAILED', '注销尚未完成，账号已暂停使用，请以相同参数重试')
      }
    })
  }

  private validate(input: MemberClosureInput): void {
    if (!input || !['member_request', 'offline'].includes(input.source)) throw badRequest('CLOSURE_SOURCE_INVALID', '注销来源无效')
    if (typeof input.reasonText !== 'string' || input.reasonText.trim().length < 1 || input.reasonText.trim().length > 200) {
      throw badRequest('CLOSURE_REASON_REQUIRED', '请填写 1–200 字事由')
    }
    if (typeof input.phoneLast4 !== 'string' || !/^\d{4}$/.test(input.phoneLast4)) throw badRequest('CLOSURE_PHONE_REQUIRED', '请填写四位手机号尾号')
    if (input.source === 'offline' && (typeof input.offlineEvidenceNo !== 'string'
      || input.offlineEvidenceNo.trim().length < 1 || input.offlineEvidenceNo.trim().length > 64)) {
      throw badRequest('CLOSURE_EVIDENCE_REQUIRED', '请填写 1–64 字线下凭据编号')
    }
  }

  private async assertNoOpenOrders(tx: PrismaTransactionClient, endUserId: string) {
    const orders = await tx.order.findMany({ where: { endUserId }, include: { refunds: { where: { status: 'pending' } }, orderItems: true, printTask: true } })
    const tasks = await tx.printTask.findMany({ where: { endUserId, status: { notIn: TERMINAL_PRINT_STATUSES } } })
    const open = orders.filter((row) => row.payStatus === 'refunding' || row.refunds.length
      || (PAID_STATUSES.includes(row.payStatus) && ['pending', 'claimed'].includes(row.pickupStatus))
      || (PAID_STATUSES.includes(row.payStatus) && !TERMINAL_ORDER_TASK_STATUSES.includes(row.taskStatus))
      || (row.printTask && !TERMINAL_PRINT_STATUSES.includes(row.printTask.status))
      || (PAID_STATUSES.includes(row.payStatus) && !DEAD_PICKUP_STATUSES.includes(row.pickupStatus)
        && row.orderItems.some((item) => !TERMINAL_PRINT_STATUSES.includes(item.status)))
      || tasks.some((task) => task.id === row.printTaskId || task.orderId === row.id))
    if (open.length || tasks.length) throw new ConflictException({ error: {
      code: 'CLOSURE_BLOCKED_BY_OPEN_ORDERS', message: '存在未完成订单或打印任务',
      orders: open.map((row) => ({ orderNo: row.orderNo, status: row.payStatus === 'refunding' || row.refunds.length ? 'refunding'
        : ['paid', 'partial_refunded'].includes(row.payStatus) && ['pending', 'claimed'].includes(row.pickupStatus)
          ? `pickup_${row.pickupStatus}` : row.printTask && !TERMINAL_PRINT_STATUSES.includes(row.printTask.status)
            ? row.printTask.status : row.orderItems.find((item) => !TERMINAL_PRINT_STATUSES.includes(item.status))?.status ?? row.taskStatus })),
    } })
  }

  private progress(raw: string | null): ClosureProgress { return JSON.parse(raw ?? '{}') as ClosureProgress }
  private async setStep(id: string, executionStep: string) { await this.prisma.userDataRequest.update({ where: { id }, data: { executionStep } }) }
  private async addCounts(tx: PrismaTransactionClient, id: string, kind: 'deleted' | 'retained', counts: Record<string, number>, failures = 0) {
    const row = await tx.userDataRequest.findUniqueOrThrow({ where: { id } })
    const p = this.progress(row.progressJson)
    for (const [model, count] of Object.entries(counts)) p[kind][model] = (p[kind][model] ?? 0) + count
    p.objectStorageFailures += failures
    await tx.userDataRequest.update({ where: { id }, data: { progressJson: JSON.stringify(p) } })
  }
}
