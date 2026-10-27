import { BadRequestException, Injectable } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { PrismaService, type PrismaTransactionClient } from '../prisma/prisma.service'
import { SUPPORT_PHONE_PATTERN } from './dto/update-support-contact.dto'
import { terminalHeartbeatOnline } from './support-contact.online'

/** 没配服务时间时，公开接口返回这句。合规要求电话后面跟着服务时间。 */
export const DEFAULT_SERVICE_HOURS = '工作日 9:00–18:00'

/**
 * 按 terminalId 缓存电话、服务时间、附近终端和小程序是否发布。
 * 这几项保存后不主动清，最迟一个周期后生效。
 * 页签开关另有一条缓存，见 selfNoteTabCache。
 */
export const SUPPORT_CONTACT_CACHE_TTL_MS = 5 * 60 * 1000

const KEY_PHONE = 'support.servicePhone'
const KEY_HOURS = 'support.serviceHours'
const KEY_MINIAPP = 'support.miniappPublished'
/** 只有库存字符串 true 算开。缺省、空串和其他值都是关。 */
const KEY_SELF_NOTE_TAB = 'support.selfNoteTab'
const AUDIT_ACTION = 'support_contact.update'
/** 页签开关单独审计，不和电话三项共用 support_contact.update。 */
const SELF_NOTE_TAB_AUDIT_ACTION = 'self_note_tab.update'
const TERMINAL_REF_MAX = 128

/** 公开接口不登录，缓存条数要有上限，否则换着终端号刷会让进程内存一直涨。 */
const SUPPORT_CONTACT_CACHE_MAX_ENTRIES = 500

export interface PublicSupportContact {
  servicePhone: string | null
  serviceHours: string | null
  otherOnlineTerminalNearby: boolean
  miniappPublished: boolean
  /** 一体机是否显示本人记事页签。只有 true 为开。 */
  selfNoteTab: boolean
}

/** 管理员读到的是库存值。服务时间没配是 null，不是公开接口那句默认文案。 */
export interface AdminSupportContact {
  servicePhone: string | null
  serviceHours: string | null
  miniappPublished: boolean
  selfNoteTab: boolean
}

export interface SupportContactPatch {
  servicePhone?: string | null
  serviceHours?: string | null
  miniappPublished?: boolean
  selfNoteTab?: boolean
}

/** 电话类审计仍只含这三项，不把页签开关混进去。 */
function contactAuditView(
  row: AdminSupportContact,
): Pick<AdminSupportContact, 'servicePhone' | 'serviceHours' | 'miniappPublished'> {
  return {
    servicePhone: row.servicePhone,
    serviceHours: row.serviceHours,
    miniappPublished: row.miniappPublished,
  }
}

type SettingStore = PrismaService | PrismaTransactionClient

let nowMs = (): number => Date.now()

/** 测试注入时钟。传 null 恢复系统时间。不清除缓存。 */
export function setSupportContactClock(next: (() => number) | null): void {
  nowMs = next ?? (() => Date.now())
}

interface TerminalPublicCache {
  servicePhone: string | null
  serviceHours: string | null
  otherOnlineTerminalNearby: boolean
  miniappPublished: boolean
}

interface CacheEntry {
  expiresAt: number
  value: TerminalPublicCache
}

const cache = new Map<string, CacheEntry>()

/** 页签开关与终端无关，全进程只留这一条。保存该键时只清它。 */
let selfNoteTabCache: { expiresAt: number; value: boolean } | null = null

function rememberSelfNoteTab(now: number, value: boolean): void {
  selfNoteTabCache = { expiresAt: now + SUPPORT_CONTACT_CACHE_TTL_MS, value }
}

function clearSelfNoteTabCache(): void {
  selfNoteTabCache = null
}

/** 门禁用：当前缓存条数（核上限）。 */
export function supportContactCacheSize(): number {
  return cache.size
}

function storedText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

@Injectable()
export class SupportContactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getPublic(terminalId?: string): Promise<PublicSupportContact> {
    const key = typeof terminalId === 'string' ? terminalId : ''
    const now = nowMs()
    const hit = cache.get(key)
    let base: TerminalPublicCache
    if (hit && hit.expiresAt > now) {
      base = hit.value
    } else {
      base = await this.computePublic(key, now)
      // 超长的号不缓存（本来也判 false）；到上限先清过期项，仍满就整表清掉。
      if (key.length <= TERMINAL_REF_MAX) {
        if (cache.size >= SUPPORT_CONTACT_CACHE_MAX_ENTRIES) {
          for (const [k, entry] of cache) if (entry.expiresAt <= now) cache.delete(k)
          if (cache.size >= SUPPORT_CONTACT_CACHE_MAX_ENTRIES) cache.clear()
        }
        cache.set(key, { expiresAt: now + SUPPORT_CONTACT_CACHE_TTL_MS, value: base })
      }
    }
    return { ...base, selfNoteTab: await this.readSelfNoteTabCached(now) }
  }

  async getAdmin(): Promise<AdminSupportContact> {
    return this.readSettings(this.prisma)
  }

  /**
   * 只更新请求里出现的字段。空对象不写库、不写审计。
   * 审计与配置在同一事务里：审计失败则配置回滚。
   * 电话、服务时间、小程序是否发布不清除按终端缓存的公开响应。
   * 页签开关保存成功后只清 selfNoteTab 那一条缓存。公开读取通常立刻看到，最迟一个周期。
   * 并发读回填可能把旧值写回，影响以 TTL 为界。
   */
  async updateAdmin(
    patch: SupportContactPatch,
    actor: { userId: string; role: string },
  ): Promise<AdminSupportContact> {
    const phone = patch.servicePhone === undefined ? undefined : this.normalizePhone(patch.servicePhone)
    const hours = patch.serviceHours === undefined ? undefined : this.normalizeHours(patch.serviceHours)
    const published = patch.miniappPublished
    const tabTouched = patch.selfNoteTab !== undefined
    if (phone === undefined && hours === undefined && published === undefined && !tabTouched) {
      return this.getAdmin()
    }
    const contactTouched = phone !== undefined || hours !== undefined || published !== undefined
    const after = await this.prisma.$transaction(async (tx) => {
      const before = await this.readSettings(tx)
      if (phone !== undefined) await this.writeKey(tx, KEY_PHONE, phone, actor.userId)
      if (hours !== undefined) await this.writeKey(tx, KEY_HOURS, hours, actor.userId)
      if (published !== undefined) {
        await this.writeKey(tx, KEY_MINIAPP, published ? 'true' : 'false', actor.userId)
      }
      if (tabTouched) {
        await this.writeKey(tx, KEY_SELF_NOTE_TAB, patch.selfNoteTab === true ? 'true' : 'false', actor.userId)
      }
      const next = await this.readSettings(tx)
      if (contactTouched) {
        await this.audit.writeRequired(tx, {
          actorId: actor.userId,
          actorRole: actor.role,
          action: AUDIT_ACTION,
          targetType: 'system',
          targetId: 'support-contact',
          payload: { before: contactAuditView(before), after: contactAuditView(next) },
        })
      }
      if (tabTouched) {
        await this.audit.writeRequired(tx, {
          actorId: actor.userId,
          actorRole: actor.role,
          action: SELF_NOTE_TAB_AUDIT_ACTION,
          targetType: 'system',
          targetId: 'self-note-tab',
          payload: {
            before: { selfNoteTab: before.selfNoteTab },
            after: { selfNoteTab: next.selfNoteTab },
          },
        })
      }
      return next
    })
    if (tabTouched) clearSelfNoteTabCache()
    return after
  }

  private async computePublic(terminalId: string, now: number): Promise<TerminalPublicCache> {
    const stored = await this.readSettings(this.prisma)
    return {
      servicePhone: stored.servicePhone,
      serviceHours: stored.serviceHours ?? DEFAULT_SERVICE_HOURS,
      otherOnlineTerminalNearby: await this.otherOnlineNearby(terminalId, now),
      miniappPublished: stored.miniappPublished,
    }
  }

  /**
   * 缺键、空串、以及除字符串 true 以外的任何值都是关。
   * 读库失败也是关，并按同一 TTL 记住，故障期间不再每个请求都等库。
   * 失败不得往外抛，也不得读成开。
   */
  private async readSelfNoteTabCached(now: number): Promise<boolean> {
    if (selfNoteTabCache && selfNoteTabCache.expiresAt > now) return selfNoteTabCache.value
    let value = false
    try {
      const row = await this.prisma.platformSetting.findUnique({
        where: { key: KEY_SELF_NOTE_TAB },
        select: { value: true },
      })
      value = row?.value === 'true'
    } catch {
      value = false
    }
    rememberSelfNoteTab(now, value)
    return value
  }

  /**
   * 附近是否还有别的在线终端。只返回布尔值，不查询、不返回其它终端的编号、数量或位置。
   *
   * 判据：本机 orgId 非空；同一 orgId 下除本机外，至少一台在线。
   * 在线见 support-contact.online.ts（terminals-admin.service.ts 第 328 行 + TERMINAL_ONLINE_WINDOW_MS）。
   * 其它终端只算正常运营的：enabled 且 lifecycleStatus === 'active'。计划中、调试中、维护中、
   * 已暂停、已退役都不算——让用户去找一台正在维护或暂停的机器，就是合规要防的虚假指引。
   * 读不到本机、不带 terminalId、终端号超过 128 字、本机已退役、本机没绑机构 → false。
   */
  private async otherOnlineNearby(terminalId: string, now: number): Promise<boolean> {
    if (!terminalId || terminalId.length > TERMINAL_REF_MAX) return false
    const self = await this.findTerminal(terminalId)
    if (!self || self.lifecycleStatus === 'retired' || !self.orgId) return false
    const others = await this.prisma.terminal.findMany({
      where: {
        orgId: self.orgId,
        id: { not: self.id },
        enabled: true,
        lifecycleStatus: 'active',
      },
      select: {
        lastHeartbeatAt: true,
        heartbeats: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
    })
    return others.some((row) =>
      terminalHeartbeatOnline(row.lastHeartbeatAt, row.heartbeats[0]?.createdAt ?? null, now),
    )
  }

  /** 先按内部 id，再按一体机手里的 terminalCode。两种都接受。 */
  private async findTerminal(ref: string): Promise<{ id: string; orgId: string | null; lifecycleStatus: string } | null> {
    const select = { id: true, orgId: true, lifecycleStatus: true } as const
    const byId = await this.prisma.terminal.findUnique({ where: { id: ref }, select })
    if (byId) return byId
    return this.prisma.terminal.findUnique({ where: { terminalCode: ref }, select })
  }

  private async readSettings(db: SettingStore): Promise<AdminSupportContact> {
    const rows = await db.platformSetting.findMany({
      where: { key: { in: [KEY_PHONE, KEY_HOURS, KEY_MINIAPP, KEY_SELF_NOTE_TAB] } },
      select: { key: true, value: true },
    })
    const map = new Map(rows.map((row) => [row.key, row.value]))
    return {
      servicePhone: storedText(map.get(KEY_PHONE)),
      serviceHours: storedText(map.get(KEY_HOURS)),
      miniappPublished: map.get(KEY_MINIAPP) === 'true',
      selfNoteTab: map.get(KEY_SELF_NOTE_TAB) === 'true',
    }
  }

  private async writeKey(
    tx: PrismaTransactionClient,
    key: string,
    value: string | null,
    updatedBy: string,
  ): Promise<void> {
    await tx.platformSetting.upsert({
      where: { key },
      create: { key, value, updatedBy },
      update: { value, updatedBy },
    })
  }

  private normalizePhone(value: string | null): string | null {
    const text = storedText(value)
    if (text === null) return null
    if (!SUPPORT_PHONE_PATTERN.test(text)) {
      throw new BadRequestException({
        error: { code: 'VALIDATION_FAILED', message: '服务电话需为大陆手机号或带区号的固定电话' },
      })
    }
    return text
  }

  private normalizeHours(value: string | null): string | null {
    const text = storedText(value)
    if (text === null) return null
    if (text.length > 40) {
      throw new BadRequestException({
        error: { code: 'VALIDATION_FAILED', message: '服务时间不超过 40 个字' },
      })
    }
    return text
  }
}
