import { BadRequestException } from '@nestjs/common'
import type { PrismaService } from '../prisma/prisma.service'
import { normalizeBrandMark, normalizeBrandName, normalizeLogoAssetId } from './branding.validation'
import { BRAND_LOGO_ID_PATTERN, brandLogoUrl, type OrgBrandOverride } from './branding.types'

/**
 * 机构资料里的品牌覆盖三项（Organization.brandName / brandMark / brandLogoAssetId）。
 * 放在这里而不是 admin-orgs.service.ts：那个文件已经超过 800 行，不再往里堆逻辑。
 * 只有管理员能改（机构自己先不开）。
 */
export interface OrgBrandPatchInput {
  brandName?: string | null
  brandMark?: string | null
  brandLogoAssetId?: string | null
}

export interface OrgBrandPatch {
  brandName?: string | null
  brandMark?: string | null
  brandLogoAssetId?: string | null
}

/**
 * 校验并整理要写进 Organization 的品牌覆盖：省略 = 不改（结果里没有这个键）；
 * null 或纯空白 = 清除（写 null，回到平台默认）。校验口径与平台品牌一致。
 */
export async function prepareOrgBrandPatch(
  prisma: Pick<PrismaService, 'brandLogo'>,
  input: OrgBrandPatchInput,
): Promise<OrgBrandPatch> {
  const patch: OrgBrandPatch = {}
  if (input.brandName !== undefined) patch.brandName = normalizeBrandName(input.brandName)
  if (input.brandMark !== undefined) patch.brandMark = normalizeBrandMark(input.brandMark)
  if (input.brandLogoAssetId !== undefined) {
    const assetId = normalizeLogoAssetId(input.brandLogoAssetId)
    if (assetId !== null) {
      const found = BRAND_LOGO_ID_PATTERN.test(assetId) && (await prisma.brandLogo.count({ where: { id: assetId } })) > 0
      if (!found) {
        throw new BadRequestException({
          error: { code: 'BRAND_LOGO_NOT_FOUND', message: '这张 Logo 不存在，请先上传' },
        })
      }
    }
    patch.brandLogoAssetId = assetId
  }
  return patch
}

/** 给管理员后台回显：库存值 + 现成的公开图片地址。 */
export function orgBrandOverrideView(row: {
  brandName: string | null
  brandMark: string | null
  brandLogoAssetId: string | null
}): OrgBrandOverride {
  return {
    brandName: row.brandName,
    brandMark: row.brandMark,
    brandLogoAssetId: row.brandLogoAssetId,
    brandLogoUrl: row.brandLogoAssetId ? brandLogoUrl(row.brandLogoAssetId) : null,
  }
}
