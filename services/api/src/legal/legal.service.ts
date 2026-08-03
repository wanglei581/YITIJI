import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

export const LEGAL_DOC_TYPES = ['privacy_policy', 'terms_of_service', 'ai_disclaimer'] as const
export type LegalDocType = (typeof LEGAL_DOC_TYPES)[number]

export interface LegalDocActiveView {
  id: string
  docType: string
  version: string
  title: string
  content: string
  publishedAt: Date | null
}

export interface LegalDocListItem {
  id: string
  docType: string
  version: string
  title: string
  isActive: boolean
  publishedAt: Date | null
  publishedBy: string | null
  createdAt: Date
}

export interface CreateLegalDocDto {
  docType: string
  version: string
  title: string
  content: string
  adminId: string
}

@Injectable()
export class LegalService {
  constructor(private prisma: PrismaService) {}

  /** Kiosk 公开读取：返回指定类型的当前有效版本（无鉴权） */
  async getActive(docType: LegalDocType): Promise<LegalDocActiveView | null> {
    return this.prisma.legalDocVersion.findFirst({
      where: { docType, isActive: true },
      select: {
        id: true,
        docType: true,
        version: true,
        title: true,
        content: true,
        publishedAt: true,
      },
    })
  }

  /** Admin：列出全部版本，可按 docType 筛选，最新创建在前 */
  async list(docType?: string): Promise<LegalDocListItem[]> {
    return this.prisma.legalDocVersion.findMany({
      where: docType ? { docType } : undefined,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        docType: true,
        version: true,
        title: true,
        isActive: true,
        publishedAt: true,
        publishedBy: true,
        createdAt: true,
      },
    })
  }

  /** Admin：创建草稿（isActive=false） */
  async create(dto: CreateLegalDocDto) {
    if (!LEGAL_DOC_TYPES.includes(dto.docType as LegalDocType)) {
      throw new BadRequestException(`无效的 docType：${dto.docType}`)
    }
    return this.prisma.legalDocVersion.create({
      data: {
        docType: dto.docType,
        version: dto.version,
        title: dto.title,
        content: dto.content,
        isActive: false,
        publishedBy: dto.adminId,
      },
      select: {
        id: true,
        docType: true,
        version: true,
        title: true,
        isActive: true,
        createdAt: true,
      },
    })
  }

  /** Admin：激活指定版本（同类型其余版本同时失活），并写审计日志 */
  async activate(id: string, adminId: string) {
    const doc = await this.prisma.legalDocVersion.findUnique({ where: { id } })
    if (!doc) throw new NotFoundException('LegalDocVersion not found')

    await this.prisma.$transaction([
      this.prisma.legalDocVersion.updateMany({
        where: { docType: doc.docType, isActive: true },
        data: { isActive: false },
      }),
      this.prisma.legalDocVersion.update({
        where: { id },
        data: { isActive: true, publishedAt: new Date(), publishedBy: adminId },
      }),
    ])

    // 审计日志写入失败不阻塞激活
    this.prisma.auditLog
      .create({
        data: {
          actorId: adminId,
          actorRole: 'admin',
          action: 'legal_doc.activate',
          targetType: 'LegalDocVersion',
          targetId: id,
          payloadJson: JSON.stringify({ docType: doc.docType, version: doc.version }),
        },
      })
      .catch(() => {})

    return this.prisma.legalDocVersion.findUnique({
      where: { id },
      select: {
        id: true,
        docType: true,
        version: true,
        title: true,
        isActive: true,
        publishedAt: true,
      },
    })
  }
}
