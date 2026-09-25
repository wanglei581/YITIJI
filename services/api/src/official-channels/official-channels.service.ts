import { randomBytes } from 'node:crypto'
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import { AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import { isRecruitmentContentHostingEnabled } from '../recruitment-hosting/recruitment-hosting'
import {
  contentBlockers,
  parseDomainPolicy,
  validateLandingUrl,
} from '../recruitment-content/recruitment-content-readiness'
import { OFFICIAL_CHANNEL_CATEGORY, OFFICIAL_CHANNEL_CODES as CODE } from './official-channel.constants'
import {
  hostMatchesVerifiedDomain,
  httpsHostnameOf,
  isCommercialRecruitmentHost,
} from './registrable-domain'
import { normalizeVerifiedDomainList, parseVerifiedDomains, type VerifiedDomainRecord } from './verified-domains'
import type { CreateOfficialChannelDto, UpdateOfficialChannelDto } from './dto/official-channel.dto'

export interface OfficialChannelPublicItem {
  name: string
  url: string
  displayOrder: number
  organizationName: string
}

export interface OfficialChannelPartnerItem extends OfficialChannelPublicItem {
  id: string
  enabled: boolean
}

function fail(status: 'bad' | 'forbidden' | 'missing', code: string, message: string): never {
  const body = { error: { code, message } }
  if (status === 'forbidden') throw new ForbiddenException(body)
  if (status === 'missing') throw new NotFoundException(body)
  throw new BadRequestException(body)
}

@Injectable()
export class OfficialChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listVerifiedDomains(orgId: string): Promise<{ items: VerifiedDomainRecord[] }> {
    const org = await this.requireOrg(orgId)
    return { items: parseVerifiedDomains(org.verifiedOfficialDomainsJson) }
  }

  async replaceVerifiedDomains(
    orgId: string,
    rawDomains: string[],
    actor: AuthedUser,
  ): Promise<{ items: VerifiedDomainRecord[] }> {
    const org = await this.requireOrg(orgId)
    const normalized = normalizeVerifiedDomainList(
      rawDomains,
      parseVerifiedDomains(org.verifiedOfficialDomainsJson),
      actor.userId,
      new Date().toISOString(),
    )
    if (!normalized.ok) {
      fail('bad', CODE.verifiedDomainInvalid, `不是可核验的官方注册域：${normalized.value}`)
    }
    await this.prisma.organization.update({
      where: { id: orgId },
      data: { verifiedOfficialDomainsJson: JSON.stringify(normalized.items) },
    })
    await this.audit.write({
      actorId: actor.userId,
      actorRole: actor.role,
      action: 'organization.verified_domains_replace',
      targetType: 'organization',
      targetId: orgId,
      payload: { domains: normalized.items.map((item) => item.domain) },
    })
    return { items: normalized.items }
  }

  async listForPartner(user: AuthedUser): Promise<{ items: OfficialChannelPartnerItem[] }> {
    const org = await this.requirePartnerOrg(user)
    const rows = await this.prisma.onlinePlatformDirectory.findMany({
      where: { organizationId: org.id, category: OFFICIAL_CHANNEL_CATEGORY, archivedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    })
    return { items: rows.map((row) => this.toPartnerItem(row, org.name)) }
  }

  async createForPartner(user: AuthedUser, dto: CreateOfficialChannelDto): Promise<OfficialChannelPartnerItem> {
    const org = await this.requirePartnerOrg(user)
    const name = this.cleanName(dto.name)
    const url = this.cleanUrl(dto.url, parseVerifiedDomains(org.verifiedOfficialDomainsJson))
    const enabled = dto.enabled ?? true
    const row = await this.prisma.onlinePlatformDirectory.create({
      data: {
        organizationId: org.id,
        name,
        slug: `oc_${randomBytes(8).toString('hex')}`,
        category: OFFICIAL_CHANNEL_CATEGORY,
        landingUrl: url,
        operatorLegalName: org.name,
        officialDomainsJson: org.verifiedOfficialDomainsJson || '[]',
        displayOrder: dto.displayOrder ?? 0,
        status: enabled ? 'active' : 'inactive',
        linkCheckStatus: 'valid',
        lastLinkCheckedAt: new Date(),
      },
    })
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'official_channel.create',
      targetType: 'organization',
      targetId: org.id,
      payload: { channelId: row.id, enabled },
    })
    return this.toPartnerItem(row, org.name)
  }

  async updateForPartner(
    user: AuthedUser,
    channelId: string,
    dto: UpdateOfficialChannelDto,
  ): Promise<OfficialChannelPartnerItem> {
    const org = await this.requirePartnerOrg(user)
    if (dto.name === undefined && dto.url === undefined && dto.displayOrder === undefined && dto.enabled === undefined) {
      fail('bad', CODE.emptyUpdate, '没有可更新的字段')
    }
    const row = await this.prisma.onlinePlatformDirectory.findFirst({
      where: { id: channelId, organizationId: org.id, category: OFFICIAL_CHANNEL_CATEGORY, archivedAt: null },
    })
    if (!row) fail('missing', CODE.notFound, '官方渠道不存在')
    const verified = parseVerifiedDomains(org.verifiedOfficialDomainsJson)
    const url = dto.url === undefined ? row.landingUrl : this.cleanUrl(dto.url, verified)
    const enabled = dto.enabled ?? row.status === 'active'
    if (dto.url !== undefined || enabled) this.cleanUrl(url, verified)
    const name = dto.name === undefined ? row.name : this.cleanName(dto.name)
    const updated = await this.prisma.onlinePlatformDirectory.update({
      where: { id: row.id },
      data: {
        name,
        landingUrl: url,
        displayOrder: dto.displayOrder ?? row.displayOrder,
        status: enabled ? 'active' : 'inactive',
        officialDomainsJson: org.verifiedOfficialDomainsJson || '[]',
        linkCheckStatus: 'valid',
        lastLinkCheckedAt: new Date(),
      },
    })
    await this.audit.write({
      actorId: user.userId,
      actorRole: user.role,
      action: 'official_channel.update',
      targetType: 'organization',
      targetId: org.id,
      payload: { channelId: row.id, enabled },
    })
    return this.toPartnerItem(updated, org.name)
  }

  /**
   * 只按终端身份取数。调用方即使带了别的机构标识，也不传入这里。
   * 没绑机构：items 为空。托管关闭时不返回原平台目录。
   */
  async listForTerminal(terminalId: string): Promise<{
    items: OfficialChannelPublicItem[]
    legacyPlatforms: OfficialChannelPublicItem[]
  }> {
    const terminal = await this.prisma.terminal.findUnique({
      where: { id: terminalId },
      select: {
        orgId: true,
        org: { select: { name: true, verifiedOfficialDomainsJson: true } },
      },
    })
    if (!terminal) fail('missing', CODE.terminalNotFound, '终端不存在')
    const hosting = isRecruitmentContentHostingEnabled()
    const items = terminal.orgId && terminal.org
      ? await this.publicChannels(terminal.orgId, terminal.org.name, terminal.org.verifiedOfficialDomainsJson)
      : []
    return { items, legacyPlatforms: hosting ? await this.legacyCatalog() : [] }
  }

  private async publicChannels(
    orgId: string,
    organizationName: string,
    verifiedJson: string,
  ): Promise<OfficialChannelPublicItem[]> {
    const verified = parseVerifiedDomains(verifiedJson)
    const rows = await this.prisma.onlinePlatformDirectory.findMany({
      where: {
        organizationId: orgId,
        category: OFFICIAL_CHANNEL_CATEGORY,
        status: 'active',
        archivedAt: null,
      },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      select: { name: true, landingUrl: true, displayOrder: true },
    })
    return rows
      .filter((row) => this.publicUrlAllowed(row.landingUrl, verified))
      .map((row) => ({
        name: row.name,
        url: row.landingUrl,
        displayOrder: row.displayOrder,
        organizationName,
      }))
  }

  /** b 版本：原平台目录里发布就绪、且不属于某一家机构渠道的行。 */
  private async legacyCatalog(): Promise<OfficialChannelPublicItem[]> {
    const rows = await this.prisma.onlinePlatformDirectory.findMany({
      where: {
        organizationId: null,
        status: 'active',
        reviewStatus: 'approved',
        publishStatus: 'published',
        linkCheckStatus: 'valid',
        archivedAt: null,
      },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    })
    return rows.filter((row) => this.legacyReady(row)).map((row) => ({
      name: row.name,
      url: row.landingUrl,
      displayOrder: row.displayOrder,
      organizationName: row.operatorLegalName,
    }))
  }

  private legacyReady(row: {
    status: string
    reviewStatus: string
    publishStatus: string
    contentHash: string | null
    approvedContentHash: string | null
    hashAlgorithmVersion: string | null
    archivedAt: Date | null
    validFrom: Date | null
    validUntil: Date | null
    officialDomainsJson: string
    landingUrl: string
    linkCheckStatus: string
  }): boolean {
    if (contentBlockers(row).length > 0) return false
    if (row.validFrom && row.validFrom.getTime() > Date.now()) return false
    if (row.validUntil && row.validUntil.getTime() <= Date.now()) return false
    const domains = parseDomainPolicy(row.officialDomainsJson)
    if (!domains.valid) return false
    const landing = validateLandingUrl(row.landingUrl, domains.domains)
    return landing.validUrl && landing.allowedDomain && row.linkCheckStatus === 'valid'
  }

  private publicUrlAllowed(url: string, verified: VerifiedDomainRecord[]): boolean {
    const host = httpsHostnameOf(url)
    if (!host || isCommercialRecruitmentHost(host)) return false
    return verified.some((item) => hostMatchesVerifiedDomain(host, item.domain))
  }

  private cleanName(raw: string): string {
    const name = raw.trim()
    if (!name || name.length > 40) fail('bad', CODE.nameInvalid, '渠道名称需要 1 到 40 个字')
    return name
  }

  private cleanUrl(raw: string, verified: VerifiedDomainRecord[]): string {
    const host = httpsHostnameOf(raw)
    if (!host) fail('bad', CODE.urlInvalid, '链接必须是不带账号的 https 地址')
    if (isCommercialRecruitmentHost(host)) {
      fail('bad', CODE.commercialHost, '不能把商业招聘网站保存为本机构官方渠道')
    }
    if (!verified.some((item) => hostMatchesVerifiedDomain(host, item.domain))) {
      fail('bad', CODE.domainNotVerified, '链接域名不在该机构已核验的官方域名内')
    }
    return raw.trim()
  }

  private async requireOrg(orgId: string): Promise<{ id: string; verifiedOfficialDomainsJson: string; name: string }> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, verifiedOfficialDomainsJson: true },
    })
    if (!org) fail('missing', CODE.orgNotFound, '机构不存在')
    return org
  }

  private async requirePartnerOrg(user: AuthedUser): Promise<{ id: string; name: string; verifiedOfficialDomainsJson: string }> {
    if (user.role !== 'partner' || !user.orgId) fail('forbidden', CODE.orgRequired, '当前账号未绑定机构')
    return this.requireOrg(user.orgId)
  }

  private toPartnerItem(
    row: { id: string; name: string; landingUrl: string; displayOrder: number; status: string },
    organizationName: string,
  ): OfficialChannelPartnerItem {
    return {
      id: row.id,
      name: row.name,
      url: row.landingUrl,
      displayOrder: row.displayOrder,
      enabled: row.status === 'active',
      organizationName,
    }
  }
}
