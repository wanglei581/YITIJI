import { Injectable, UnauthorizedException } from '@nestjs/common'
import { loadOrgLicenseResolution } from '../licenses/license-gate'
import { kioskLicenseState } from '../licenses/license-state'
import { PrismaService } from '../prisma/prisma.service'
import { TerminalSessionService } from '../terminals/terminal-session.service'
import { BrandingService, resolveBrand } from './branding.service'
import { KIOSK_PAUSED_NOTICE_LINE, type PublicKioskProfile } from './branding.types'

function clean(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text === '' ? null : text
}

/**
 * GET /public/kiosk-profile 的组装。
 *
 * 只有「已验签」的终端（x-terminal-id + x-terminal-session-token 经 TerminalSessionService.validate）
 * 才拿到机构品牌、点位名与授权块；没带或验不过，一律只给平台默认品牌，点位与授权状态都是 null——
 * 这个接口不登录，不能让人靠枚举终端号换出机构名称与点位分布。
 * 授权块把「不让开始新业务」（acceptsNewSessions）和「让在办的人办完」（currentSessionMayContinue）拆开：
 * 验签通过就说明带着一个仍有效的会话，授权不可用也不会让这个会话中断，只是不再给新的。
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
      // 未验签：不知道授权状态，不拦（acceptsNewSessions 为 true）；也没有可继续的会话。
      return {
        ...(await this.branding.toPublicBrand(resolved)),
        filing: resolved.filing,
        location: null,
        licenseState: null,
        acceptsNewSessions: true,
        currentSessionMayContinue: false,
        noticeLine: null,
      }
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
    const licenseState = resolution ? kioskLicenseState(resolution) : 'ok'
    const acceptsNewSessions = licenseState !== 'inactive'
    return {
      ...(await this.branding.toPublicBrand(resolved)),
      filing: resolved.filing,
      location: clean(terminal?.locationLabel) ?? clean(terminal?.displayName),
      licenseState,
      acceptsNewSessions,
      // 走到这里说明请求带的会话已通过验签（仍有效）。授权到期不会打断它：已签发的会话照常用到自然过期，
      // 只是不再签发新的——前端据此让在办的人办完，等会话结束再进静态「暂停服务」屏。
      currentSessionMayContinue: true,
      noticeLine: acceptsNewSessions ? null : KIOSK_PAUSED_NOTICE_LINE,
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
