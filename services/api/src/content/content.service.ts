import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common'
import { randomUUID } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { LocalFileStorage } from '../files/storage'
import { signAdAssetUrl, signAdAssetPreviewUrl } from './content-signing'
import { validateMedia, getMediaLimits } from './media-validation'
import type {
  AdAssetStatus,
  AdAssetView,
  AdPlaylistView,
  KioskScreensaverPlaylist,
  ScreensaverTerminalView,
  TerminalScreensaverConfigView,
} from './content.types'

const ONLINE_THRESHOLD_MS = 2 * 60 * 1000 // 2 分钟内有心跳视为在线
const DEFAULT_IDLE_TIMEOUT_SEC = 180
const MIN_IDLE_TIMEOUT_SEC = 30
const MAX_IDLE_TIMEOUT_SEC = 1800
const MIN_DURATION_SEC = 3

/**
 * 待机宣传屏内容服务。
 *
 * 负责:素材上传/落库/软删、播放方案 CRUD、终端配置、Kiosk 播放列表解析。
 * 审计日志由 controller 在动作完成后回写(与 FilesService 同口径)。
 *
 * 物理文件复用 LocalFileStorage(purpose='screensaver_ad'),
 * 与用户敏感文件(FileObject)隔离:宣传屏素材是长期运营内容,不自动过期。
 */
@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name)
  private readonly storage = new LocalFileStorage()

  constructor(private readonly prisma: PrismaService) {}

  // ── 素材 ────────────────────────────────────────────────────────────────────

  async listAssets(args: { includeDeleted?: boolean; status?: string; type?: string } = {}): Promise<AdAssetView[]> {
    const records = await this.prisma.adAsset.findMany({
      where: {
        ...(args.includeDeleted ? {} : { deletedAt: null }),
        ...(args.status ? { status: args.status } : {}),
        ...(args.type ? { type: args.type } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    })
    return records.map(toAssetView)
  }

  async createAsset(args: {
    buffer: Buffer
    mimeType: string
    title: string
    durationSec?: number
    createdBy: string | null
  }): Promise<AdAssetView> {
    const v = validateMedia(args.mimeType, args.buffer)
    if (!v.ok) {
      throw new BadRequestException({ error: { code: v.code, message: v.message } })
    }

    const title = args.title?.trim()
    if (!title) {
      throw new BadRequestException({ error: { code: 'AD_ASSET_TITLE_REQUIRED', message: '素材标题不能为空' } })
    }

    const durationSec = this.normalizeDuration(v.kind, args.durationSec)

    const id = randomUUID().replace(/-/g, '')
    const { storageKey, sha256 } = await this.storage.put('screensaver_ad', v.ext, id, args.buffer)

    const record = await this.prisma.adAsset.create({
      data: {
        id,
        type: v.kind,
        title,
        storageKey,
        mimeType: args.mimeType,
        sizeBytes: args.buffer.length,
        sha256,
        durationSec,
        source: 'uploaded',
        status: 'active',
        createdBy: args.createdBy,
      },
    })
    this.logger.log(`Ad asset uploaded: ${record.id} (${record.type}, ${record.sizeBytes}B)`)
    return toAssetView(record)
  }

  async updateAsset(
    id: string,
    patch: { title?: string; durationSec?: number; status?: AdAssetStatus },
  ): Promise<AdAssetView> {
    const record = await this.requireAliveAsset(id)
    const data: Record<string, unknown> = {}
    if (patch.title !== undefined) {
      const t = patch.title.trim()
      if (!t) throw new BadRequestException({ error: { code: 'AD_ASSET_TITLE_REQUIRED', message: '素材标题不能为空' } })
      data['title'] = t
    }
    if (patch.durationSec !== undefined) {
      data['durationSec'] = this.normalizeDuration(record.type as 'image' | 'video', patch.durationSec)
    }
    if (patch.status !== undefined) data['status'] = patch.status

    const updated = await this.prisma.adAsset.update({ where: { id }, data })
    return toAssetView(updated)
  }

  async deleteAsset(id: string): Promise<AdAssetView> {
    const record = await this.requireAliveAsset(id)
    // 物理删除文件 + 软删元数据(保留删除痕迹,审计可追溯)
    await this.storage.delete(record.storageKey)
    const updated = await this.prisma.adAsset.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'disabled' },
    })
    this.logger.log(`Ad asset deleted: ${id}`)
    return toAssetView(updated)
  }

  /** 供签名内容端点读取(只读存活素材的物理内容)。 */
  async readAssetContent(id: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const record = await this.requireAliveAsset(id)
    const buffer = await this.storage.read(record.storageKey)
    return { buffer, mimeType: record.mimeType }
  }

  // ── 播放方案 ────────────────────────────────────────────────────────────────

  async listPlaylists(): Promise<AdPlaylistView[]> {
    const records = await this.prisma.adPlaylist.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { items: { include: { asset: true }, orderBy: { order: 'asc' } } },
    })
    return records.map(toPlaylistView)
  }

  async createPlaylist(input: {
    name: string
    status?: 'active' | 'disabled'
    items: { assetId: string; order: number; enabled?: boolean }[]
    createdBy: string | null
  }): Promise<AdPlaylistView> {
    await this.assertAssetsExist(input.items.map((i) => i.assetId))
    const id = randomUUID().replace(/-/g, '')
    await this.prisma.adPlaylist.create({
      data: {
        id,
        name: input.name.trim(),
        status: input.status ?? 'active',
        createdBy: input.createdBy,
        items: {
          create: dedupeItems(input.items).map((i) => ({
            assetId: i.assetId,
            order: i.order,
            enabled: i.enabled ?? true,
          })),
        },
      },
    })
    return this.getPlaylistOrThrow(id)
  }

  async updatePlaylist(
    id: string,
    input: { name: string; status?: 'active' | 'disabled'; items: { assetId: string; order: number; enabled?: boolean }[] },
  ): Promise<AdPlaylistView> {
    const existing = await this.prisma.adPlaylist.findFirst({ where: { id, deletedAt: null } })
    if (!existing) {
      throw new NotFoundException({ error: { code: 'AD_PLAYLIST_NOT_FOUND', message: '播放方案不存在' } })
    }
    await this.assertAssetsExist(input.items.map((i) => i.assetId))

    // 整体替换 items:先删后建,保证排序/开关与提交一致。
    const items = dedupeItems(input.items)
    await this.prisma.$transaction(async (tx) => {
      await tx.adPlaylistItem.deleteMany({ where: { playlistId: id } })
      await tx.adPlaylist.update({
        where: { id },
        data: {
          name: input.name.trim(),
          status: input.status ?? existing.status,
          items: {
            create: items.map((i) => ({
              assetId: i.assetId,
              order: i.order,
              enabled: i.enabled ?? true,
            })),
          },
        },
      })
    })
    return this.getPlaylistOrThrow(id)
  }

  async deletePlaylist(id: string): Promise<void> {
    const existing = await this.prisma.adPlaylist.findFirst({ where: { id, deletedAt: null } })
    if (!existing) {
      throw new NotFoundException({ error: { code: 'AD_PLAYLIST_NOT_FOUND', message: '播放方案不存在' } })
    }
    // 软删方案;解绑引用它的终端配置(置空 playlistId + 关闭屏保),避免终端拉到空内容。
    await this.prisma.$transaction(async (tx) => {
      await tx.terminalScreensaverConfig.updateMany({
        where: { playlistId: id },
        data: { playlistId: null, enabled: false },
      })
      await tx.adPlaylist.update({ where: { id }, data: { deletedAt: new Date(), status: 'disabled' } })
    })
    this.logger.log(`Ad playlist deleted: ${id}`)
  }

  // ── 终端配置 ────────────────────────────────────────────────────────────────

  async getTerminalConfig(terminalId: string): Promise<TerminalScreensaverConfigView> {
    const config = await this.prisma.terminalScreensaverConfig.findUnique({
      where: { terminalId },
      include: { playlist: true },
    })
    if (!config) {
      return {
        terminalId,
        enabled: false,
        idleTimeoutSec: DEFAULT_IDLE_TIMEOUT_SEC,
        playlistId: null,
        playlistName: null,
        updatedAt: null,
      }
    }
    return toConfigView(config, config.playlist?.name ?? null)
  }

  async saveTerminalConfig(
    terminalId: string,
    input: { enabled: boolean; idleTimeoutSec: number; playlistId: string | null },
    updatedBy: string | null,
  ): Promise<TerminalScreensaverConfigView> {
    const idleTimeoutSec = clamp(Math.floor(input.idleTimeoutSec), MIN_IDLE_TIMEOUT_SEC, MAX_IDLE_TIMEOUT_SEC)

    let playlistId = input.playlistId
    if (playlistId) {
      const playlist = await this.prisma.adPlaylist.findFirst({ where: { id: playlistId, deletedAt: null } })
      if (!playlist) {
        throw new BadRequestException({ error: { code: 'AD_PLAYLIST_NOT_FOUND', message: '绑定的播放方案不存在' } })
      }
    } else {
      playlistId = null
    }
    // 没有绑定方案时不允许 enabled=true(否则终端拉到空,屏保无内容可放)
    const enabled = input.enabled && !!playlistId

    const saved = await this.prisma.terminalScreensaverConfig.upsert({
      where: { terminalId },
      create: { terminalId, enabled, idleTimeoutSec, playlistId, updatedBy },
      update: { enabled, idleTimeoutSec, playlistId, updatedBy },
      include: { playlist: true },
    })
    return toConfigView(saved, saved.playlist?.name ?? null)
  }

  async listScreensaverTerminals(): Promise<ScreensaverTerminalView[]> {
    const [terminals, configs] = await Promise.all([
      this.prisma.terminal.findMany({ orderBy: { registeredAt: 'desc' }, take: 500 }),
      this.prisma.terminalScreensaverConfig.findMany({ include: { playlist: true } }),
    ])
    const configByTerminal = new Map(configs.map((c) => [c.terminalId, c]))
    const now = Date.now()

    const rows: ScreensaverTerminalView[] = terminals.map((t) => {
      const config = configByTerminal.get(t.id)
      return {
        terminalId: t.id,
        terminalCode: t.terminalCode,
        isOnline: now - t.lastSeenAt.getTime() < ONLINE_THRESHOLD_MS,
        config: config ? toConfigView(config, config.playlist?.name ?? null) : null,
      }
    })

    // 预置但尚未注册的终端配置也展示(terminalCode 未知)
    const seen = new Set(terminals.map((t) => t.id))
    for (const c of configs) {
      if (!seen.has(c.terminalId)) {
        rows.push({
          terminalId: c.terminalId,
          terminalCode: null,
          isOnline: false,
          config: toConfigView(c, c.playlist?.name ?? null),
        })
      }
    }
    return rows
  }

  // ── Kiosk 拉取 ──────────────────────────────────────────────────────────────

  async getKioskPlaylist(terminalId: string): Promise<KioskScreensaverPlaylist> {
    const config = await this.prisma.terminalScreensaverConfig.findUnique({
      where: { terminalId },
      include: {
        playlist: {
          include: { items: { include: { asset: true }, orderBy: { order: 'asc' } } },
        },
      },
    })

    const idleTimeoutSec = config?.idleTimeoutSec ?? DEFAULT_IDLE_TIMEOUT_SEC

    if (!config || !config.enabled || !config.playlist || config.playlist.status !== 'active') {
      return { enabled: false, idleTimeoutSec, items: [] }
    }

    const items = config.playlist.items
      .filter((it) => it.enabled && it.asset.status === 'active' && it.asset.deletedAt === null)
      .map((it) => {
        const signed = signAdAssetUrl(it.asset.id)
        return {
          id: it.asset.id,
          type: it.asset.type as 'image' | 'video',
          url: signed.url,
          mimeType: it.asset.mimeType,
          durationSec: it.asset.durationSec,
          sha256: it.asset.sha256,
        }
      })

    // 启用但无可播素材 → 不进屏保(避免黑屏)
    return { enabled: items.length > 0, idleTimeoutSec, items }
  }

  /** 暴露给 controller / AI poster service 的限制配置。 */
  getLimits(): ReturnType<typeof getMediaLimits> {
    return getMediaLimits()
  }

  // ── 内部 ────────────────────────────────────────────────────────────────────

  private normalizeDuration(kind: 'image' | 'video', input?: number): number {
    const limits = getMediaLimits()
    const fallback = kind === 'video' ? Math.min(15, limits.maxVideoDurationSec) : 8
    const n = input === undefined || input === null ? fallback : Math.floor(input)
    if (!Number.isFinite(n) || n < MIN_DURATION_SEC) {
      throw new BadRequestException({
        error: { code: 'AD_ASSET_DURATION_INVALID', message: `停留/时长至少 ${MIN_DURATION_SEC} 秒` },
      })
    }
    if (kind === 'video' && n > limits.maxVideoDurationSec) {
      throw new BadRequestException({
        error: { code: 'AD_ASSET_DURATION_TOO_LONG', message: `视频时长超出 ${limits.maxVideoDurationSec} 秒上限` },
      })
    }
    return n
  }

  private async assertAssetsExist(assetIds: string[]): Promise<void> {
    const ids = [...new Set(assetIds)]
    if (ids.length === 0) return
    const count = await this.prisma.adAsset.count({ where: { id: { in: ids }, deletedAt: null } })
    if (count !== ids.length) {
      throw new BadRequestException({
        error: { code: 'AD_ASSET_NOT_FOUND', message: '播放方案包含不存在或已删除的素材' },
      })
    }
  }

  private async getPlaylistOrThrow(id: string): Promise<AdPlaylistView> {
    const record = await this.prisma.adPlaylist.findUnique({
      where: { id },
      include: { items: { include: { asset: true }, orderBy: { order: 'asc' } } },
    })
    if (!record) {
      throw new NotFoundException({ error: { code: 'AD_PLAYLIST_NOT_FOUND', message: '播放方案不存在' } })
    }
    return toPlaylistView(record)
  }

  private async requireAliveAsset(id: string) {
    const record = await this.prisma.adAsset.findUnique({ where: { id } })
    if (!record || record.deletedAt) {
      throw new NotFoundException({ error: { code: 'AD_ASSET_NOT_FOUND', message: '素材不存在或已删除' } })
    }
    return record
  }
}

// ── 映射 helpers ──────────────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max)
}

/** 同一 assetId 去重(防前端重复加入导致 unique 约束报错),保留首次出现的 order/enabled。 */
function dedupeItems<T extends { assetId: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const it of items) {
    if (seen.has(it.assetId)) continue
    seen.add(it.assetId)
    out.push(it)
  }
  return out
}

function toAssetView(r: {
  id: string
  type: string
  title: string
  mimeType: string
  sizeBytes: number
  sha256: string
  width: number | null
  height: number | null
  durationSec: number
  source: string
  status: string
  createdAt: Date
}): AdAssetView {
  return {
    id: r.id,
    type: r.type as 'image' | 'video',
    title: r.title,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    sha256: r.sha256,
    width: r.width,
    height: r.height,
    durationSec: r.durationSec,
    source: r.source as 'uploaded' | 'ai_generated',
    status: r.status as 'active' | 'disabled',
    createdAt: r.createdAt.toISOString(),
    previewUrl: signAdAssetPreviewUrl(r.id),
  }
}

function toPlaylistView(r: {
  id: string
  name: string
  status: string
  createdAt: Date
  updatedAt: Date
  items: {
    id: string
    assetId: string
    order: number
    enabled: boolean
    asset: Parameters<typeof toAssetView>[0]
  }[]
}): AdPlaylistView {
  return {
    id: r.id,
    name: r.name,
    status: r.status as 'active' | 'disabled',
    itemCount: r.items.length,
    items: r.items.map((it) => ({
      id: it.id,
      assetId: it.assetId,
      order: it.order,
      enabled: it.enabled,
      asset: toAssetView(it.asset),
    })),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }
}

function toConfigView(
  c: { terminalId: string; enabled: boolean; idleTimeoutSec: number; playlistId: string | null; updatedAt: Date },
  playlistName: string | null,
): TerminalScreensaverConfigView {
  return {
    terminalId: c.terminalId,
    enabled: c.enabled,
    idleTimeoutSec: c.idleTimeoutSec,
    playlistId: c.playlistId,
    playlistName,
    updatedAt: c.updatedAt.toISOString(),
  }
}
