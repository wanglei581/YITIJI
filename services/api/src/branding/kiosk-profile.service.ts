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
 * 授权块把「不让开始新业务」（acceptsNewSessions）和「当前凭证不被打断」（currentSessionMayContinue）拆开：
 * 验签通过就说明带着一个仍有效的会话凭证，授权不可用不会掐断它，但也不再续期——最多用到 currentSessionEndsAt。
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
    const verified = await this.verify(terminalId, sessionToken)
    const verifiedId = verified?.id ?? null
    if (!verified || !verifiedId) {
      const resolved = resolveBrand(stored, null)
      // 未验签：不知道授权状态，不拦（acceptsNewSessions 为 true）；也没有可继续的会话。
      return {
        ...(await this.branding.toPublicBrand(resolved)),
        filing: resolved.filing,
        location: null,
        licenseState: null,
        acceptsNewSessions: true,
        currentSessionMayContinue: false,
        currentSessionEndsAt: null,
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
      // 走到这里说明请求带的会话已通过验签（仍有效）。授权失效不打断这张凭证，但也不再续期：
      // 它最多用到 currentSessionEndsAt（≤ 30 分钟），之后换票、续期都被拒——前端据此让进行中的办理在这之前收尾，
      // 到期后再进静态「暂停服务」屏；不要承诺不限时地「办完」。
      currentSessionMayContinue: true,
      currentSessionEndsAt: verified.expiresAt,
      noticeLine: acceptsNewSessions ? null : KIOSK_PAUSED_NOTICE_LINE,
    }
  }

  private async verify(terminalId: string | undefined, sessionToken: string | undefined): Promise<{ id: string; expiresAt: string } | null> {
    const id = clean(terminalId)
    const token = clean(sessionToken)
    if (!id || !token) return null
    try {
      const { expiresAt } = await this.sessions.inspect(id, token)
      return { id, expiresAt }
    } catch (error) {
      if (error instanceof UnauthorizedException) return null
      throw error
    }
  }
}
