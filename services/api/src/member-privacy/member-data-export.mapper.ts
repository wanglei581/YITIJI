import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

export const MEMBER_EXPORT_SCHEMA_VERSION = 'member-data-export-v1'
export const MEMBER_EXPORT_SECTION_ROW_LIMIT = 500

type JsonScalar = string | number | boolean | null
type JsonRecord = Record<string, JsonScalar>

export interface MemberDataExportEnvelope {
  schemaVersion: typeof MEMBER_EXPORT_SCHEMA_VERSION
  generatedAt: string
  requestId: string
  sections: {
    account: JsonRecord | null
    files: JsonRecord[]
    aiRecords: {
      resumeResults: JsonRecord[]
      jobSessions: JsonRecord[]
      mockInterviews: JsonRecord[]
    }
    printOrders: JsonRecord[]
    favorites: JsonRecord[]
    benefits: JsonRecord[]
    activity: {
      browsing: JsonRecord[]
      externalOpens: JsonRecord[]
    }
    notifications: JsonRecord[]
    feedback: JsonRecord[]
    consents: JsonRecord[]
    requests: JsonRecord[]
  }
}

export class MemberDataExportLimitError extends Error {
  readonly code = 'EXPORT_TOO_LARGE'

  constructor() {
    super('member data export exceeds the configured row limit')
  }
}

@Injectable()
export class MemberDataExportMapper {
  constructor(private readonly prisma: PrismaService) {}

  async build(input: {
    endUserId: string
    requestId: string
    generatedAt?: Date
  }): Promise<MemberDataExportEnvelope> {
    const take = MEMBER_EXPORT_SECTION_ROW_LIMIT + 1
    const [
      account,
      files,
      resumeResults,
      jobSessions,
      mockInterviews,
      printOrders,
      favorites,
      benefits,
      browsing,
      externalOpens,
      notifications,
      feedback,
      consents,
      requests,
    ] = await Promise.all([
      this.prisma.endUser.findUnique({
        where: { id: input.endUserId },
        select: { id: true, nickname: true, status: true, createdAt: true, lastLoginAt: true },
      }),
      this.prisma.fileObject.findMany({
        where: { endUserId: input.endUserId },
        select: {
          id: true,
          filename: true,
          mimeType: true,
          sizeBytes: true,
          purpose: true,
          assetCategory: true,
          status: true,
          createdAt: true,
          expiresAt: true,
          deletedAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
      }),
      this.prisma.aiResumeResult.findMany({
        where: { endUserId: input.endUserId },
        select: {
          id: true,
          taskId: true,
          kind: true,
          status: true,
          provider: true,
          createdAt: true,
          updatedAt: true,
          expiresAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
      }),
      this.prisma.jobAiSession.findMany({
        where: { endUserId: input.endUserId },
        select: {
          id: true,
          operation: true,
          status: true,
          provider: true,
          createdAt: true,
          updatedAt: true,
          expiresAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
      }),
      this.prisma.mockInterviewSession.findMany({
        where: { endUserId: input.endUserId },
        select: {
          id: true,
          status: true,
          interviewerType: true,
          industry: true,
          position: true,
          experience: true,
          difficulty: true,
          durationMin: true,
          interactionMode: true,
          startedAt: true,
          endedAt: true,
          createdAt: true,
          expiresAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
      }),
      this.prisma.order.findMany({
        where: { endUserId: input.endUserId },
        select: {
          id: true,
          orderNo: true,
          type: true,
          amountCents: true,
          currency: true,
          payStatus: true,
          taskStatus: true,
          paymentSource: true,
          paidAt: true,
          payChannel: true,
          discountCents: true,
          refundedAmountCents: true,
          refundedAt: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
      }),
      this.prisma.favorite.findMany({
        where: { endUserId: input.endUserId },
        select: { id: true, targetType: true, targetId: true, title: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
      }),
      this.prisma.benefitGrant.findMany({
        where: { endUserId: input.endUserId },
        select: {
          id: true,
          benefitType: true,
          title: true,
          description: true,
          quantityTotal: true,
          quantityRemaining: true,
          status: true,
          sourceType: true,
          validFrom: true,
          validUntil: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
      }),
      this.prisma.browseLog.findMany({
        where: { endUserId: input.endUserId },
        select: {
          id: true,
          targetType: true,
          targetId: true,
          targetTitle: true,
          sourceName: true,
          externalId: true,
          createdAt: true,
          expiresAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
      }),
      this.prisma.externalJumpLog.findMany({
        where: { endUserId: input.endUserId },
        select: {
          id: true,
          targetType: true,
          targetId: true,
          action: true,
          targetTitle: true,
          sourceName: true,
          externalId: true,
          createdAt: true,
          expiresAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
      }),
      this.prisma.memberNotification.findMany({
        where: { endUserId: input.endUserId },
        select: {
          id: true,
          title: true,
          content: true,
          category: true,
          relatedType: true,
          isRead: true,
          readAt: true,
          deletedAt: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
      }),
      this.prisma.feedbackTicket.findMany({
        where: { endUserId: input.endUserId },
        select: {
          id: true,
          category: true,
          title: true,
          content: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
      }),
      this.prisma.userAiConsent.findMany({
        where: { endUserId: input.endUserId },
        select: { id: true, scope: true, consentVersion: true, grantedAt: true, revokedAt: true },
        orderBy: [{ grantedAt: 'desc' }, { id: 'desc' }],
        take,
      }),
      this.prisma.userDataRequest.findMany({
        where: { endUserId: input.endUserId },
        select: {
          id: true,
          requestType: true,
          status: true,
          executionStep: true,
          exportExpiresAt: true,
          downloadConsumedAt: true,
          failureCode: true,
          requestedAt: true,
          handledAt: true,
        },
        orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
        take,
      }),
    ])

    for (const rows of [
      files,
      resumeResults,
      jobSessions,
      mockInterviews,
      printOrders,
      favorites,
      benefits,
      browsing,
      externalOpens,
      notifications,
      feedback,
      consents,
      requests,
    ]) {
      this.assertWithinLimit(rows)
    }

    return {
      schemaVersion: MEMBER_EXPORT_SCHEMA_VERSION,
      generatedAt: (input.generatedAt ?? new Date()).toISOString(),
      requestId: input.requestId,
      sections: {
        account: this.toJsonRecord(account),
        files: this.toJsonRecords(files),
        aiRecords: {
          resumeResults: this.toJsonRecords(resumeResults),
          jobSessions: this.toJsonRecords(jobSessions),
          mockInterviews: this.toJsonRecords(mockInterviews),
        },
        printOrders: this.toJsonRecords(printOrders),
        favorites: this.toJsonRecords(favorites),
        benefits: this.toJsonRecords(benefits),
        activity: {
          browsing: this.toJsonRecords(browsing),
          externalOpens: this.toJsonRecords(externalOpens),
        },
        notifications: this.toJsonRecords(notifications),
        feedback: this.toJsonRecords(feedback),
        consents: this.toJsonRecords(consents),
        requests: this.toJsonRecords(requests),
      },
    }
  }

  private assertWithinLimit(rows: readonly unknown[]): void {
    if (rows.length > MEMBER_EXPORT_SECTION_ROW_LIMIT) throw new MemberDataExportLimitError()
  }

  private toJsonRecord(value: object | null): JsonRecord | null {
    return value ? this.sanitizeJson(JSON.parse(JSON.stringify(value))) as JsonRecord : null
  }

  private toJsonRecords(values: readonly object[]): JsonRecord[] {
    return this.sanitizeJson(JSON.parse(JSON.stringify(values))) as JsonRecord[]
  }

  private sanitizeJson(value: unknown): unknown {
    if (typeof value === 'string') return value.replace(/1[3-9]\d{9}/g, (phone) => `${phone.slice(0, 3)}****${phone.slice(7)}`)
    if (Array.isArray(value)) return value.map((item) => this.sanitizeJson(item))
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, child]) => [key, this.sanitizeJson(child)]),
    )
  }
}
