import crypto from 'crypto'
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { signFileUrl } from '../files/signing'
import { hashPickupCode } from '../member-print-orders/member-print-order-create.service'
import { createPaymentSessionToken, verifyPaymentSessionToken } from '../payment/payment-session-token'
import { PrismaService } from '../prisma/prisma.service'
import { TerminalCapabilitiesService } from '../terminals/terminal-capabilities.service'

const SIGNED_URL_TTL_MS = 30 * 60 * 1000
type OrderRecord = NonNullable<Awaited<ReturnType<PrismaService['order']['findUnique']>>>

@Injectable()
export class PickupOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capabilities: TerminalCapabilitiesService,
    private readonly audit: AuditService,
  ) {}

  async claim(codeInput: string, terminalRef: string | undefined) {
    const code = codeInput.trim().toUpperCase()
    const terminal = await this.requireTerminal(terminalRef)
    const order = await this.prisma.order.findUnique({ where: { pickupCodeHash: hashPickupCode(code) } })
    if (!order) throw new NotFoundException({ error: { code: 'PICKUP_CODE_INVALID', message: '到机码无效或已过期' } })
    if (order.terminalId !== terminal.id) {
      throw new ForbiddenException({ error: { code: 'PICKUP_TERMINAL_MISMATCH', message: '该订单已绑定其他服务终端' } })
    }
    if (!order.pickupCodeExpiresAt || order.pickupCodeExpiresAt <= new Date()) {
      await this.prisma.order.updateMany({
        where: { id: order.id, pickupStatus: 'pending', printTaskId: null },
        data: { pickupStatus: 'expired', taskStatus: 'expired', payStatus: order.payStatus === 'unpaid' ? 'closed' : order.payStatus },
      })
      throw new BadRequestException({ error: { code: 'PICKUP_CODE_EXPIRED', message: '到机码已过期，请在小程序重新下单' } })
    }
    if (order.pickupStatus === 'used' && order.printTaskId) return this.releasedView(order)
    if (!['pending', 'claimed'].includes(order.pickupStatus)) {
      throw new BadRequestException({ error: { code: 'PICKUP_CODE_UNAVAILABLE', message: '到机码当前不可使用' } })
    }
    await this.assertOrderFileReady(order)
    await this.capabilities.assertUserTaskAllowed(terminal.id, 'document_print')

    if (order.pickupStatus === 'pending') {
      await this.prisma.order.updateMany({
        where: { id: order.id, pickupStatus: 'pending', printTaskId: null },
        data: { pickupStatus: 'claimed', pickupClaimedAt: new Date(), taskStatus: 'awaiting_payment' },
      })
    }
    const fresh = await this.prisma.order.findUnique({ where: { id: order.id } })
    if (!fresh) throw new NotFoundException('ORDER_NOT_FOUND')

    if (fresh.payStatus === 'paid') return this.release(fresh.id, terminal.id, this.paymentToken(fresh))
    if (!['unpaid', 'paying'].includes(fresh.payStatus)) {
      throw new BadRequestException({ error: { code: 'ORDER_PAYMENT_UNAVAILABLE', message: '订单当前无法付款' } })
    }

    await this.audit.write({
      actorId: null,
      actorRole: 'kiosk',
      action: 'print_order.pickup_claim',
      targetType: 'order',
      targetId: fresh.id,
      payload: { terminalId: terminal.id },
    })
    return {
      released: false,
      orderId: fresh.id,
      orderNo: fresh.orderNo,
      terminalId: terminal.id,
      amountCents: fresh.amountCents,
      priceLines: this.priceLines(fresh.itemsJson),
      fileName: fresh.sourceFileName,
      paymentSessionToken: this.paymentToken(fresh),
    }
  }

  async release(orderId: string, terminalRef: string | undefined, paymentSessionToken: string | undefined) {
    const terminal = await this.requireTerminal(terminalRef)
    const order = await this.prisma.order.findUnique({ where: { id: orderId } })
    if (!order) throw new NotFoundException('ORDER_NOT_FOUND')
    this.requirePaymentSession(order, paymentSessionToken)
    if (order.terminalId !== terminal.id) throw new ForbiddenException('PICKUP_TERMINAL_MISMATCH')
    if (order.printTaskId) return this.releasedView(order)
    if (order.pickupStatus !== 'claimed') throw new BadRequestException('PICKUP_NOT_CLAIMED')
    if (order.payStatus !== 'paid') throw new BadRequestException('ORDER_NOT_PAID')
    await this.assertOrderFileReady(order)
    await this.capabilities.assertUserTaskAllowed(terminal.id, 'document_print')

    const signed = signFileUrl(order.sourceFileId!, SIGNED_URL_TTL_MS)
    const taskId = `ptask_pickup_${crypto.randomBytes(8).toString('hex')}`
    const result = await this.prisma.$transaction(async (tx) => {
      const current = await tx.order.findUnique({ where: { id: order.id } })
      if (!current) throw new NotFoundException('ORDER_NOT_FOUND')
      if (current.printTaskId) return { taskId: current.printTaskId, created: false }
      if (current.pickupStatus !== 'claimed' || current.payStatus !== 'paid') {
        throw new BadRequestException('ORDER_RELEASE_INVALID_STATE')
      }
      await tx.printTask.create({
        data: {
          id: taskId,
          terminalId: terminal.id,
          endUserId: current.endUserId,
          fileUrl: signed.url,
          fileId: current.sourceFileId,
          fileMd5: current.sourceFileSha256 ?? '',
          paramsJson: current.printParamsJson,
          status: 'pending',
        },
      })
      const updated = await tx.order.updateMany({
        where: { id: current.id, printTaskId: null, pickupStatus: 'claimed', payStatus: 'paid' },
        data: { printTaskId: taskId, pickupStatus: 'used', taskStatus: 'pending' },
      })
      if (updated.count !== 1) throw new BadRequestException('ORDER_RELEASE_CONFLICT')
      return { taskId, created: true }
    })

    if (result.created) {
      await this.audit.write({
        actorId: null,
        actorRole: 'kiosk',
        action: 'print_order.release',
        targetType: 'print_task',
        targetId: result.taskId,
        payload: { orderId: order.id, terminalId: terminal.id },
      })
    }
    const fresh = await this.prisma.order.findUnique({ where: { id: order.id } })
    if (!fresh) throw new NotFoundException('ORDER_NOT_FOUND')
    return this.releasedView(fresh)
  }

  private async requireTerminal(terminalRef: string | undefined) {
    const ref = terminalRef?.trim()
    if (!ref) throw new BadRequestException({ error: { code: 'TERMINAL_ID_REQUIRED', message: '终端身份未就绪' } })
    const terminal = await this.prisma.terminal.findFirst({
      where: { OR: [{ id: ref }, { terminalCode: ref }] },
      include: { heartbeats: { orderBy: { createdAt: 'desc' }, take: 1 } },
    })
    if (!terminal) throw new NotFoundException('PRINT_TERMINAL_NOT_FOUND')
    const latest = terminal.heartbeats[0]
    if (!terminal.enabled || terminal.lifecycleStatus !== 'active' || !latest || Date.now() - latest.createdAt.getTime() >= 5 * 60 * 1000) {
      throw new ForbiddenException({ error: { code: 'PRINT_TERMINAL_NOT_READY', message: '本机终端当前不能接收打印订单' } })
    }
    if (latest.localTaskDatabaseAvailable === false) throw new ForbiddenException('PRINT_TERMINAL_DEGRADED')
    return terminal
  }

  private async assertOrderFileReady(order: { sourceFileId: string | null; endUserId: string | null }) {
    if (!order.sourceFileId) throw new BadRequestException('PRINT_FILE_NOT_FOUND')
    const file = await this.prisma.fileObject.findFirst({
      where: { id: order.sourceFileId, endUserId: order.endUserId, deletedAt: null },
      select: { status: true, expiresAt: true, purpose: true },
    })
    if (!file || file.status !== 'active' || (file.expiresAt && file.expiresAt <= new Date())) {
      throw new BadRequestException({ error: { code: 'PRINT_FILE_EXPIRED', message: '打印文件已失效，请重新上传' } })
    }
    if (['print_doc', 'resume_upload', 'resume_scan'].includes(file.purpose)) {
      const scan = await this.prisma.documentProcessTask.findFirst({
        where: { sourceFileId: order.sourceFileId, kind: 'pii_scan', status: 'completed' },
        orderBy: { createdAt: 'desc' }, select: { id: true },
      })
      if (!scan || await this.prisma.piiFinding.count({ where: { taskId: scan.id, action: 'pending' } }) > 0) {
        throw new BadRequestException({ error: { code: 'PRINT_PII_SCAN_REQUIRED', message: '打印隐私检查尚未完成' } })
      }
    }
  }

  private requirePaymentSession(order: OrderRecord, token: string | undefined) {
    const subject = {
      orderId: order.id,
      orderNo: order.orderNo,
      terminalId: order.terminalId,
      amountCents: order.amountCents,
      printTaskId: order.printTaskId,
    }
    const result = verifyPaymentSessionToken(token, subject)
    if (result.ok) return
    // 首次 release 已提交但响应丢失时，Kiosk 仍持有“建任务前”的同订单 token。
    // 仅当该订单确已释放时兼容 printTaskId=null 的旧 subject，保证重试幂等；
    // 其它订单/终端/金额仍由签名 subject 严格绑定。
    if (order.printTaskId) {
      const preRelease = verifyPaymentSessionToken(token, { ...subject, printTaskId: null })
      if (preRelease.ok) return
    }
    throw new UnauthorizedException(result.code)
  }

  private paymentToken(order: OrderRecord): string {
    return createPaymentSessionToken({
      orderId: order.id,
      orderNo: order.orderNo,
      terminalId: order.terminalId,
      amountCents: order.amountCents,
      printTaskId: order.printTaskId,
    })
  }

  private priceLines(itemsJson: string): unknown[] {
    try { const parsed = JSON.parse(itemsJson); return Array.isArray(parsed) ? parsed : [] } catch { return [] }
  }

  private releasedView(order: OrderRecord) {
    return {
      released: true,
      taskId: order.printTaskId,
      orderId: order.id,
      orderNo: order.orderNo,
      terminalId: order.terminalId,
      taskStatus: order.taskStatus,
      printTaskStatus: order.taskStatus,
      paymentSessionToken: this.paymentToken(order),
    }
  }
}
