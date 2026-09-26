import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

/**
 * 一体机岗位板块开关。
 *
 * 全局默认开，逐台可关，全局关优先。无配置行 = 开。
 * 判定不缓存：管理端写入后，下一次公开岗位请求立即拒绝。
 * 展示值放进 GET /terminals/:id/config。一体机约每 5 分钟
 * （refreshIntervalMs = 300000）重拉这份配置；configVersion 含本行 updatedAt。
 * 没有推送。getCachedKioskTerminalConfig 的 30 秒内存缓存不覆盖岗位接口。
 */
export const KIOSK_JOB_BOARD_GLOBAL_ID = '__global__'
export const KIOSK_JOB_BOARD_DISABLED_CODE = 'KIOSK_JOB_BOARD_DISABLED'

export type KioskJobBoardReason = 'open' | 'global_off' | 'terminal_off'

export interface KioskJobBoardPublicView {
  enabled: boolean
  globalEnabled: boolean
  terminalEnabled: boolean | null
  reason: KioskJobBoardReason
  version: string
}

export interface KioskJobBoardGlobalAdminView {
  scope: 'global'
  enabled: boolean
  updatedAt: string | null
  updatedBy: string | null
}

export interface KioskJobBoardTerminalAdminView {
  scope: 'terminal'
  terminalId: string
  enabled: boolean | null
  effectiveEnabled: boolean
  globalEnabled: boolean
  reason: KioskJobBoardReason
  updatedAt: string | null
  updatedBy: string | null
}

export interface KioskJobBoardRequest {
  headers?: Record<string, string | string[] | undefined>
  query?: Record<string, unknown>
  body?: unknown
}

const TERMINAL_REF_RE = /^[A-Za-z0-9_.:-]{1,64}$/

export function decideKioskJobBoard(
  globalEnabled: boolean,
  terminalEnabled: boolean | null,
): { enabled: boolean; reason: KioskJobBoardReason } {
  if (globalEnabled === false) return { enabled: false, reason: 'global_off' }
  if (terminalEnabled === false) return { enabled: false, reason: 'terminal_off' }
  return { enabled: true, reason: 'open' }
}

function headerOf(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | null {
  if (!headers) return null
  const direct = headers[name] ?? headers[name.toLowerCase()]
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  if (Array.isArray(direct) && direct[0]?.trim()) return direct[0].trim()
  return null
}

function queryTerminalId(query: Record<string, unknown> | undefined): string {
  const raw = query?.['terminalId']
  if (typeof raw === 'string') return raw.trim()
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0].trim()
  return ''
}

/** 一体机身份：x-terminal-id、body.terminalId、query.terminalId。全局行名不可被客户端冒充。 */
export function kioskJobBoardTerminalRef(req: KioskJobBoardRequest | null | undefined): string | null {
  if (!req) return null
  const body = req.body && typeof req.body === 'object'
    ? (req.body as { terminalId?: unknown }).terminalId
    : null
  const bodyRef = typeof body === 'string' ? body.trim() : ''
  const raw = (headerOf(req.headers, 'x-terminal-id') || bodyRef || queryTerminalId(req.query)).slice(0, 64)
  if (!raw || raw === KIOSK_JOB_BOARD_GLOBAL_ID || !TERMINAL_REF_RE.test(raw)) return null
  return raw
}

interface TerminalSwitch {
  enabled: boolean | null
  updatedAt: Date | null
  updatedBy: string | null
  canonicalId: string
}

@Injectable()
export class KioskJobBoardService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(terminalRef: string | null): Promise<KioskJobBoardPublicView> {
    const [globalRow, terminal] = await Promise.all([
      this.prisma.kioskJobBoardConfig.findUnique({ where: { terminalId: KIOSK_JOB_BOARD_GLOBAL_ID } }),
      this.readTerminalSwitch(terminalRef),
    ])
    const globalEnabled = globalRow?.enabled ?? true
    const decision = decideKioskJobBoard(globalEnabled, terminal.enabled)
    return {
      enabled: decision.enabled,
      globalEnabled,
      terminalEnabled: terminal.enabled,
      reason: decision.reason,
      version: [
        `job-board-global:${globalRow?.updatedAt.toISOString() ?? 'default'}`,
        `job-board-terminal:${terminal.updatedAt?.toISOString() ?? 'default'}`,
      ].join('|'),
    }
  }

  async assertOpen(terminalRef: string | null): Promise<void> {
    const view = await this.resolve(terminalRef)
    if (view.enabled) return
    throw new ForbiddenException({
      error: {
        code: KIOSK_JOB_BOARD_DISABLED_CODE,
        message: view.reason === 'global_off' ? '岗位板块已全局关闭' : '本终端岗位板块已关闭',
      },
    })
  }

  async getGlobalAdmin(): Promise<KioskJobBoardGlobalAdminView> {
    const row = await this.prisma.kioskJobBoardConfig.findUnique({
      where: { terminalId: KIOSK_JOB_BOARD_GLOBAL_ID },
    })
    return {
      scope: 'global',
      enabled: row?.enabled ?? true,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: row?.updatedBy ?? null,
    }
  }

  async saveGlobal(enabled: boolean, updatedBy: string | null): Promise<KioskJobBoardGlobalAdminView> {
    const row = await this.prisma.kioskJobBoardConfig.upsert({
      where: { terminalId: KIOSK_JOB_BOARD_GLOBAL_ID },
      create: { terminalId: KIOSK_JOB_BOARD_GLOBAL_ID, enabled, updatedBy },
      update: { enabled, updatedBy },
    })
    return {
      scope: 'global',
      enabled: row.enabled,
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.updatedBy,
    }
  }

  async getTerminalAdmin(terminalRef: string): Promise<KioskJobBoardTerminalAdminView> {
    const terminal = await this.readTerminalSwitch(this.requireTerminalRef(terminalRef))
    const globalRow = await this.prisma.kioskJobBoardConfig.findUnique({
      where: { terminalId: KIOSK_JOB_BOARD_GLOBAL_ID },
    })
    const globalEnabled = globalRow?.enabled ?? true
    const decision = decideKioskJobBoard(globalEnabled, terminal.enabled)
    return {
      scope: 'terminal',
      terminalId: terminal.canonicalId,
      enabled: terminal.enabled,
      effectiveEnabled: decision.enabled,
      globalEnabled,
      reason: decision.reason,
      updatedAt: terminal.updatedAt?.toISOString() ?? null,
      updatedBy: terminal.updatedBy,
    }
  }

  async saveTerminal(
    terminalRef: string,
    enabled: boolean,
    updatedBy: string | null,
  ): Promise<KioskJobBoardTerminalAdminView> {
    const ref = this.requireTerminalRef(terminalRef)
    const terminal = await this.findTerminal(ref)
    const canonical = terminal?.terminalCode ?? ref
    const aliases = this.aliasKeys(ref, terminal).filter((key) => key !== canonical)
    await this.prisma.$transaction([
      ...(aliases.length
        ? [this.prisma.kioskJobBoardConfig.deleteMany({ where: { terminalId: { in: aliases } } })]
        : []),
      this.prisma.kioskJobBoardConfig.upsert({
        where: { terminalId: canonical },
        create: { terminalId: canonical, enabled, updatedBy },
        update: { enabled, updatedBy },
      }),
    ])
    return this.getTerminalAdmin(canonical)
  }

  private requireTerminalRef(terminalRef: string): string {
    const ref = terminalRef.trim()
    if (!ref || ref === KIOSK_JOB_BOARD_GLOBAL_ID || !TERMINAL_REF_RE.test(ref)) {
      throw new BadRequestException({
        error: { code: 'INVALID_TERMINAL_REF', message: '终端编号不正确' },
      })
    }
    return ref
  }

  private async findTerminal(ref: string): Promise<{ id: string; terminalCode: string } | null> {
    return this.prisma.terminal.findFirst({
      where: { OR: [{ id: ref }, { terminalCode: ref }] },
      select: { id: true, terminalCode: true },
    })
  }

  private aliasKeys(
    ref: string,
    terminal: { id: string; terminalCode: string } | null,
  ): string[] {
    return [...new Set([ref, terminal?.terminalCode, terminal?.id].filter((key): key is string => !!key))]
      .filter((key) => key !== KIOSK_JOB_BOARD_GLOBAL_ID)
  }

  private async readTerminalSwitch(terminalRef: string | null): Promise<TerminalSwitch> {
    if (!terminalRef) {
      return { enabled: null, updatedAt: null, updatedBy: null, canonicalId: '' }
    }
    const terminal = await this.findTerminal(terminalRef)
    const keys = this.aliasKeys(terminalRef, terminal)
    const canonical = terminal?.terminalCode ?? terminalRef
    if (keys.length === 0) {
      return { enabled: null, updatedAt: null, updatedBy: null, canonicalId: canonical }
    }
    const rows = await this.prisma.kioskJobBoardConfig.findMany({ where: { terminalId: { in: keys } } })
    if (rows.length === 0) {
      return { enabled: null, updatedAt: null, updatedBy: null, canonicalId: canonical }
    }
    const closed = rows.find((row) => row.enabled === false)
    const picked = closed ?? rows[0]!
    return {
      enabled: closed ? false : true,
      updatedAt: picked.updatedAt,
      updatedBy: picked.updatedBy,
      canonicalId: canonical,
    }
  }
}
