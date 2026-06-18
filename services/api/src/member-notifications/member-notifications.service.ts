import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type {
  AdminBroadcastItem,
  MemberNotificationItem,
  MemberNotificationPage,
  SystemBroadcastCategory,
} from './member-notifications.types'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import type { CreateBroadcastDto, CreateMemberNotificationInput } from './dto/member-notifications.dto'

const FORBIDDEN_RECRUITING_COPY = /一键投递|立即投递|平台投递|面试邀约|录用通知|Offer|候选人推荐|企业筛选|收取简历|投递结果|预约结果/i

@Injectable()
export class MemberNotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async createForEndUser(input: CreateMemberNotificationInput): Promise<MemberNotificationItem> {
    this.assertSafeCopy(`${input.title} ${input.content}`)
    const row = await this.prisma.memberNotification.create({
      data: {
        endUserId: input.endUserId,
        title: input.title.trim(),
        content: input.content.trim(),
        category: input.category,
        relatedType: input.relatedType ?? null,
        relatedId: input.relatedId ?? null,
      },
    })
    return this.toPersonalItem(row)
  }

  async listForEndUser(
    endUserId: string,
    opts: { cursor: string | null; pageSize: number; unreadOnly?: boolean },
  ): Promise<MemberNotificationPage> {
    const take = Math.min(Math.max(opts.pageSize, 1), 50)
    const cursorDate = opts.cursor ? new Date(opts.cursor) : null
    const personalWhere: Record<string, unknown> = { endUserId, deletedAt: null }
    if (opts.unreadOnly) personalWhere['isRead'] = false
    if (cursorDate && !Number.isNaN(cursorDate.getTime())) personalWhere['createdAt'] = { lt: cursorDate }

    const broadcasts = await this.prisma.systemBroadcast.findMany({
      where: {
        deletedAt: null,
        ...(cursorDate && !Number.isNaN(cursorDate.getTime()) ? { createdAt: { lt: cursorDate } } : {}),
        readStates: opts.unreadOnly
          ? { none: { endUserId, OR: [{ readAt: { not: null } }, { dismissedAt: { not: null } }] } }
          : { none: { endUserId, dismissedAt: { not: null } } },
      },
      include: { readStates: { where: { endUserId } } },
      orderBy: { createdAt: 'desc' },
      take,
    })
    const personal = await this.prisma.memberNotification.findMany({
      where: personalWhere,
      orderBy: { createdAt: 'desc' },
      take,
    })

    const items = [
      ...personal.map((row) => this.toPersonalItem(row)),
      ...broadcasts.map((row) => this.toBroadcastItem(row, endUserId)),
    ]
      .filter((item) => !opts.unreadOnly || !item.isRead)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, take)

    const unreadCount = await this.countUnread(endUserId)
    return {
      items,
      total: items.length,
      unreadCount,
      // P1 exposes a single merged snapshot of personal notifications + broadcasts.
      // Do not advertise cursor paging until the merged stream has a compound keyset cursor.
      nextCursor: null,
    }
  }

  async markPersonalRead(endUserId: string, id: string): Promise<MemberNotificationItem> {
    const row = await this.prisma.memberNotification.findFirst({ where: { id, endUserId, deletedAt: null } })
    if (!row) throw new NotFoundException({ error: { code: 'NOTIFICATION_NOT_FOUND', message: '通知不存在' } })
    const updated = await this.prisma.memberNotification.update({
      where: { id },
      data: { isRead: true, readAt: row.readAt ?? new Date() },
    })
    return this.toPersonalItem(updated)
  }

  async deletePersonal(endUserId: string, id: string): Promise<{ deleted: true }> {
    const row = await this.prisma.memberNotification.findFirst({ where: { id, endUserId, deletedAt: null } })
    if (!row) throw new NotFoundException({ error: { code: 'NOTIFICATION_NOT_FOUND', message: '通知不存在' } })
    await this.prisma.memberNotification.update({ where: { id }, data: { deletedAt: new Date() } })
    return { deleted: true }
  }

  async markBroadcastRead(endUserId: string, id: string): Promise<MemberNotificationItem> {
    const broadcast = await this.prisma.systemBroadcast.findFirst({ where: { id, deletedAt: null } })
    if (!broadcast) throw new NotFoundException({ error: { code: 'BROADCAST_NOT_FOUND', message: '系统通知不存在' } })
    await this.prisma.broadcastReadState.upsert({
      where: { endUserId_broadcastId: { endUserId, broadcastId: id } },
      create: { endUserId, broadcastId: id, readAt: new Date() },
      update: { readAt: new Date() },
    })
    const withState = await this.prisma.systemBroadcast.findUniqueOrThrow({
      where: { id },
      include: { readStates: { where: { endUserId } } },
    })
    return this.toBroadcastItem(withState, endUserId)
  }

  async dismissBroadcast(endUserId: string, id: string): Promise<{ deleted: true }> {
    const broadcast = await this.prisma.systemBroadcast.findFirst({ where: { id, deletedAt: null } })
    if (!broadcast) throw new NotFoundException({ error: { code: 'BROADCAST_NOT_FOUND', message: '系统通知不存在' } })
    await this.prisma.broadcastReadState.upsert({
      where: { endUserId_broadcastId: { endUserId, broadcastId: id } },
      create: { endUserId, broadcastId: id, readAt: new Date(), dismissedAt: new Date() },
      update: { dismissedAt: new Date() },
    })
    return { deleted: true }
  }

  async markAllRead(endUserId: string): Promise<{ updated: number }> {
    const now = new Date()
    const personal = await this.prisma.memberNotification.updateMany({
      where: { endUserId, deletedAt: null, isRead: false },
      data: { isRead: true, readAt: now },
    })
    const broadcasts = await this.prisma.systemBroadcast.findMany({
      where: { deletedAt: null, readStates: { none: { endUserId } } },
      select: { id: true },
      take: 100,
    })
    for (const broadcast of broadcasts) {
      await this.prisma.broadcastReadState.upsert({
        where: { endUserId_broadcastId: { endUserId, broadcastId: broadcast.id } },
        create: { endUserId, broadcastId: broadcast.id, readAt: now },
        update: { readAt: now },
      })
    }
    return { updated: personal.count + broadcasts.length }
  }

  async listBroadcasts(): Promise<{ items: AdminBroadcastItem[] }> {
    const rows = await this.prisma.systemBroadcast.findMany({ orderBy: { createdAt: 'desc' }, take: 100 })
    return { items: rows.map(this.toAdminBroadcast) }
  }

  async createBroadcast(admin: AuthedUser, dto: CreateBroadcastDto): Promise<AdminBroadcastItem> {
    this.assertSafeCopy(`${dto.title} ${dto.content}`)
    const row = await this.prisma.systemBroadcast.create({
      data: {
        title: dto.title.trim(),
        content: dto.content.trim(),
        category: dto.category ?? 'system',
        createdBy: admin.userId,
      },
    })
    await this.audit.write({
      actorId: admin.userId,
      actorRole: admin.role,
      action: 'member_notification.broadcast.create',
      targetType: 'SystemBroadcast',
      targetId: row.id,
      payload: { title: row.title, category: row.category },
    })
    return this.toAdminBroadcast(row)
  }

  async deleteBroadcast(admin: AuthedUser, id: string): Promise<{ deleted: true }> {
    const row = await this.prisma.systemBroadcast.findFirst({ where: { id, deletedAt: null } })
    if (!row) throw new NotFoundException({ error: { code: 'BROADCAST_NOT_FOUND', message: '系统通知不存在' } })
    await this.prisma.systemBroadcast.update({ where: { id }, data: { deletedAt: new Date() } })
    await this.audit.write({
      actorId: admin.userId,
      actorRole: admin.role,
      action: 'member_notification.broadcast.delete',
      targetType: 'SystemBroadcast',
      targetId: id,
      payload: { title: row.title },
    })
    return { deleted: true }
  }

  private async countUnread(endUserId: string): Promise<number> {
    const personal = await this.prisma.memberNotification.count({ where: { endUserId, deletedAt: null, isRead: false } })
    const broadcasts = await this.prisma.systemBroadcast.count({
      where: { deletedAt: null, readStates: { none: { endUserId, OR: [{ readAt: { not: null } }, { dismissedAt: { not: null } }] } } },
    })
    return personal + broadcasts
  }

  private assertSafeCopy(text: string): void {
    if (FORBIDDEN_RECRUITING_COPY.test(text)) {
      throw new BadRequestException({ error: { code: 'NOTIFICATION_COPY_FORBIDDEN', message: '通知内容不能包含招聘流程或结果承诺' } })
    }
  }

  private toPersonalItem(row: {
    id: string
    title: string
    content: string
    category: string
    relatedType: string | null
    relatedId: string | null
    isRead: boolean
    createdAt: Date
  }): MemberNotificationItem {
    return {
      id: row.id,
      kind: 'personal',
      title: row.title,
      content: row.content,
      category: row.category as MemberNotificationItem['category'],
      relatedType: row.relatedType as MemberNotificationItem['relatedType'],
      relatedId: row.relatedId,
      isRead: row.isRead,
      createdAt: row.createdAt.toISOString(),
    }
  }

  private toBroadcastItem(row: {
    id: string
    title: string
    content: string
    category: string
    createdAt: Date
    readStates: Array<{ readAt: Date | null; dismissedAt: Date | null }>
  }, _endUserId: string): MemberNotificationItem {
    const state = row.readStates[0]
    return {
      id: row.id,
      kind: 'broadcast',
      title: row.title,
      content: row.content,
      category: row.category as SystemBroadcastCategory,
      relatedType: null,
      relatedId: null,
      isRead: Boolean(state?.readAt),
      createdAt: row.createdAt.toISOString(),
    }
  }

  private toAdminBroadcast(row: {
    id: string
    title: string
    content: string
    category: string
    deletedAt: Date | null
    createdBy: string | null
    createdAt: Date
  }): AdminBroadcastItem {
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      category: row.category as SystemBroadcastCategory,
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
    }
  }
}
