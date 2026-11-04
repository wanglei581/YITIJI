import { HttpException, Injectable } from '@nestjs/common'
import { CopyJobStore } from './copy-job-store.service'
import { assertCopyCombination, assertCopyLimits, COPY_ENDED, COPY_MAX_PAGES, COPY_PERMIT_MS, copyError } from './copy-job.policy'
import { COPY_MAX_COPIES, type CopyPermit } from './copy-job.types'
import type { CopyPrintResultDto, CopyScanResultDto } from './copy-job.dto'

@Injectable()
export class CopyAgentService {
  constructor(private readonly store: CopyJobStore) {}

  async permit(terminalId: string, id: string, op: string): Promise<CopyPermit> {
    if (op !== 'scan' && op !== 'print') copyError(400, 'COPY_BAD_REQUEST')
    let job = await this.store.find(id, terminalId)
    let reason: string | null = null
    const params = { ...job, colorMode: job.colorMode as CopyPermit['parameters']['colorMode'],
      duplex: job.duplex as CopyPermit['parameters']['duplex'] }
    if (job.expiresAt.getTime() <= Date.now()) reason = 'COPY_EXPIRED'
    else if (COPY_ENDED.includes(job.state)) reason = 'COPY_STATE_CONFLICT'
    else if (op === 'scan' && !['ready', 'scanning'].includes(job.state)) reason = 'COPY_STATE_CONFLICT'
    else if (op === 'print' && (!job.orderId || !['confirmed', 'dispatching'].includes(job.state))) {
      reason = 'COPY_NOT_CONFIRMED'
    }
    if (!reason) {
      try {
        await this.store.capable(params)
        if (op === 'print') {
          assertCopyCombination(params)
          const order = await this.store.prisma.order.findUnique({ where: { id: job.orderId! } })
          if (!order || order.type !== 'copy' || order.payStatus !== 'paid'
            || order.paymentSource !== 'free' || order.amountCents !== 0) reason = 'COPY_NOT_CONFIRMED'
        } else assertCopyLimits({ copies: job.copies, pageCount: 1 })
      } catch (error) {
        if (!(error instanceof HttpException)) throw error
        reason = (error.getResponse() as { error: { code: string } }).error.code
      }
    }
    if (!reason) {
      // 许可与取消/确认/回报并发时钉住快照；print 首次发许可即进入不可保证取消的派发阶段。
      const changed = await this.store.prisma.copyJob.updateMany({ where: { id, terminalId,
        generation: job.generation, authorizationVersion: job.authorizationVersion, state: job.state,
        expiresAt: { gt: new Date() } }, data: { state: op === 'scan' ? 'scanning' : 'dispatching' } })
      if (!changed.count) reason = 'COPY_STATE_CONFLICT'
      else {
        job = await this.store.find(id, terminalId)
        await this.store.record('permit', job, { op })
      }
    }
    return { allowed: reason === null, reason, copyId: id, op, generation: job.generation,
      authorizationVersion: job.authorizationVersion,
      expiresAt: new Date(Math.min(job.expiresAt.getTime(), Date.now() + COPY_PERMIT_MS)).toISOString(),
      parameters: { source: params.source as CopyPermit['parameters']['source'],
        colorMode: params.colorMode, duplex: params.duplex, copies: params.copies, pageCount: params.pageCount,
        maxPages: COPY_MAX_PAGES, maxCopies: COPY_MAX_COPIES } }
  }

  async scanResult(terminalId: string, id: string, input: CopyScanResultDto) {
    const job = await this.store.find(id, terminalId)
    if (input.generation !== job.generation) copyError(409, 'COPY_STALE_GENERATION')
    assertCopyLimits({ copies: job.copies, pageCount: input.pageCount })
    if (job.pageCount === input.pageCount && job.pageCount > 0) return this.store.view(job)
    if (job.pageCount > 0) copyError(409, 'COPY_SCAN_RESULT_CONFLICT')
    this.store.assertActive(job)
    if (!['ready', 'scanning'].includes(job.state)) copyError(409, 'COPY_STATE_CONFLICT')
    const changed = await this.store.prisma.copyJob.updateMany({ where: { id, terminalId,
      generation: input.generation, state: job.state, pageCount: 0, expiresAt: { gt: new Date() } },
    data: { pageCount: input.pageCount, state: 'scanned' } })
    if (!changed.count) {
      const fresh = await this.store.find(id, terminalId)
      if (fresh.generation === input.generation && fresh.pageCount === input.pageCount) return this.store.view(fresh)
      copyError(409, 'COPY_STATE_CONFLICT')
    }
    await this.store.record('scan_result', job, { pageCount: input.pageCount, source: 'terminal_scan' })
    return this.store.view(await this.store.find(id))
  }

  async result(terminalId: string, id: string, input: CopyPrintResultDto) {
    const job = await this.store.find(id, terminalId)
    if (input.generation !== job.generation) copyError(409, 'COPY_STALE_GENERATION')
    if (!['handed', 'failed', 'unconfirmed'].includes(input.state)) copyError(400, 'COPY_BAD_REQUEST')
    // 第一条终态胜出；迟到、重复或互相矛盾的同代终态都只返回已记录的事实。
    if (COPY_ENDED.includes(job.state)) {
      await this.store.record('print_result', job, { eventId: input.eventId, state: input.state,
        acceptedState: job.state, replay: true })
      return this.store.view(job)
    }
    if (!job.orderId || !['confirmed', 'dispatching', 'spooled'].includes(job.state)) copyError(409, 'COPY_NOT_CONFIRMED')
    // 故意不查能力与到期：已派发任务在关能力/过期后仍须收下最终结果。
    const updated = await this.store.prisma.$transaction(async (tx) => {
      const changed = await tx.copyJob.updateMany({ where: { id, terminalId, generation: input.generation,
        state: job.state, orderId: job.orderId },
      data: { state: input.state, resultCode: input.errorCode ?? null, authorizationVersion: { increment: 1 } } })
      if (changed.count) await tx.order.update({ where: { id: job.orderId! }, data: { taskStatus: input.state } })
      return this.store.find(id, terminalId, tx)
    })
    await this.store.record('print_result', updated, { eventId: input.eventId, state: input.state,
      acceptedState: updated.state, errorCode: input.errorCode ?? null })
    return this.store.view(updated)
  }
}
