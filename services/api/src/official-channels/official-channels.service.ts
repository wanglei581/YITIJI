import { randomBytes } from 'node:crypto'
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import { AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'
import type { PrismaTransactionClient } from '../prisma/prisma.service'
import { isContentTrustActive } from '../common/content-trust'
import { isRecruitmentContentHostingEnabled } from '../recruitment-hosting/recruitment-hosting'
import {
  contentBlockers,
  parseDomainPolicy,
  validateLandingUrl,
} from '../recruitment-content/recruitment-content-readiness'
import { OFFICIAL_CHANNEL_CATEGORY, OFFICIAL_CHANNEL_CODES as CODE } from './official-channel.constants'
import {
  httpsHostnameOf,
  isCommercialRecruitmentHost,
  verifiedHttpsUrl,
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
  emergencyTakedown: boolean
  emergencyReasonCode: string | null
  emergencyReasonText: string | null
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
    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.findUnique({ where: { id: orgId }, select: { verifiedOfficialDomainsJson: true } })
      if (!org) fail('missing', CODE.orgNotFound, '机构不存在')
      const normalized = normalizeVerifiedDomainList(
        rawDomains, parseVerifiedDomains(org.verifiedOfficialDomainsJson), actor.userId, new Date().toISOString(),
      )
      if (!normalized.ok) fail('bad', CODE.verifiedDomainInvalid, `不是可核验的官方注册域：${normalized.value}`)
      await tx.organization.update({
        where: { id: orgId },
        data: { verifiedOfficialDomainsJson: JSON.stringify(normalized.items) },
      })
      await this.audit.writeRequired(tx, {
        actorId: actor.userId,
        actorRole: actor.role,
        action: 'organization.verified_domains_replace',
        targetType: 'organization',
        targetId: orgId,
        payload: { domains: normalized.items.map((item) => item.domain), basis: 'organization_identity_verification' },
      })
      return { items: normalized.items }
    })
  }

  async listForPartner(user: AuthedUser): Promise<{ items: OfficialChannelPartnerItem[] }> {
    const org = await this.requirePartnerOrg(user)
    const rows = await this.prisma.onlinePlatformDirectory.findMany({
      where: { organizationId: org.id, category: OFFICIAL_CHANNEL_CATEGORY, archivedAt: null },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
    })
    const holds = await this.prisma.recruitmentEmergencyHold.findMany({
      where: { targetType: 'official_channel', targetId: { in: rows.map((row) => row.id) } },
      select: { targetId: true, reasonCode: true, reasonText: true },
    })
    const byId = new Map(holds.map((hold) => [hold.targetId, hold]))
    return { items: rows.map((row) => this.toPartnerItem(row, org.name, byId.get(row.id))) }
  }

  async createForPartner(user: AuthedUser, dto: CreateOfficialChannelDto): Promise<OfficialChannelPartnerItem> {
    const org = await this.requirePartnerOrg(user)
    const name = this.cleanName(dto.name)
    const url = this.cleanUrl(dto.url, parseVerifiedDomains(org.verifiedOfficialDomainsJson))
    const enabled = dto.enabled ?? true
    const row = await this.prisma.$transaction(async (tx) => {
      const circuit = await tx.recruitmentCircuitBreak.findUnique({
        where: { scope_targetId: { scope: 'org', targetId: org.id } },
      })
      if (circuit) fail('forbidden', CODE.emergencyHeld, '该机构渠道已熔断，不能新增')
      await this.assertLinkNotHeld(tx, url)
      const created = await tx.onlinePlatformDirectory.create({ data: {
        organizationId: org.id,
        name,
        slug: `oc_${randomBytes(8).toString('hex')}`,
        category: OFFICIAL_CHANNEL_CATEGORY,
        landingUrl: url,
        operatorLegalName: org.name,
        officialDomainsJson: org.verifiedOfficialDomainsJson || '[]',
        displayOrder: dto.displayOrder ?? 0,
        status: enabled ? 'active' : 'inactive',
        reviewStatus: 'pending',
        publishStatus: 'draft',
        linkCheckStatus: 'valid',
        lastLinkCheckedAt: new Date(),
      } })
      await this.audit.writeRequired(tx, {
        actorId: user.userId, actorRole: user.role, action: 'official_channel.create',
        targetType: 'official_channel', targetId: created.id, payload: { orgId: org.id, enabled },
      })
      return created
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
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.onlinePlatformDirectory.findFirst({
        where: { id: channelId, organizationId: org.id, category: OFFICIAL_CHANNEL_CATEGORY, archivedAt: null },
      })
      if (!row) fail('missing', CODE.notFound, '官方渠道不存在')
      const hold = await tx.recruitmentEmergencyHold.findUnique({
        where: { targetType_targetId: { targetType: 'official_channel', targetId: row.id } },
      })
      if (hold) fail('forbidden', CODE.emergencyHeld, '该渠道已紧急下架，只能归档')
      const latestOrg = await tx.organization.findUniqueOrThrow({
        where: { id: org.id }, select: { verifiedOfficialDomainsJson: true },
      })
      const verified = parseVerifiedDomains(latestOrg.verifiedOfficialDomainsJson)
      const linkChanged = dto.url !== undefined && verifiedHttpsUrl(dto.url)?.toString() !== row.landingUrl
      const url = linkChanged ? this.cleanUrl(dto.url!, verified) : row.landingUrl
      if (linkChanged) await this.assertLinkNotHeld(tx, url)
      if (dto.enabled === true && row.status !== 'active' && !linkChanged) this.cleanUrl(url, verified)
      const name = dto.name === undefined ? row.name : this.cleanName(dto.name)
      const next = await tx.onlinePlatformDirectory.update({
        where: { id: row.id },
        data: {
          name,
          landingUrl: url,
          displayOrder: dto.displayOrder ?? row.displayOrder,
          ...(dto.enabled === undefined ? {} : { status: dto.enabled ? 'active' : 'inactive' }),
          ...(linkChanged ? {
            officialDomainsJson: latestOrg.verifiedOfficialDomainsJson || '[]',
            linkCheckStatus: 'valid', lastLinkCheckedAt: new Date(),
          } : {}),
        },
      })
      const holdAfterWrite = await tx.recruitmentEmergencyHold.findUnique({
        where: { targetType_targetId: { targetType: 'official_channel', targetId: row.id } },
      })
      if (holdAfterWrite) fail('forbidden', CODE.emergencyHeld, '该渠道已紧急下架，只能归档')
      await this.audit.writeRequired(tx, {
        actorId: user.userId, actorRole: user.role, action: 'official_channel.update',
        targetType: 'official_channel', targetId: row.id, payload: { orgId: org.id, enabled: next.status === 'active', linkChanged },
      })
      return next
    })
    return this.toPartnerItem(updated, org.name)
  }

  async archiveForPartner(user: AuthedUser, channelId: string): Promise<{ archived: true }> {
    const org = await this.requirePartnerOrg(user)
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.onlinePlatformDirectory.updateMany({
        where: { id: channelId, organizationId: org.id, category: OFFICIAL_CHANNEL_CATEGORY, archivedAt: null },
        data: { archivedAt: new Date(), status: 'inactive' },
      })
      if (result.count !== 1) fail('missing', CODE.notFound, '官方渠道不存在')
      await this.audit.writeRequired(tx, {
        actorId: user.userId, actorRole: user.role, action: 'official_channel.archive',
        targetType: 'official_channel', targetId: channelId, payload: { orgId: org.id },
      })
    })
    return { archived: true }
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
        org: { select: { id: true, name: true, verifiedOfficialDomainsJson: true, contentTrustStatus: true, archivedAt: true } },
      },
    })
    if (!terminal) fail('missing', CODE.terminalNotFound, '终端不存在')
    const hosting = isRecruitmentContentHostingEnabled()
    const items = terminal.orgId && terminal.org && isContentTrustActive(terminal.org)
      ? await this.publicChannels(terminal.orgId, terminal.org.name, terminal.org.verifiedOfficialDomainsJson)
      : []
    return { items, legacyPlatforms: hosting ? await this.legacyCatalog() : [] }
  }

  private async publicChannels(
    orgId: string,
    organizationName: string,
    verifiedJson: string,
  ): Promise<OfficialChannelPublicItem[]> {
    const circuit = await this.prisma.recruitmentCircuitBreak.findUnique({
      where: { scope_targetId: { scope: 'org', targetId: orgId } },
      select: { id: true },
    })
    if (circuit) return []
    const verified = parseVerifiedDomains(verifiedJson)
    const rows = await this.prisma.onlinePlatformDirectory.findMany({
      where: {
        organizationId: orgId,
        category: OFFICIAL_CHANNEL_CATEGORY,
        status: 'active',
        archivedAt: null,
      },
      orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, landingUrl: true, displayOrder: true },
    })
    const holds = await this.prisma.recruitmentEmergencyHold.findMany({
      where: { targetType: 'official_channel', targetId: { in: rows.map((row) => row.id) } },
      select: { targetId: true },
    })
    const held = new Set(holds.map((hold) => hold.targetId))
    return rows
      .filter((row) => !held.has(row.id))
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
        OR: [{ category: null }, { category: { not: OFFICIAL_CHANNEL_CATEGORY } }],
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
    const checked = verifiedHttpsUrl(url, verified.map((item) => item.domain))
    return !!checked && !isCommercialRecruitmentHost(checked.hostname)
  }

  /** A permanent hold follows the canonical link across channels and organizations. */
  private async assertLinkNotHeld(tx: PrismaTransactionClient, url: string): Promise<void> {
    const rows = await tx.onlinePlatformDirectory.findMany({
      where: { category: OFFICIAL_CHANNEL_CATEGORY, landingUrl: url }, select: { id: true },
    })
    if (!rows.length) return
    const hold = await tx.recruitmentEmergencyHold.findFirst({
      where: { targetType: 'official_channel', targetId: { in: rows.map((row) => row.id) } }, select: { id: true },
    })
    if (hold) fail('forbidden', CODE.emergencyHeld, '该链接已紧急下架，不能再次创建或使用')
  }

  private cleanName(raw: string): string {
    const name = raw.trim()
    if (!name || name.length > 40) fail('bad', CODE.nameInvalid, '渠道名称需要 1 到 40 个字')
    return name
  }

  private cleanUrl(raw: string, verified: VerifiedDomainRecord[]): string {
    const checked = verifiedHttpsUrl(raw, verified.map((item) => item.domain))
    const host = httpsHostnameOf(raw)
    if (!host) fail('bad', CODE.urlInvalid, '链接必须是不带账号的 https 地址')
    if (isCommercialRecruitmentHost(host)) {
      fail('bad', CODE.commercialHost, '不能把商业招聘网站保存为本机构官方渠道')
    }
    if (!checked) fail('bad', CODE.domainNotVerified, '链接或跳转目标不在该机构已核验的官方域名内')
    return checked.toString()
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
    hold?: { reasonCode: string; reasonText: string },
  ): OfficialChannelPartnerItem {
    return {
      id: row.id,
      name: row.name,
      url: row.landingUrl,
      displayOrder: row.displayOrder,
      enabled: row.status === 'active',
      emergencyTakedown: !!hold,
      emergencyReasonCode: hold?.reasonCode ?? null,
      emergencyReasonText: hold?.reasonText ?? null,
      organizationName,
    }
  }
}
