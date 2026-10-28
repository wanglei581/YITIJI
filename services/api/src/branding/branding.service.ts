import { BadRequestException, Injectable } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { PrismaService, type PrismaTransactionClient } from '../prisma/prisma.service'
import { BrandLogoService } from './brand-logo.service'
import {
  normalizeBrandMark,
  normalizeBrandName,
  normalizeFilingText,
  normalizeFilingUrl,
  normalizeLogoAssetId,
} from './branding.validation'
import {
  BRAND_SETTING_KEYS,
  DEFAULT_BRANDING_FILING,
  DEFAULT_BRAND_MARK,
  DEFAULT_BRAND_NAME,
  brandLogoUrl,
  type AdminBranding,
  type BrandingFiling,
  type PublicBrand,
  type UpdateBrandingInput,
} from './branding.types'

const AUDIT_ACTION = 'branding.update'

type SettingStore = PrismaService | PrismaTransactionClient

/** 库里存的平台品牌原值：null = 没配、用默认。 */
export interface PlatformBrandStored {
  brandName: string | null
  brandMark: string | null
  logoAssetId: string | null
  icp: string | null
  icpUrl: string | null
  police: string | null
  policeUrl: string | null
}

/** 机构资料里的品牌覆盖三项（库存值）。 */
export interface OrgBrandRow {
  brandName: string | null
  brandMark: string | null
  brandLogoAssetId: string | null
}

export interface ResolvedBrand {
  brandName: string
  brandMark: string
  /** 按优先级排好的候选 Logo 编号（机构的在前，平台的在后）；取第一个真实存在的。 */
  logoCandidates: string[]
  filing: BrandingFiling
}

export interface BrandingActor {
  userId: string
  role: string
  ipAddress?: string | null
  userAgent?: string | null
  requestId?: string | null
}

function storedText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * 解析顺序：机构覆盖 → 平台默认，逐项独立回退。
 * 备案只取平台这一档：备案号与实际网站主体对应，不随机构品牌走。
 * org 为 null（终端没绑机构、或请求没验签）就是纯平台默认。
 */
export function resolveBrand(stored: PlatformBrandStored, org: OrgBrandRow | null): ResolvedBrand {
  const logoCandidates = [storedText(org?.brandLogoAssetId), stored.logoAssetId].filter(
    (id): id is string => id !== null,
  )
  return {
    brandName: storedText(org?.brandName) ?? stored.brandName ?? DEFAULT_BRAND_NAME,
    brandMark: storedText(org?.brandMark) ?? stored.brandMark ?? DEFAULT_BRAND_MARK,
    logoCandidates,
    filing: {
      icp: stored.icp ?? DEFAULT_BRANDING_FILING.icp,
      icpUrl: stored.icpUrl ?? DEFAULT_BRANDING_FILING.icpUrl,
      police: stored.police ?? DEFAULT_BRANDING_FILING.police,
      policeUrl: stored.policeUrl ?? DEFAULT_BRANDING_FILING.policeUrl,
    },
  }
}

@Injectable()
export class BrandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly logos: BrandLogoService,
  ) {}

  async readStored(db: SettingStore = this.prisma): Promise<PlatformBrandStored> {
    const rows = await db.platformSetting.findMany({
      where: { key: { in: Object.values(BRAND_SETTING_KEYS) } },
      select: { key: true, value: true },
    })
    const map = new Map(rows.map((row) => [row.key, row.value]))
    const read = (key: string) => storedText(map.get(key))
    return {
      brandName: read(BRAND_SETTING_KEYS.name),
      brandMark: read(BRAND_SETTING_KEYS.mark),
      logoAssetId: read(BRAND_SETTING_KEYS.logo),
      icp: read(BRAND_SETTING_KEYS.icp),
      icpUrl: read(BRAND_SETTING_KEYS.icpUrl),
      police: read(BRAND_SETTING_KEYS.police),
      policeUrl: read(BRAND_SETTING_KEYS.policeUrl),
    }
  }

  /** 候选里第一个真实存在的 Logo 变成公开地址；都没有就是 null（前端回退字标）。 */
  async toPublicBrand(resolved: ResolvedBrand): Promise<PublicBrand> {
    const logoId = await this.logos.firstExisting(resolved.logoCandidates)
    return {
      brandName: resolved.brandName,
      brandMark: resolved.brandMark,
      logoUrl: logoId ? brandLogoUrl(logoId) : null,
    }
  }

  /** GET /public/brand：不带终端，只给平台默认（不含任何机构、点位信息）。 */
  async getPublicBrand(): Promise<PublicBrand> {
    return this.toPublicBrand(resolveBrand(await this.readStored(), null))
  }

  async getAdmin(): Promise<AdminBranding> {
    return this.toAdmin(await this.readStored())
  }

  /**
   * 只更新请求里出现的字段（省略 = 不改；null 或纯空白 = 清除，回到默认）。
   * 空请求不写库、不写审计。配置与审计在同一事务里：审计失败则配置回滚。
   */
  async updateAdmin(input: UpdateBrandingInput, actor: BrandingActor): Promise<AdminBranding> {
    const writes: Array<[string, string | null]> = []
    if (input.brandName !== undefined) writes.push([BRAND_SETTING_KEYS.name, normalizeBrandName(input.brandName)])
    if (input.brandMark !== undefined) writes.push([BRAND_SETTING_KEYS.mark, normalizeBrandMark(input.brandMark)])
    if (input.brandLogoAssetId !== undefined) {
      const assetId = normalizeLogoAssetId(input.brandLogoAssetId)
      if (assetId !== null && !(await this.logos.exists(assetId))) {
        throw new BadRequestException({
          error: { code: 'BRAND_LOGO_NOT_FOUND', message: '这张 Logo 不存在，请先上传' },
        })
      }
      writes.push([BRAND_SETTING_KEYS.logo, assetId])
    }
    const filing = input.filing
    if (filing) {
      if (filing.icp !== undefined) writes.push([BRAND_SETTING_KEYS.icp, normalizeFilingText(filing.icp, 'ICP 备案号')])
      if (filing.icpUrl !== undefined) {
        writes.push([BRAND_SETTING_KEYS.icpUrl, normalizeFilingUrl(filing.icpUrl, 'ICP 备案查询链接')])
      }
      if (filing.police !== undefined) {
        writes.push([BRAND_SETTING_KEYS.police, normalizeFilingText(filing.police, '公安备案号')])
      }
      if (filing.policeUrl !== undefined) {
        writes.push([BRAND_SETTING_KEYS.policeUrl, normalizeFilingUrl(filing.policeUrl, '公安备案查询链接')])
      }
    }
    if (writes.length === 0) return this.getAdmin()

    const after = await this.prisma.$transaction(async (tx) => {
      const before = await this.readStored(tx)
      for (const [key, value] of writes) {
        await tx.platformSetting.upsert({
          where: { key },
          create: { key, value, updatedBy: actor.userId },
          update: { value, updatedBy: actor.userId },
        })
      }
      const next = await this.readStored(tx)
      await this.audit.writeRequired(tx, {
        actorId: actor.userId,
        actorRole: actor.role,
        action: AUDIT_ACTION,
        targetType: 'system',
        targetId: 'branding',
        payload: { before, after: next },
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      })
      return next
    })
    return this.toAdmin(after)
  }

  private async toAdmin(stored: PlatformBrandStored): Promise<AdminBranding> {
    const logoId = await this.logos.firstExisting([stored.logoAssetId])
    return {
      brandName: stored.brandName,
      brandMark: stored.brandMark,
      brandLogoAssetId: stored.logoAssetId,
      logoUrl: logoId ? brandLogoUrl(logoId) : null,
      filing: {
        icp: stored.icp,
        icpUrl: stored.icpUrl,
        police: stored.police,
        policeUrl: stored.policeUrl,
      },
      defaults: {
        brandName: DEFAULT_BRAND_NAME,
        brandMark: DEFAULT_BRAND_MARK,
        filing: { ...DEFAULT_BRANDING_FILING },
      },
    }
  }
}
