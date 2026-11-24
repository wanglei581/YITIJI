import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { AuthedUser } from '../common/decorators/current-user.decorator'
import { BrandingService, resolveBrand } from '../branding/branding.service'
import { PrismaService } from '../prisma/prisma.service'
import { TERMINAL_ONLINE_WINDOW_MS } from '../terminals/printer-availability'
import { MiniappCodeService } from './miniapp-code.service'
import type {
  PartnerMiniappEntryCodeResult,
  PartnerMiniappEntryInfo,
  PublicMiniappOrgEntry,
  PublicMiniappOrgTerminal,
} from './miniapp-org-entry.types'

export const MINIAPP_ORG_HOME_PAGE = 'pages/home/home'
export const MINIAPP_ORG_SCENE_PREFIX = 'o='
const ORG_ID_PATTERN = /^[A-Za-z0-9_-]{1,30}$/
const WECHAT_SCENE_MAX_LEN = 32
const TERMINAL_SELECTION_NOTE = '在线列表为实时预筛，实际是否可打印以选点后服务端核验为准。'

export function normalizeOrgEntryId(raw: string | undefined | null): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed || !ORG_ID_PATTERN.test(trimmed)) return null
  return trimmed
}

export function buildOrgEntryScene(orgId: string): { scene: string; valid: boolean } {
  const normalized = normalizeOrgEntryId(orgId)
  if (!normalized) return { scene: '', valid: false }
  const scene = `${MINIAPP_ORG_SCENE_PREFIX}${normalized}`
  return { scene, valid: scene.length <= WECHAT_SCENE_MAX_LEN }
}

export function buildOrgEntryPath(orgId: string): string {
  return `${MINIAPP_ORG_HOME_PAGE}?orgId=${encodeURIComponent(orgId)}`
}

export function isHeartbeatOnline(
  latest: { createdAt: Date; localTaskDatabaseAvailable?: boolean | null } | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!latest) return false
  if (latest.localTaskDatabaseAvailable === false) return false
  const seenMs = latest.createdAt.getTime()
  // 既拦截超过在线窗口的心跳，也拒绝晚于当前时间的异常时钟偏移心跳
  return seenMs <= nowMs && nowMs - seenMs < TERMINAL_ONLINE_WINDOW_MS
}

function notFoundOrgEntry(): NotFoundException {
  return new NotFoundException({
    error: { code: 'ORG_ENTRY_NOT_FOUND', message: '未找到可用的机构服务入口' },
  })
}

@Injectable()
export class MiniappOrgEntryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branding: BrandingService,
    private readonly codes: MiniappCodeService,
  ) {}

  /**
   * 公开读取机构联名入口信息（免登录）。
   * 不存在 / 停用 / 已归档 / 授权不可用 统一返回相同 404，不泄露机构内部状态。
   */
  async getPublicEntry(rawOrgId: string | undefined, nowMs: number = Date.now()): Promise<PublicMiniappOrgEntry> {
    const orgId = normalizeOrgEntryId(rawOrgId)
    if (!orgId) throw notFoundOrgEntry()

    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        name: true,
        type: true,
        enabled: true,
        archivedAt: true,
        brandName: true,
        brandMark: true,
        brandLogoAssetId: true,
      },
    })
    if (!org || !org.enabled || org.archivedAt !== null) {
      throw notFoundOrgEntry()
    }

    const brandActive = await this.branding.isOrgBrandActive(org.id, new Date(nowMs))
    if (!brandActive) {
      throw notFoundOrgEntry()
    }

    const storedBrand = await this.branding.readStored()
    const resolved = resolveBrand(storedBrand, org)
    const publicBrand = await this.branding.toPublicBrand(resolved)
    const terminals = await this.listOnlineOrgTerminals(org.id, nowMs)

    return {
      orgId: org.id,
      orgName: org.name,
      orgType: org.type,
      brandName: publicBrand.brandName,
      brandMark: publicBrand.brandMark,
      brandLogoUrl: publicBrand.logoUrl,
      terminals,
      terminalSelectionNote: TERMINAL_SELECTION_NOTE,
    }
  }

  /**
   * 合作机构后台读取本机构「一机构一码」入口摘要。
   * orgId 严格来自登录态 token（user.orgId），绝不接受外部入参。
   */
  async getPartnerEntry(user: AuthedUser, nowMs: number = Date.now()): Promise<PartnerMiniappEntryInfo> {
    const org = await this.requirePartnerOrg(user)
    const { scene, valid } = buildOrgEntryScene(org.id)
    const storedBrand = await this.branding.readStored()
    const resolved = resolveBrand(storedBrand, org)

    const [totalTerminalCount, onlineTerminals] = await Promise.all([
      this.prisma.terminal.count({
        where: { orgId: org.id, lifecycleStatus: { not: 'retired' } },
      }),
      this.listOnlineOrgTerminals(org.id, nowMs),
    ])

    return {
      orgId: org.id,
      orgName: org.name,
      brandName: resolved.brandName,
      miniappPath: buildOrgEntryPath(org.id),
      miniappScene: scene,
      sceneValid: valid,
      miniappCodeAvailable: this.codes.isConfigured(),
      envVersion: this.codes.envVersion(),
      onlineTerminalCount: onlineTerminals.length,
      totalTerminalCount,
    }
  }

  /**
   * 合作机构后台生成本机构专属无限制微信小程序码。
   * 归属来自 user.orgId；且写操作受全局 PartnerLicenseWriteInterceptor 管控（授权失效时拦截）。
   */
  async generatePartnerEntryCode(user: AuthedUser): Promise<PartnerMiniappEntryCodeResult> {
    const org = await this.requirePartnerOrg(user)
    if (!org.enabled) {
      throw new ForbiddenException({
        error: { code: 'ORG_DISABLED', message: '当前机构已停用，无法生成机构专属小程序码' },
      })
    }
    const { scene, valid } = buildOrgEntryScene(org.id)
    if (!valid) {
      throw new BadRequestException({
        error: { code: 'MINIAPP_SCENE_INVALID', message: '当前机构编号超出小程序码参数长度限制，请联系平台管理员处理' },
      })
    }

    const generated = await this.codes.generate(MINIAPP_ORG_HOME_PAGE, scene)
    const imageBase64 = generated.image.toString('base64')
    return {
      orgId: org.id,
      miniappPath: buildOrgEntryPath(org.id),
      miniappScene: scene,
      envVersion: generated.envVersion,
      mimeType: generated.mimeType,
      imageBase64,
      dataUri: `data:${generated.mimeType};base64,${imageBase64}`,
    }
  }

  private async requirePartnerOrg(user: AuthedUser) {
    if (user.role !== 'partner' || !user.orgId) {
      throw new ForbiddenException({
        error: { code: 'ORG_REQUIRED', message: '当前账号未绑定机构' },
      })
    }
    const org = await this.prisma.organization.findUnique({
      where: { id: user.orgId },
      select: {
        id: true,
        name: true,
        enabled: true,
        archivedAt: true,
        brandName: true,
        brandMark: true,
        brandLogoAssetId: true,
      },
    })
    if (!org || org.archivedAt !== null) {
      throw new NotFoundException({
        error: { code: 'ORG_NOT_FOUND', message: '机构不存在或已归档' },
      })
    }
    return org
  }

  private async listOnlineOrgTerminals(orgId: string, nowMs: number): Promise<PublicMiniappOrgTerminal[]> {
    const rows = await this.prisma.terminal.findMany({
      where: { orgId, enabled: true, lifecycleStatus: 'active' },
      select: {
        id: true,
        terminalCode: true,
        displayName: true,
        locationLabel: true,
        heartbeats: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true, localTaskDatabaseAvailable: true },
        },
      },
      orderBy: [{ locationLabel: 'asc' }, { terminalCode: 'asc' }],
    })

    return rows.flatMap((row) => {
      if (!isHeartbeatOnline(row.heartbeats[0], nowMs)) return []
      return [{
        id: row.id,
        displayName: row.displayName?.trim() || row.locationLabel?.trim() || '打印服务点（位置待补充）',
        locationLabel: row.locationLabel ?? null,
        isOnline: true as const,
      }]
    })
  }
}
