import { NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { MemberStepUpService } from '../member-auth/member-step-up.service'
import { PrismaService } from '../prisma/prisma.service'
import { conflict, toMemberDataRequestItem } from './member-data-request.helpers'
import { runSerializableTransaction } from './member-privacy.service'

export const closureActiveKey = (id: string): string => `${id}:closure-manual`

/** 人工注销工单：与导出互不排队，pending 仅表示等待管理员执行。 */
export class MemberClosureRequests {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stepUp: MemberStepUpService,
    private readonly audit: AuditService,
  ) {}

  async create(endUserId: string, idempotencyKey: string, token: string | null, deviceId: string | null) {
    // 首次与重复申请均须有效二次验证，不能用幂等重放绕过身份核验。
    await this.stepUp.consumeGrant(endUserId, 'close_account', token ?? '', deviceId ?? undefined)
    try {
      return await runSerializableTransaction(this.prisma, async (tx) => {
        const account = await tx.endUser.findUnique({ where: { id: endUserId } })
        if (!account?.enabled || account.status !== 'active') {
          throw conflict('ACCOUNT_UNAVAILABLE', '账号当前不可用')
        }
        const replay = await tx.userDataRequest.findUnique({ where: { idempotencyKey } })
        if (replay && (replay.endUserId !== endUserId || replay.requestType !== 'delete')) {
          throw conflict('IDEMPOTENCY_KEY_REUSED', '幂等键已用于其他数据请求')
        }
        if (replay) return toMemberDataRequestItem(replay)
        const activeKey = closureActiveKey(endUserId)
        const pending = await tx.userDataRequest.findUnique({ where: { activeKey } })
        if (pending) return toMemberDataRequestItem(pending)
        const row = await tx.userDataRequest.create({ data: {
          endUserId, idempotencyKey, activeKey, requestType: 'delete', status: 'pending',
          executionStep: 'awaiting_admin', progressJson: '{}',
        } })
        const auditRef = await this.audit.writeRequired(tx, {
          actorId: null, actorRole: 'end_user', action: 'member.closure.requested',
          targetType: 'user_data_request', targetId: row.id, payload: {},
        })
        return toMemberDataRequestItem(await tx.userDataRequest.update({ where: { id: row.id }, data: { auditRef } }))
      })
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        const pending = await this.prisma.userDataRequest.findUnique({ where: { activeKey: closureActiveKey(endUserId) } })
        if (pending) return toMemberDataRequestItem(pending)
      }
      throw error
    }
  }

  async cancel(endUserId: string, id: string) {
    return runSerializableTransaction(this.prisma, async (tx) => {
      const row = await tx.userDataRequest.findFirst({ where: { id, endUserId, requestType: 'delete' } })
      if (!row) throw new NotFoundException({ error: { code: 'DATA_REQUEST_NOT_FOUND', message: '数据请求不存在' } })
      const account = await tx.endUser.findUnique({ where: { id: endUserId } })
      if (row.status !== 'pending' || account?.status !== 'active') {
        throw conflict('DATA_REQUEST_INVALID_TRANSITION', '只能撤回尚未执行的注销申请')
      }
      const cas = await tx.userDataRequest.updateMany({
        where: { id, endUserId, requestType: 'delete', status: 'pending' },
        data: { status: 'cancelled', activeKey: null, handledAt: new Date(), executionStep: null },
      })
      if (cas.count !== 1) throw conflict('DATA_REQUEST_INVALID_TRANSITION', '申请状态已变化')
      const auditRef = await this.audit.writeRequired(tx, {
        actorId: null, actorRole: 'end_user', action: 'member.closure.cancelled',
        targetType: 'user_data_request', targetId: id, payload: {},
      })
      return toMemberDataRequestItem(await tx.userDataRequest.update({ where: { id }, data: { auditRef } }))
    })
  }
}
