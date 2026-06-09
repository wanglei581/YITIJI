import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import type { UpdatePartnerProfileDto } from './dto/update-partner-profile.dto'
import type { PartnerProfile } from './partner-profile.types'

interface OrgRow {
  id: string
  name: string
  type: string
  contact: string | null
  enabled: boolean
  creditCode: string | null
  contactPhone: string | null
  contactEmail: string | null
  address: string | null
  description: string | null
  websiteUrl: string | null
  createdAt: Date
  updatedAt: Date
}

/** 空串归一为 null（可选字段清空 = null）。 */
function norm(v: string | undefined): string | null {
  if (v === undefined || v === null) return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

@Injectable()
export class PartnerProfileService {
  constructor(private readonly prisma: PrismaService) {}

  /** 读取本机构资料（orgId 来自 JWT）。 */
  async getProfile(user: AuthedUser): Promise<PartnerProfile> {
    const org = await this.findOwnOrg(user)
    return this.toProfile(org)
  }

  /**
   * 更新本机构资料。返回变更字段 + 变更前后值（供审计），以及更新后的 profile。
   * contactName 落 Organization.contact；type / enabled 不在此处改（管理员维护）。
   */
  async updateProfile(
    user: AuthedUser,
    dto: UpdatePartnerProfileDto,
  ): Promise<{ changedFields: string[]; before: Record<string, unknown>; after: Record<string, unknown>; detail: PartnerProfile }> {
    const org = await this.findOwnOrg(user)

    // 逻辑字段 → (新值, 旧值, Organization 列名)
    const next = {
      name: { value: dto.name.trim(), old: org.name, column: 'name' },
      contactName: { value: dto.contactName.trim(), old: org.contact, column: 'contact' },
      contactPhone: { value: dto.contactPhone.trim(), old: org.contactPhone, column: 'contactPhone' },
      creditCode: { value: norm(dto.creditCode), old: org.creditCode, column: 'creditCode' },
      contactEmail: { value: norm(dto.contactEmail), old: org.contactEmail, column: 'contactEmail' },
      address: { value: norm(dto.address), old: org.address, column: 'address' },
      description: { value: norm(dto.description), old: org.description, column: 'description' },
      websiteUrl: { value: norm(dto.websiteUrl), old: org.websiteUrl, column: 'websiteUrl' },
    }

    const data: Record<string, unknown> = {}
    const changedFields: string[] = []
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    for (const [field, { value, old, column }] of Object.entries(next)) {
      data[column] = value
      if ((old ?? null) !== (value ?? null)) {
        changedFields.push(field)
        before[field] = old ?? null
        after[field] = value ?? null
      }
    }

    const updated = (await this.prisma.organization.update({ where: { id: org.id }, data })) as OrgRow
    return { changedFields, before, after, detail: this.toProfile(updated) }
  }

  // ── 内部 ──────────────────────────────────────────────────────────────────────

  private async findOwnOrg(user: AuthedUser): Promise<OrgRow> {
    if (!user.orgId) {
      throw new BadRequestException({ error: { code: 'PARTNER_ORG_REQUIRED', message: 'partner 账号必须挂在机构下' } })
    }
    const org = (await this.prisma.organization.findUnique({ where: { id: user.orgId } })) as OrgRow | null
    if (!org) {
      throw new NotFoundException({ error: { code: 'PARTNER_PROFILE_NOT_FOUND', message: '未找到本机构资料' } })
    }
    return org
  }

  private toProfile(org: OrgRow): PartnerProfile {
    return {
      id: org.id,
      name: org.name,
      type: org.type,
      creditCode: org.creditCode,
      contactName: org.contact,
      contactPhone: org.contactPhone,
      contactEmail: org.contactEmail,
      address: org.address,
      description: org.description,
      websiteUrl: org.websiteUrl,
      enabled: org.enabled,
      createdAt: org.createdAt.toISOString(),
      updatedAt: org.updatedAt.toISOString(),
    }
  }
}
