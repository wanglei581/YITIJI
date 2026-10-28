import { Injectable, UnauthorizedException } from '@nestjs/common'
import { loadOrgLicenseResolution } from '../licenses/license-gate'
import { kioskLicenseState } from '../licenses/license-state'
import { PrismaService } from '../prisma/prisma.service'
import { TerminalSessionService } from '../terminals/terminal-session.service'
import { BrandingService, resolveBrand } from './branding.service'
import type { PublicKioskProfile } from './branding.types'

function clean(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text === '' ? null : text
}

/**
 * GET /public/kiosk-profile 的组装。
 *
 * 只有「已验签」的终端（x-terminal-id + x-terminal-session-token 经 TerminalSessionService.validate）
 * 才拿到机构品牌、点位名与授权状态；没带或验不过，一律只给平台默认品牌，点位与授权状态都是 null——
 * 这个接口不登录，不能让人靠枚举终端号换出机构名称与点位分布。
 * 验签时 Redis 暂不可用（503 可重试）原样抛出，不当成「没验过」：一体机据此保持上次的状态，不会闪回默认。
 */
@Injectable()
export class KioskProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branding: BrandingService,
    private readonly sessions: TerminalSessionService,
  ) {}

  async get(terminalId: string | undefined, sessionToken: string | undefined): Promise<PublicKioskProfile> {
    const stored = await this.branding.readStored()
    const verifiedId = await this.verify(terminalId, sessionToken)
    if (!verifiedId) {
      const resolved = resolveBrand(stored, null)
      return { ...(await this.branding.toPublicBrand(resolved)), filing: resolved.filing, location: null, licenseState: null }
    }
    const terminal = await this.prisma.terminal.findUnique({
      where: { id: verifiedId },
      select: {
        orgId: true,
        locationLabel: true,
        displayName: true,
        org: { select: { brandName: true, brandMark: true, brandLogoAssetId: true } },
      },
    })
    const resolved = resolveBrand(stored, terminal?.org ?? null)
    const resolution = terminal?.orgId ? await loadOrgLicenseResolution(this.prisma, terminal.orgId) : null
    return {
      ...(await this.branding.toPublicBrand(resolved)),
      filing: resolved.filing,
      location: clean(terminal?.locationLabel) ?? clean(terminal?.displayName),
      licenseState: resolution ? kioskLicenseState(resolution) : 'ok',
    }
  }

  private async verify(terminalId: string | undefined, sessionToken: string | undefined): Promise<string | null> {
    const id = clean(terminalId)
    const token = clean(sessionToken)
    if (!id || !token) return null
    try {
      await this.sessions.validate(id, token)
      return id
    } catch (error) {
      if (error instanceof UnauthorizedException) return null
      throw error
    }
  }
}
