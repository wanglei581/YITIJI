import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import type {
  AdminFeedbackTicketDetail,
  AdminFeedbackTicketItem,
  FeedbackCategory,
  FeedbackReplyItem,
  FeedbackStatus,
  MemberFeedbackPage,
  MemberFeedbackTicketDetail,
  MemberFeedbackTicketItem,
} from './member-feedback.types'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import { encryptPhone, maskPhoneFromEnc } from '../common/crypto/phone-identity'
import { AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import { MemberNotificationsService } from '../member-notifications/member-notifications.service'
import type { AddFeedbackReplyDto, CreateFeedbackDto, UpdateFeedbackStatusDto } from './dto/member-feedback.dto'
import { FEEDBACK_CATEGORIES, FEEDBACK_STATUSES } from './dto/member-feedback.dto'

const FORBIDDEN_RECRUITING_COPY = /一键投递|立即投递|平台投递|面试邀约|录用通知|Offer|候选人推荐|企业筛选|收取简历|投递结果|预约结果/i

@Injectable()
export class MemberFeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: MemberNotificationsService,
  ) {}

  async create(endUserId: string, dto: CreateFeedbackDto): Promise<MemberFeedbackTicketDetail> {
    this.validateCategory(dto.category)
    this.assertSafeCopy(`${dto.title ?? ''} ${dto.content}`)
    if (dto.relatedPrintTaskId) await this.assertPrintTaskOwner(endUserId, dto.relatedPrintTaskId)

    const row = await this.prisma.feedbackTicket.create({
      data: {
        endUserId,
        terminalId: cleanNullable(dto.terminalId),
        relatedPrintTaskId: cleanNullable(dto.relatedPrintTaskId),
        category: dto.category,
        title: cleanNullable(dto.title),
        content: dto.content.trim(),
        contactPhoneEnc: dto.contactPhone ? encryptPhone(dto.contactPhone) : null,
      },
      include: { replies: true },
    })
    return this.toMemberDetail(row)
  }

  async listForEndUser(endUserId: string, opts: { cursor: string | null; pageSize: number }): Promise<MemberFeedbackPage> {
    const take = Math.min(Math.max(opts.pageSize, 1), 50)
    const cursorDate = opts.cursor ? new Date(opts.cursor) : null
    const rows = await this.prisma.feedbackTicket.findMany({
      where: {
        endUserId,
        ...(cursorDate && !Number.isNaN(cursorDate.getTime()) ? { createdAt: { lt: cursorDate } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
    })
    const items = rows.map((row) => this.toMemberItem(row))
    return {
      items,
      total: items.length,
      nextCursor: items.length === take ? items[items.length - 1].createdAt : null,
    }
  }

  async getForEndUser(endUserId: string, id: string): Promise<MemberFeedbackTicketDetail> {
    const row = await this.prisma.feedbackTicket.findFirst({
      where: { id, endUserId },
      include: { replies: { orderBy: { createdAt: 'asc' } } },
    })
    if (!row) throw new NotFoundException({ error: { code: 'FEEDBACK_NOT_FOUND', message: '反馈记录不存在' } })
    return this.toMemberDetail(row)
  }

  async addUserReply(endUserId: string, id: string, dto: AddFeedbackReplyDto): Promise<MemberFeedbackTicketDetail> {
    this.assertSafeCopy(dto.content)
    const ticket = await this.prisma.feedbackTicket.findFirst({ where: { id, endUserId } })
    if (!ticket) throw new NotFoundException({ error: { code: 'FEEDBACK_NOT_FOUND', message: '反馈记录不存在' } })
    if (ticket.status === 'closed') {
      throw new ConflictException({ error: { code: 'FEEDBACK_CLOSED', message: '已关闭的反馈不能继续追加' } })
    }
    await this.prisma.feedbackReply.create({
      data: { ticketId: id, senderType: 'user', content: dto.content.trim() },
    })
    if (ticket.status === 'replied') {
      await this.prisma.feedbackTicket.update({ where: { id }, data: { status: 'processing' } })
    }
    return this.getForEndUser(endUserId, id)
  }

  async closeByEndUser(endUserId: string, id: string): Promise<MemberFeedbackTicketDetail> {
    const ticket = await this.prisma.feedbackTicket.findFirst({ where: { id, endUserId } })
    if (!ticket) throw new NotFoundException({ error: { code: 'FEEDBACK_NOT_FOUND', message: '反馈记录不存在' } })
    const updated = await this.prisma.feedbackTicket.update({
      where: { id },
      data: { status: 'closed' },
      include: { replies: { orderBy: { createdAt: 'asc' } } },
    })
    return this.toMemberDetail(updated)
  }

  async listForAdmin(query: { status?: string; category?: string }): Promise<{ items: AdminFeedbackTicketItem[] }> {
    const status = query.status ? this.validateStatus(query.status) : undefined
    const category = query.category ? this.validateCategory(query.category) : undefined
    const rows = await this.prisma.feedbackTicket.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(category ? { category } : {}),
      },
      include: { endUser: { select: { phoneEnc: true, nickname: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    return { items: rows.map((row) => this.toAdminItem(row)) }
  }

  async getForAdmin(admin: AuthedUser, id: string): Promise<AdminFeedbackTicketDetail> {
    const detail = await this.getAdminDetailWithoutViewAudit(id)
    await this.audit.write({
      actorId: admin.userId,
      actorRole: admin.role,
      action: 'feedback.view',
      targetType: 'FeedbackTicket',
      targetId: id,
      payload: { phoneMasked: detail.phoneMasked, status: detail.status },
    })
    return detail
  }

  async addAdminReply(admin: AuthedUser, id: string, dto: AddFeedbackReplyDto): Promise<AdminFeedbackTicketDetail> {
    this.assertSafeCopy(dto.content)
    const ticket = await this.prisma.feedbackTicket.findUnique({
      where: { id },
      include: { endUser: { select: { phoneEnc: true, nickname: true } } },
    })
    if (!ticket) throw new NotFoundException({ error: { code: 'FEEDBACK_NOT_FOUND', message: '反馈记录不存在' } })
    if (ticket.status === 'closed') {
      throw new ConflictException({ error: { code: 'FEEDBACK_CLOSED', message: '已关闭的反馈不能继续回复' } })
    }
    await this.prisma.feedbackReply.create({
      data: { ticketId: id, senderType: 'admin', actorId: admin.userId, content: dto.content.trim() },
    })
    await this.prisma.feedbackTicket.update({ where: { id }, data: { status: 'replied' } })
    await this.notifications.createForEndUser({
      endUserId: ticket.endUserId,
      title: '意见反馈已回复',
      content: '工作人员已回复您的意见反馈，请到「我的-意见反馈」查看处理说明。',
      category: 'feedback',
      relatedType: 'feedback_ticket',
      relatedId: id,
    })
    await this.audit.write({
      actorId: admin.userId,
      actorRole: admin.role,
      action: 'feedback.reply',
      targetType: 'FeedbackTicket',
      targetId: id,
      payload: { phoneMasked: maskPhoneFromEnc(ticket.endUser.phoneEnc), status: 'replied' },
    })
    return this.getAdminDetailWithoutViewAudit(id)
  }

  async updateAdminStatus(admin: AuthedUser, id: string, dto: UpdateFeedbackStatusDto): Promise<AdminFeedbackTicketDetail> {
    const status = this.validateStatus(dto.status)
    const ticket = await this.prisma.feedbackTicket.findUnique({
      where: { id },
      include: { endUser: { select: { phoneEnc: true, nickname: true } } },
    })
    if (!ticket) throw new NotFoundException({ error: { code: 'FEEDBACK_NOT_FOUND', message: '反馈记录不存在' } })
    await this.prisma.feedbackTicket.update({ where: { id }, data: { status } })
    await this.audit.write({
      actorId: admin.userId,
      actorRole: admin.role,
      action: 'feedback.status_change',
      targetType: 'FeedbackTicket',
      targetId: id,
      payload: { phoneMasked: maskPhoneFromEnc(ticket.endUser.phoneEnc), from: ticket.status, to: status },
    })
    return this.getAdminDetailWithoutViewAudit(id)
  }

  private async assertPrintTaskOwner(endUserId: string, printTaskId: string): Promise<void> {
    const task = await this.prisma.printTask.findFirst({ where: { id: printTaskId, endUserId } })
    if (!task) throw new BadRequestException({ error: { code: 'FEEDBACK_PRINT_TASK_INVALID', message: '关联打印订单不存在' } })
  }

  private assertSafeCopy(text: string): void {
    if (FORBIDDEN_RECRUITING_COPY.test(text)) {
      throw new BadRequestException({ error: { code: 'FEEDBACK_COPY_FORBIDDEN', message: '反馈内容不能包含招聘流程或结果承诺' } })
    }
  }

  private validateCategory(value: string): FeedbackCategory {
    if (!(FEEDBACK_CATEGORIES as readonly string[]).includes(value)) {
      throw new BadRequestException({ error: { code: 'FEEDBACK_CATEGORY_INVALID', message: '反馈分类不支持' } })
    }
    return value as FeedbackCategory
  }

  private validateStatus(value: string): FeedbackStatus {
    if (!(FEEDBACK_STATUSES as readonly string[]).includes(value)) {
      throw new BadRequestException({ error: { code: 'FEEDBACK_STATUS_INVALID', message: '反馈状态不支持' } })
    }
    return value as FeedbackStatus
  }

  private async getAdminDetailWithoutViewAudit(id: string): Promise<AdminFeedbackTicketDetail> {
    const row = await this.prisma.feedbackTicket.findUnique({
      where: { id },
      include: {
        endUser: { select: { phoneEnc: true, nickname: true } },
        replies: { orderBy: { createdAt: 'asc' } },
      },
    })
    if (!row) throw new NotFoundException({ error: { code: 'FEEDBACK_NOT_FOUND', message: '反馈记录不存在' } })
    return this.toAdminDetail(row)
  }

  private toMemberItem(row: {
    id: string
    category: string
    title: string | null
    content: string
    contactPhoneEnc: string | null
    terminalId: string | null
    relatedPrintTaskId: string | null
    status: string
    createdAt: Date
    updatedAt: Date
  }): MemberFeedbackTicketItem {
    return {
      id: row.id,
      category: row.category as FeedbackCategory,
      title: row.title,
      content: row.content,
      contactPhoneMasked: row.contactPhoneEnc ? maskPhoneFromEnc(row.contactPhoneEnc) : null,
      terminalId: row.terminalId,
      relatedPrintTaskId: row.relatedPrintTaskId,
      status: row.status as FeedbackStatus,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }

  private toMemberDetail(row: Parameters<MemberFeedbackService['toMemberItem']>[0] & { replies: Array<{
    id: string
    senderType: string
    actorId: string | null
    content: string
    createdAt: Date
  }> }): MemberFeedbackTicketDetail {
    return { ...this.toMemberItem(row), replies: row.replies.map(this.toReplyItem) }
  }

  private toAdminItem(row: Parameters<MemberFeedbackService['toMemberItem']>[0] & {
    endUserId: string
    endUser: { phoneEnc: string; nickname: string | null }
  }): AdminFeedbackTicketItem {
    return {
      ...this.toMemberItem(row),
      endUserId: row.endUserId,
      phoneMasked: maskPhoneFromEnc(row.endUser.phoneEnc),
      nickname: row.endUser.nickname,
    }
  }

  private toAdminDetail(row: Parameters<MemberFeedbackService['toAdminItem']>[0] & { replies: Array<{
    id: string
    senderType: string
    actorId: string | null
    content: string
    createdAt: Date
  }> }): AdminFeedbackTicketDetail {
    return { ...this.toAdminItem(row), replies: row.replies.map(this.toReplyItem) }
  }

  private toReplyItem(row: {
    id: string
    senderType: string
    actorId: string | null
    content: string
    createdAt: Date
  }): FeedbackReplyItem {
    return {
      id: row.id,
      senderType: row.senderType as FeedbackReplyItem['senderType'],
      actorId: row.actorId,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
    }
  }
}

function cleanNullable(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
